import { parseExpression, split, tokenize, mergeStatements, type ASTNode } from '@openuidev/lang-core'
export type Expr = ASTNode
export class Diagnostic extends Error {
  constructor(public code:string, public statementId:string, public propertyPath:string, detail:string) {
    super([code, statementId, propertyPath, detail].filter(Boolean).join(' · '))
  }
}
export function fail(code:string, id:string, path:string, message:string):never { throw new Diagnostic(code,id,path,message) }
export const actions:Record<string,number[]> = {Set:[2],Reset:[0,1],EmitGameEvent:[1],SetVisible:[2],SetEnabled:[2],SetInputEnabled:[2],DestroyNode:[1],Spawn:[1,2],RestartScene:[0,1],StartTimer:[1],StopTimer:[1]}
const binary = new Set(['+','-','*','/','%','==','!=','<','<=','>','>=','&&','||'])
// The streaming parser recovers incomplete input. A consuming syntax pass is required at commit.
function strictSyntax(text:string,id:string) {
  const pattern=/\s+|"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"|(?:0|[1-9]\d*)(?:\.\d+)?|[@$]?[a-zA-Z_]\w*|==|!=|<=|>=|&&|\|\||[()[\]{},:?!+*/%<>-]/gy
  const tokens:string[]=[]
  for(let pos=0;pos<text.length;) {
    pattern.lastIndex=pos
    const match=pattern.exec(text)
    if(!match) fail('SYNTAX',id,'','无法识别的字符 @'+pos)
    pos=pattern.lastIndex
    if(match[0].trim()) tokens.push(match[0])
  }
  let i=0
  function take(expected:string) { if(tokens[i++]!==expected) fail('SYNTAX',id,'','需要 '+expected) }
  function list(close:string,item:()=>void) {
    if(tokens[i]!==close) { item(); while(tokens[i]===',') {i++; item()} }
    take(close)
  }
  function atom(depth:number) {
    if(depth>96) fail('DEPTH',id,'','表达式太深')
    const t=tokens[i++]
    if(t==='!' || t==='-') atom(depth+1)
    else if(t==='(') {expression(depth+1);take(')')}
    else if(t==='[') list(']',()=>expression(depth+1))
    else if(t==='{') {
      const seen=new Set<string>()
      list('}',()=>{
        const key=tokens[i++]
        if(!key || !/^[a-zA-Z_]\w*$/.test(key) || ['constructor','prototype','__proto__'].includes(key)||seen.has(key)) fail('KEY',id,key,'无效或重复属性')
        seen.add(key);take(':');expression(depth+1)
      })
    } else if(t && /^[@A-Za-z_$]/.test(t)) {
      if(tokens[i]==='(') {
        if(t.startsWith('@') ? !(t.slice(1) in actions) : Object.hasOwn(actions,t)) fail('ACTION',id,t,'未注册或缺少 @')
        i++;list(')',()=>expression(depth+1))
      } else if(t.startsWith('@')) fail('ACTION',id,t,'缺少参数列表')
    } else if(!t || !/^["\d]/.test(t)) fail('SYNTAX',id,'','需要表达式')
  }
  function expression(depth:number) {
    atom(depth)
    while(binary.has(tokens[i])) {i++;atom(depth)}
    if(tokens[i]==='?') {i++;expression(depth+1);take(':');expression(depth+1)}
  }
  expression(0)
  if(i!==tokens.length) fail('TRAILING',id,'','声明包含多余内容')
}
export interface Statement {id:string;start:number;end:number;expr:Expr;raw:string}
export function indexSource(source:string) {
  if(source.length>500_000) fail('SIZE','','','源码过大')
  const out=new Map<string,Statement>()
  let end=0
  for(const s of split(tokenize(source))) {
    const start=s.start!,stop=s.end??source.length, raw=source.slice(start,stop)
    if(source.slice(end,start).trim() || out.has(s.id)) fail('STATEMENT',s.id,'','未知内容或重复声明')
    if(!/^\$?[a-z_][\w]*$/.test(s.id)) fail('NAME',s.id,'','声明名需要小写字母或下划线开头')
    strictSyntax(raw.slice(raw.indexOf('=')+1),s.id)
    const expr=parseExpression(s.tokens)
    if(!expr) fail('SYNTAX',s.id,'','无法解析')
    out.set(s.id,{id:s.id,start,end:stop,expr,raw}); end=stop
  }
  if(source.slice(end).trim() || !out.size) fail('INCOMPLETE','','','需要完整 OpenUI 声明')
  return out
}
export function print(e:Expr):string {
  switch(e.k) {
    case 'Str': case 'Bool': case 'Num': return JSON.stringify(e.v)
    case 'Null':return 'null'
    case 'Ref':case 'StateRef':return e.n
    case 'Arr':return '['+e.els.map(print).join(', ')+']'
    case 'Obj':return '{'+e.entries.map(([k,v])=>k+': '+print(v)).join(', ')+'}'
    case 'Comp':return (Object.hasOwn(actions,e.name)?'@':'')+e.name+'('+e.args.map(print).join(', ')+')'
    case 'BinOp':return '('+print(e.left)+' '+e.op+' '+print(e.right)+')'
    case 'UnaryOp':return '('+e.op+print(e.operand)+')'
    case 'Ternary':return '('+print(e.cond)+' ? '+print(e.then)+' : '+print(e.else)+')'
    default:throw Error('不支持的表达式 '+e.k)
  }
}
export function literal(e:Expr):boolean {
  return ['Str','Num','Bool','Null'].includes(e.k) || e.k==='Arr'&&e.els.every(literal) || e.k==='Obj'&&e.entries.every(([,x])=>literal(x))
}
export function propertyPatch(s:Statement,key:string,value:unknown,replaceExpression=false) {
  const node=structuredClone(s.expr)
  if(node.k!=='Comp'||node.args[1]?.k!=='Obj') throw Error('需要节点声明')
  const fields=node.args[1].entries,old=fields.find(([k])=>k===key)
  if(old&&!literal(old[1])&&!replaceExpression) throw Error('表达式属性需要显式替换')
  function toExpr(v:unknown):Expr {
    if(v===null)return {k:'Null'}
    if(typeof v==='number'&&Number.isFinite(v))return {k:'Num',v}
    if(typeof v==='boolean')return {k:'Bool',v}
    if(typeof v==='string')return {k:'Str',v}
    if(Array.isArray(v))return {k:'Arr',els:v.map(toExpr)}
    if(typeof v==='object'&&v)return {k:'Obj',entries:Object.entries(v).map(([k,x])=>[k,toExpr(x)])}
    throw Error('无效值')
  }
  if(old)old[1]=toExpr(value);else fields.push([key,toExpr(value)])
  return s.id+' = '+print(node)
}
export function mergeSource(source:string,patch:string) {
  const before=indexSource(source), changes=indexSource(patch)
  const kept=indexSource(mergeStatements(source,patch,'root'))
  let result='',end=0
  for(const s of before.values()) {
    result+=source.slice(end,s.start)
    if(kept.has(s.id))result+=changes.get(s.id)?.raw??s.raw
    end=s.end
  }
  result+=source.slice(end)
  for(const s of changes.values()) if(!before.has(s.id)&&kept.has(s.id))result+='\n'+s.raw
  return result
}
