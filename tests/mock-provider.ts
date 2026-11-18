import http from 'node:http'
import fs from 'node:fs'
import {once} from 'node:events'
import type {AddressInfo} from 'node:net'
import {createGateway} from '../apps/model-gateway/server'
export const source=fs.readFileSync('tests/fixtures/platformer.oui','utf8')
export const colorPatch=source.split('\n').find(s=>s.startsWith('player_visual ='))!.replace('#38BDF8','#F97316')
export const speedPatch=source.split('\n').find(s=>s.startsWith('move ='))!.replace('260','180')
export async function bind(server:http.Server) {server.listen(0,'127.0.0.1');await once(server,'listening');return 'http://127.0.0.1:'+(server.address() as AddressInfo).port}
export async function harness() {
 const calls:{path:string;model:string;auth:string|undefined}[]=[]
 const upstream=http.createServer(async(req,res)=>{
   const chunks=[];for await(const data of req)chunks.push(data)
   const body=JSON.parse(Buffer.concat(chunks).toString());calls.push({path:req.url!,model:body.model,auth:req.headers.authorization})
   if(req.url?.endsWith('images/generations')){
     res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{b64_json:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}]}));return
   }
   const string=JSON.stringify(body.input??body.messages)
   const text=string.includes('PATCH_PLAYER')?colorPatch+'\n'+speedPatch:string.includes('INVALID')&&!string.includes('SYNTAX')?'root = GameProject(':source
   const incomplete=string.includes('TRUNCATE')
   res.writeHead(200,{'content-type':'text/event-stream'})
   const send=(event:unknown)=>res.write('data: '+JSON.stringify(event)+'\n\n')
   if(req.url?.endsWith('chat/completions')){
     for(const [delta,reason] of [[{role:'assistant',content:text},null],[{},incomplete?'length':'stop']])send({id:'chatcmpl_1',object:'chat.completion.chunk',model:body.model,created:1,choices:[{index:0,delta,finish_reason:reason}]})
     return res.end('data: [DONE]\n\n')
   }
   const message={id:'msg_1',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]}
   const data={id:'resp_1',object:'response',model:body.model,output:[message],usage:{input_tokens:5,output_tokens:5,total_tokens:10},status:incomplete?'incomplete':'completed'}
   send({type:'response.created',response:{...data,status:'in_progress',output:[]}})
   for(let i=0;i<text.length;i+=180)send({type:'response.output_text.delta',item_id:message.id,output_index:0,content_index:0,delta:text.slice(i,i+180)})
   send({type:incomplete?'response.incomplete':'response.completed',response:data});res.end()
 })
 const upstreamUrl=await bind(upstream)
 const saved={...process.env}
 Object.assign(process.env,{TEXT_BASE_URL:upstreamUrl+'/text/v1',TEXT_API_KEY:'test-text',TEXT_MODEL:'test-language',TEXT_API:'responses',IMAGE_BASE_URL:upstreamUrl+'/image/v1',IMAGE_API_KEY:'test-image',IMAGE_MODEL:'test-image-model'})
 const server=createGateway(),url=await bind(server)
 return {url,calls,close:async()=>{for(const key of ['TEXT_BASE_URL','TEXT_API_KEY','TEXT_MODEL','TEXT_API','IMAGE_BASE_URL','IMAGE_API_KEY','IMAGE_MODEL']){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key]}await Promise.all([server,upstream].map(s=>new Promise<void>(ok=>{s.close(()=>ok());s.closeAllConnections()})))}}
}
