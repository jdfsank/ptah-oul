import { walkAST } from '@openuidev/lang-core'
import {actions,fail,indexSource,literal,mergeSource,type Expr,type Statement} from '../authoring'
import {schemas,visualHot} from '../game-schema'
export type Values=Record<string,any>
export function value(e:Expr,state:Values):any {
  switch(e.k){
    case 'Str':case 'Num':case 'Bool':return e.v
    case 'Null':return null
    case 'Arr':return e.els.map(x=>value(x,state))
    case 'Obj':return Object.fromEntries(e.entries.map(([k,x])=>[k,value(x,state)]))
    case 'StateRef':return state[e.n]
    case 'Comp':return e
    case 'UnaryOp':return e.op==='!'?!value(e.operand,state):-value(e.operand,state)
    case 'Ternary':return value(value(e.cond,state)?e.then:e.else,state)
    case 'BinOp':{
      const a=value(e.left,state),b=value(e.right,state)
      switch(e.op){case '+':return a+b;case '-':return a-b;case '*':return a*b;case '/':return a/b;case '%':return a%b;case '==':return a===b;case '!=':return a!==b;case '<':return a<b;case '>':return a>b;case '<=':return a<=b;case '>=':return a>=b;case '&&':return a&&b;case '||':return a||b}
    }
  }
  throw Error('不支持的表达式 '+e.k)
}
export interface NodeDef {id:string;statement:string;type:string;props:Values;fields:Record<string,Expr>;children:string[];parent?:string}
export interface Scene {source:string;nodes:Map<string,NodeDef>;index:Map<string,Statement>;defaults:Values;root:NodeDef;entry:NodeDef}
const bodies=['CharacterBody2D','StaticBody2D','Area2D']
function verifyAction(expr:Expr,id:string,path:string,nodes:Map<string,NodeDef>,defaults:Values) {
  if(expr.k!=='Comp')fail('ACTION',id,path,'需要动作调用')
  if(expr.name==='Action'){
    if(expr.args.length!==1||expr.args[0].k!=='Arr')fail('ACTION',id,path,'需要动作数组')
    expr.args[0].els.forEach(x=>verifyAction(x,id,path,nodes,defaults));return
  }
  if(!Object.hasOwn(actions,expr.name)||!actions[expr.name].includes(expr.args.length))fail('ACTION',id,path,expr.name)
  const [target,arg]=expr.args
  if(['Set','Reset'].includes(expr.name)){
    if(target&&(target.k!=='StateRef'||!Object.hasOwn(defaults,target.n)))fail('STATE',id,path,'未知变量')
  }else if(target){
    if(target.k!=='Str')fail('TARGET',id,path,'目标必须为字符串')
    const dest=nodes.get(target.v)
    if(expr.name!=='EmitGameEvent'&&!dest)fail('TARGET',id,path,target.v)
    if(expr.name==='Spawn'&&dest?.type!=='Prefab'||expr.name==='RestartScene'&&dest?.type!=='Scene2D'||['StartTimer','StopTimer'].includes(expr.name)&&dest?.type!=='Timer')fail('TARGET',id,path,'目标类型不匹配')
  }
  if(arg&&['SetVisible','SetEnabled','SetInputEnabled'].includes(expr.name)&&typeof value(arg,defaults)!=='boolean')fail('TYPE',id,path,'需要布尔值')
}
// Editor, persistence and runtime share the same immutable, fully validated definition.
const recent:{assets:string;scene:Scene}[]=[]
function remember(scene:Scene,assets:string[]){
  recent.unshift({assets:JSON.stringify(assets),scene})
  if(recent.length>3)recent.pop()
  return scene
}
export function compile(source:string,assets:Iterable<string>=[]):Scene {
  const ids=[...assets],signature=JSON.stringify(ids),cached=recent.find(item=>item.scene.source===source&&item.assets===signature)
  return cached?.scene??remember(compileIndex(source,indexSource(source),ids,false),ids)
}
function compileIndex(source:string,index:Map<string,Statement>,assets:Iterable<string>,allowDetached:boolean,previous?:Scene):Scene {
  const nodes=new Map<string,NodeDef>(),defaults:Values=Object.create(null),byStatement=new Map<string,string>(),assetIds=new Set(assets)
  for(const s of index.values())if(s.id.startsWith('$')){
    if(!literal(s.expr))fail('STATE',s.id,'','默认值必须是字面量')
    defaults[s.id]=value(s.expr,{})
  }
  const reuse=previous&&JSON.stringify(previous.defaults)===JSON.stringify(defaults)?previous:undefined
  for(const s of index.values()){
    if(s.id.startsWith('$'))continue
    if(reuse&&reuse.index.get(s.id)?.expr===s.expr&&s.expr.k==='Comp'&&s.expr.args[0].k==='Str'&&s.expr.args[2].k==='Arr'){
      const old=reuse.nodes.get(s.expr.args[0].v)!
      if(nodes.has(old.id))fail('IDENTITY',s.id,'','重复的节点身份')
      nodes.set(old.id,{...old,parent:undefined,children:s.expr.args[2].els.map(x=>x.k==='Ref'?x.n:fail('CHILD',s.id,'','需要引用'))})
      byStatement.set(s.id,old.id);continue
    }
    const e=s.expr
    if(e.k!=='Comp'||!Object.hasOwn(schemas,e.name)||e.args.length!==3)fail('NODE',s.id,'','需要已注册的三参数节点')
    const [id,obj,refs]=e.args
    if(id.k!=='Str'||!id.v||nodes.has(id.v)||obj.k!=='Obj'||refs.k!=='Arr')fail('IDENTITY',s.id,'','无效或重复的节点身份')
    const props=value(obj,defaults),fields=Object.fromEntries(obj.entries)
    for(const [key,expr] of obj.entries) {
      if(!['text','visible','action','states','transitions'].includes(key)&&!literal(expr))fail('DYNAMIC',s.id,key,'需要静态值')
      walkAST(expr,x=>{
        if(x.k==='Ref'||x.k==='StateRef'&&!Object.hasOwn(defaults,x.n))fail('REFERENCE',s.id,key,'未知引用')
        if(x.k==='Comp'&&(!['action','states'].includes(key)||x.name!=='Action'&&!Object.hasOwn(actions,x.name)))fail('CALL',s.id,key,x.name)
      })
    }
    const checked=schemas[e.name].safeParse(props)
    if(!checked.success){const p=checked.error.issues[0];fail('SCHEMA',s.id,p.path.join('.'),p.message)}
    const children=refs.els.map(x=>x.k==='Ref'?x.n:fail('CHILD',s.id,'children','需要静态引用'))
    nodes.set(id.v,{id:id.v,type:e.name,statement:s.id,props,fields,children});byStatement.set(s.id,id.v)
  }
  const root=nodes.get(byStatement.get('root')??'')
  if(root?.type!=='GameProject')fail('ROOT','root','','需要 GameProject')
  const entry=nodes.get(root.props.entry_scene)
  if(entry?.type!=='Scene2D')fail('ENTRY','root','entry_scene','场景不存在')
  for(const n of nodes.values())n.children=n.children.map(ref=>{
    const child=nodes.get(byStatement.get(ref)??'')
    if(!child||child.parent||child===root)fail('CHILD',n.statement,ref,'引用不存在、循环或多父节点')
    child.parent=n.id; return child.id
  })
  const seen=new Set<string>()
  function visit(n:NodeDef,distorted:boolean,depth:number) {
    if(depth>96||seen.has(n.id))fail('TREE',n.statement,'','循环或深度超限')
    seen.add(n.id);const p=n.props
    distorted ||= !!p.rotation || !!p.scale&&p.scale.some((v:number)=>v!==1)
    if(distorted && bodies.includes(n.type))fail('PHYSICS',n.statement,'transform','碰撞节点祖先必须保持轴对齐和单位缩放')
    n.children.forEach(id=>visit(nodes.get(id)!,distorted,depth+1))
  }
  visit(root,false,0)
  if(!allowDetached&&seen.size!==nodes.size)fail('UNREACHABLE',[...nodes.values()].find(n=>!seen.has(n.id))!.statement,'','未从 root 引用')
  if(!root.children.includes(entry.id))fail('ENTRY','root','entry_scene','入口须为直接子场景')
  const registered=new Set([...nodes.values()].filter(n=>n.type==='Texture'&&nodes.get(n.parent!)?.type==='ResourceRegistry').map(n=>n.props.asset_id))
  for(const n of nodes.values()){
    const p=n.props,parent=nodes.get(n.parent??''),bad=(path:string,why:string):never=>fail('SEMANTIC',n.statement,path,why)
    if(bodies.includes(n.type)&&n.children.filter(id=>nodes.get(id)?.type==='CollisionShape2D').length!==1)bad('children','需要一个碰撞形状')
    if(n.type==='CollisionShape2D'&&(!bodies.includes(parent?.type??'')||p.shape.type==='CircleShape2D'&&parent?.type!=='Area2D'))bad('shape','形状或父节点不兼容')
    if(n.type.endsWith('Controller')&&parent?.type!=='CharacterBody2D')bad('parent','控制器属于角色')
    if(n.type==='Texture'&&(!assetIds.has(p.asset_id)||!registered.has(p.asset_id)))bad('asset_id','资源未登记')
    for(const tex of [p.texture,...Object.values(p.animations??{}).flatMap((a:any)=>a.frames)].filter(Boolean))if(!registered.has(tex))bad('texture','未知纹理 '+tex)
    if(n.type==='AnimatedSprite2D'&&!Object.hasOwn(p.animations,p.animation))bad('animation','动画不存在')
    if(n.type==='Prefab'&&(parent?.type!=='PrefabRegistry'||n.children.length!==1))bad('children','模板需在注册表下且仅有一个根')
    if(n.type==='Spawner'&&nodes.get(p.template)?.type!=='Prefab')bad('template','模板不存在')
    if(n.type==='Camera2D'&&p.follow&&!nodes.has(p.follow))bad('follow','目标不存在')
    if(n.fields.action)verifyAction(n.fields.action,n.statement,'action',nodes,defaults)
    if(n.type==='StateMachine'){
      const names=new Set(p.states.map((x:any)=>x.name))
      if(!names.has(p.initial)||names.size!==p.states.length)bad('states','无效状态')
      for(const st of p.states)for(const k of ['on_enter','on_exit'])if(st[k])verifyAction(st[k],n.statement,k,nodes,defaults)
      for(const t of p.transitions)if(!names.has(t.from)||!names.has(t.to))bad('transitions','引用未知状态')
    }
  }
  return {source,index,nodes,root,entry,defaults}
}
export function applyPatch(scene:Scene,patch:string,assets:Iterable<string>=[]) {
  const changes=indexSource(patch),raw=new Map(scene.index),assetIds=[...assets]
  for(const [id,s] of changes){
    const previous=raw.get(id)?.expr
    if(s.expr.k==='Null'){
      if(!previous)fail('DELETE',id,'','待删除声明不存在')
      raw.delete(id)
    }else{
      if(previous?.k==='Comp'&&s.expr.k==='Comp'&&previous.args[0]?.k==='Str'&&s.expr.args[0]?.k==='Str'&&previous.args[0].v!==s.expr.args[0].v)fail('IDENTITY',id,'','补丁必须保留稳定身份')
      raw.set(id,s)
    }
  }
  const candidate=compileIndex('',raw,assetIds,true,scene)
  const merged=mergeSource(scene.source,patch,scene.index,changes)
  if(merged.source.length>500000)fail('SIZE','','','源码过大')
  for(const [id,s] of changes)if(s.expr.k!=='Null'&&!merged.index.has(id))fail('UNREACHABLE',id,'','补丁声明被剪除')
  // An identical declaration set has already passed all semantic checks. GC requires a second graph check.
  const result=raw.size===merged.index.size?{...candidate,...merged}:compileIndex(merged.source,merged.index,assetIds,false,candidate)
  return remember(result,assetIds)
}
export function hotCompatible(a:Scene,b:Scene) {
  if(a.nodes.size!==b.nodes.size||JSON.stringify(a.defaults)!==JSON.stringify(b.defaults))return false
  for(const [id,x] of a.nodes){
    const y=b.nodes.get(id)
    if(!y||x.type!==y.type||x.parent!==y.parent||x.children.join('\0')!==y.children.join('\0'))return false
    for(const key of new Set([...Object.keys(x.fields),...Object.keys(y.fields)]))
      if(JSON.stringify(x.fields[key])!==JSON.stringify(y.fields[key])&&!visualHot.has(key))return false
  }
  return true
}
