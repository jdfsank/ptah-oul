import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {z} from 'zod'
import {createHash} from 'node:crypto'
import {generate,generateImage,publicSettings} from './provider'
import {compile,applyPatch} from '../../packages/scene-compiler'
import {Diagnostic} from '../../packages/authoring'
import {profile,type Envelope} from '../../packages/authoring/stream'
const taskSchema=z.object({txId:z.string().uuid(),sceneId:z.string().min(1).max(150),baseRevision:z.number().int().nonnegative(),mode:z.enum(['create','patch']),source:z.string().max(500000),instruction:z.string().min(1).max(12000),assets:z.array(z.string().max(150)).max(1000).default([]),selection:z.unknown().optional(),repair:z.object({draft:z.string().max(500000),error:z.string().max(3000)}).optional()})

async function body(req:http.IncomingMessage){
  const chunks:Buffer[]=[];let bytes=0
  for await(const c of req){bytes+=c.length;if(bytes>2_000_000)throw Error('请求过大');chunks.push(c)}
  return JSON.parse(Buffer.concat(chunks).toString())
}
function message(e:unknown) {
  if(e instanceof Diagnostic)return e.message
  if(e instanceof Error&&/[\u4e00-\u9fff]/.test(e.message)&&!('status' in e))return e.message.slice(0,500)
  return '模型服务请求失败'+(e&&typeof e==='object'&&'status' in e?' (HTTP '+Number(e.status)+')':'')+'，请检查服务端配置或重试'
}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const dist=path.resolve('dist')
export function createGateway(){
const history=new Map<string,{fingerprint:string;events:Envelope[];finished:boolean}>()
return http.createServer(async(req,res)=>{
  const url=new URL(req.url??'/', 'http://localhost'),route=url.pathname
  function json(status:number,data:unknown){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data))}
  if(req.method==='GET'&&route==='/api/config')return json(200,publicSettings())
  if(req.method==='GET'&&!route.startsWith('/api/')){
    try{
      const name=path.resolve(dist,'.'+decodeURIComponent(route==='/'?'/index.html':route))
      if(!name.startsWith(dist+path.sep))return json(404,{error:'不存在'})
      const data=await fs.readFile(name),ext=path.extname(name)
      const types:Record<string,string>={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.map':'application/json'}
      res.writeHead(200,{'content-type':types[ext]??'application/octet-stream'});return res.end(data)
    }catch{return json(404,{error:'未找到，先执行 npm run build'})}
  }
  if(req.method!=='POST'||!['/api/generate','/api/images'].includes(route))return json(404,{error:'不存在'})
  if(!req.headers['content-type']?.startsWith('application/json')||req.headers['sec-fetch-site']==='cross-site')return json(403,{error:'需要同源 JSON 请求'})
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),240000)
  res.once('close',()=>{if(!res.writableEnded)controller.abort()})
  try{
    let data
    try{data=await body(req)}catch{return json(400,{error:'JSON 请求无效或过大'})}
    if(route==='/api/images'){
      const p=z.object({prompt:z.string().trim().min(1).max(12000)}).parse(data)
      return json(200,await generateImage(p.prompt,controller.signal))
    }
    const t=taskSchema.parse(data),fp=hash(JSON.stringify(t)),old=history.get(t.txId)
    if(old&&(old.fingerprint!==fp||!old.finished))return json(409,{error:'事务冲突或仍在执行'})
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','x-accel-buffering':'no'});res.flushHeaders()
    const send=(e:Envelope)=>res.write('data: '+JSON.stringify(e)+'\n\n')
    if(old){old.events.forEach(send);res.end();return}
    for(const [id,rec] of history){if(history.size<64)break;if(rec.finished)history.delete(id)}
    const record={fingerprint:fp,events:[] as Envelope[],finished:false};history.set(t.txId,record)
    const emit=(e:Envelope)=>{record.events.push(e);send(e)}
    emit({kind:'begin',txId:t.txId,sceneId:t.sceneId,baseRevision:t.baseRevision,mode:t.mode,libraryVersion:profile})
    try{
      let seq=0,source=''
      for await(const delta of generate(t,controller.signal)){source+=delta;if(source.length>500000)throw Error('输出过大');emit({kind:'delta',txId:t.txId,seq:++seq,sourceDelta:delta})}
      if(t.mode==='create')compile(source,t.assets);else applyPatch(compile(t.source,t.assets),source,t.assets)
      if(controller.signal.aborted)throw Error('事务已取消')
      emit({kind:'end',txId:t.txId,lastSeq:seq,sourceHash:hash(source)})
    }catch(e){emit({kind:'error',txId:t.txId,code:e instanceof Diagnostic?e.code:'PROVIDER',message:message(e)})}
    record.finished=true;res.end()
  }catch(e){if(!res.headersSent)json(e instanceof z.ZodError?400:502,{error:e instanceof z.ZodError?'请求字段无效':message(e)})}
  finally{clearTimeout(timer)}
})
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)createGateway().listen(Number(process.env.PORT||8787),process.env.HOST||'127.0.0.1',()=>console.log('Ptah listening on port '+(process.env.PORT||8787)))
