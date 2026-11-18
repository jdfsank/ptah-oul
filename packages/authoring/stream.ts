import {indexSource,type Statement} from './index'
export const profile='game2d/1.0'
export type Envelope={kind:'begin';txId:string;sceneId:string;baseRevision:number;mode:'create'|'patch';libraryVersion:string}|{kind:'delta';txId:string;seq:number;sourceDelta:string}|{kind:'end';txId:string;lastSeq:number;sourceHash:string}|{kind:'error';txId:string;code:string;message:string}
export async function digest(s:string) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),v=>v.toString(16).padStart(2,'0')).join('')}
export class StreamDraft {
  parts:string[]=[];begun=false;done=false
  constructor(readonly txId:string,readonly sceneId:string,readonly revision:number,readonly mode:'create'|'patch'){}
  async accept(e:Envelope) {
    if(this.done||e.txId!==this.txId)throw Error('事务身份冲突')
    if(e.kind==='error')throw Error(e.message)
    if(e.kind==='begin'){
      if(this.begun||e.sceneId!==this.sceneId||e.libraryVersion!==profile||e.baseRevision!==this.revision||e.mode!==this.mode)throw Error('事务基线不匹配')
      this.begun=true;return
    }
    if(!this.begun)throw Error('缺少 begin')
    if(e.kind==='delta'){
      if(e.seq>0&&e.seq<=this.parts.length&&this.parts[e.seq-1]===e.sourceDelta)return
      if(e.seq!==this.parts.length+1)throw Error('片段序号不连续')
      this.parts.push(e.sourceDelta);return
    }
    if(e.lastSeq!==this.parts.length||e.sourceHash!==await digest(this.parts.join('')))throw Error('事务摘要不匹配')
    this.done=true
  }
}
export function previewStatements(source:string) {
  const out=new Map<string,Statement>()
  // Newlines at depth zero delimit a safe prefix even when the last declaration is incomplete.
  let start=0,depth=0,quote=false,escape=false
  for(let i=0;i<=source.length;i++){
    const c=source[i]
    if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quote=false;continue}
    if(c==='"')quote=true
    else if('([{'.includes(c??' '))depth++
    else if(')]}'.includes(c??' '))depth--
    else if((c==='\n'||i===source.length)&&depth===0){
      try{for(const [id,s] of indexSource(source.slice(start,i)))out.set(id,s)}catch{}
      start=i+1
    }
  }
  return out
}
