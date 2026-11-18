import test from 'node:test'
import assert from 'node:assert/strict'
import {harness,source} from './mock-provider'
import {settings} from '../apps/model-gateway/provider'
import {StreamDraft,type Envelope} from '../packages/authoring/stream'
test('official defaults and isolated credentials',()=>{
 assert.equal(settings('TEXT',{}).model,'gpt-6.2-sol');assert.equal(settings('IMAGE',{}).model,'gpt-image-2.6-sunburst')
 assert.equal(settings('TEXT',{TEXT_BASE_URL:'https://other.example/v1',OPENAI_API_KEY:'official'}).apiKey,undefined)
})
test('normal SDK, independent image call, replay and truncated generation',async()=>{
 const h=await harness()
 try{
 const post=async(path:string,body:unknown)=>(await fetch(h.url+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).text()
 const task={txId:crypto.randomUUID(),sceneId:'project',baseRevision:1,mode:'create' as const,source:'',instruction:'create',assets:[]}
 const generate=async(t:typeof task)=>{const text=await post('/api/generate',t);return text.trim().split('\n\n').map(s=>JSON.parse(s.slice(6)) as Envelope)}
 const events=await generate(task);assert.equal(events.at(-1)?.kind,'end',JSON.stringify(events.at(-1)))
 const draft=new StreamDraft(task.txId,task.sceneId,1,'create')
 for(const e of events)await draft.accept(e)
 assert.equal(draft.parts.join(''),source)
 assert.deepEqual(await generate(task),events);assert.equal(h.calls.length,1)
 assert.equal(h.calls[0].auth,'Bearer test-text');assert.equal(h.calls[0].model,'test-language')
 assert.match(await post('/api/generate',{...task,instruction:'different'}),/冲突/)
 assert.ok(JSON.parse(await post('/api/images',{prompt:'texture'})).data)
 assert.deepEqual(h.calls[1],{path:'/image/v1/images/generations',model:'test-image-model',auth:'Bearer test-image'})
 for(const api of ['responses','chat']){
  process.env.TEXT_API=api
  assert.equal((await generate({...task,txId:crypto.randomUUID(),instruction:'TRUNCATE'})).at(-1)?.kind,'error')
  assert.equal((await generate({...task,txId:crypto.randomUUID()})).at(-1)?.kind,'end')
 }
 const config=await(await fetch(h.url+'/api/config')).text();assert.ok(!config.includes('Bearer')&&!config.includes('test-text'))
 }finally{await h.close()}
})
