import OpenAI from 'openai'
import { Agent, Runner, OpenAIProvider, setTracingDisabled } from '@openai/agents'
import {readFileSync} from 'node:fs'
import {signatures} from '../../packages/game-schema'
import {actions} from '../../packages/authoring'
import {compile} from '../../packages/scene-compiler'
setTracingDisabled(true)
export const sample=readFileSync(new URL('../../tests/fixtures/platformer.oui',import.meta.url),'utf8')
const official='https://api.openai.com/v1'
export function settings(kind:'TEXT'|'IMAGE',env=process.env) {
  const baseURL=env[kind+'_BASE_URL']||official
  const url=new URL(baseURL)
  if(url.username||url.password||url.search||url.hash||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('模型服务地址无效')
  const apiKey=env[kind+'_API_KEY']||(url.origin==='https://api.openai.com'?env.OPENAI_API_KEY:undefined)
  return {baseURL,apiKey,model:env[kind+'_MODEL']||(kind==='TEXT'?'gpt-6.2-sol':'gpt-image-2.6-sunburst')}
}
export function publicSettings() {
  return Object.fromEntries((['TEXT','IMAGE'] as const).map(k=>{const {model,baseURL,apiKey}=settings(k);return [k,{model,baseURL,configured:!!apiKey}]}))
}
export interface Task {txId:string;sceneId:string;baseRevision:number;mode:'create'|'patch';source:string;instruction:string;assets:string[];selection?:unknown;repair?:{draft:string;error:string}}
function contextSource(task:Task) {
  if(task.mode!=='patch'||task.source.length<40000||!Array.isArray(task.selection)||!task.selection.length)return task.source
  const scene=compile(task.source,task.assets),keep=new Set<string>(['root',scene.entry.statement])
  function include(id:string,levels:number){const n=scene.nodes.get(id);if(!n)return;keep.add(n.statement);if(levels>0)n.children.forEach(c=>include(c,levels-1))}
  for(const selection of task.selection){
    if(typeof selection?.authorId!=='string')continue
    const n=scene.nodes.get(selection.authorId);if(!n)continue
    include(n.id,2)
    if(n.parent)include(n.parent,1)
    for(let a=n;a.parent;){const parent=scene.nodes.get(a.parent)!;keep.add(parent.statement);a=parent}
  }
  for(const n of scene.nodes.values())if(['ResourceRegistry','PrefabRegistry'].includes(n.type))include(n.id,2)
  return [...scene.index.values()].filter(s=>s.id.startsWith('$')||keep.has(s.id)).map(s=>s.raw).join('\n')
}
export async function* generate(task:Task,signal:AbortSignal) {
  const cfg=settings('TEXT')
  if(!cfg.apiKey)throw Error('请在服务端配置 TEXT_API_KEY')
  const chat=process.env.TEXT_API==='chat'
  let stopped=false
  // Chat adapters can hide finish_reason in normalized SDK events. Inspect the same byte stream.
  const observe:typeof fetch=async(input,init)=>{
    const res=await fetch(input,init)
    if(!chat||!res.ok||!res.body)return res
    const decoder=new TextDecoder();let pending=''
    const body=res.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){
      pending+=decoder.decode(chunk,{stream:true})
      const lines=pending.split('\n');pending=lines.pop()!
      for(const line of lines)if(line.startsWith('data:')){
        const payload=line.slice(5).trim()
        if(payload&&payload!=='[DONE]'){const item=JSON.parse(payload);const reason=item.choices?.[0]?.finish_reason;if(reason)stopped=reason==='stop'}
      }
      controller.enqueue(chunk)
    }}))
    return new Response(body,{status:res.status,headers:res.headers})
  }
  const client=new OpenAI({apiKey:cfg.apiKey,baseURL:cfg.baseURL,fetch:observe,maxRetries:0})
  const provider=new OpenAIProvider({openAIClient:client,useResponses:!chat})
  const runner=new Runner({modelProvider:provider,tracingDisabled:true})
  const agent=new Agent({name:'Ptah level author',model:cfg.model,instructions:[
    'You author playable game2d/1.0 levels. Output only complete OpenUI Lang statements, no markdown. Put root first on creation. No scripts, URLs or tools. Named nodes have three arguments: stable id string, properties, static child references. Only one parent per node. Physics bodies require exactly one shape. Use only the provided asset IDs with a root-reachable ResourceRegistry and Texture. Use original examples as grammar reference.',
    task.mode==='patch'?'Return only changed or new declarations. Keep stable identities, unrelated properties and names. Focus on selected nodes and required dependencies.':'Create a complete reachable level with working movement, score, goal and restart. Use a coherent illustrated scene of colored polygons.',
    'Schema (each line lists allowed properties):',signatures,'Actions: '+Object.keys(actions).join(', '),'Reference level:',sample
  ].join('\n')})
  const result=await runner.run(agent,JSON.stringify({request:task.instruction,baseline:contextSource(task),assets:task.assets,selection:task.selection,repair:task.repair}),{stream:true,maxTurns:1,signal})
  let completed=false
  for await(const event of result)if(event.type==='raw_model_stream_event'){
    const data=event.data
    if(data.type==='output_text_delta')yield data.delta
    if(data.type==='response_done')completed=chat?stopped:data.response.providerData?.status==='completed'
  }
  await result.completed
  if(!completed||signal.aborted)throw Error('模型未正常完成输出')
}
export async function generateImage(prompt:string,signal:AbortSignal) {
  const cfg=settings('IMAGE')
  if(!cfg.apiKey)throw Error('请在服务端配置 IMAGE_API_KEY')
  const result=await new OpenAI({apiKey:cfg.apiKey,baseURL:cfg.baseURL,maxRetries:0}).images.generate({model:cfg.model,prompt,n:1,size:'1024x1024'},{signal})
  const data=result.data?.[0]?.b64_json
  if(!data||data.length>16_000_000)throw Error('生图服务需返回有效的 base64 图像')
  return {assetId:'tex_'+crypto.randomUUID().replaceAll('-',''),data}
}
