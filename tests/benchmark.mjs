import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {once} from 'node:events'
import {build} from 'vite'
import {chromium} from '@playwright/test'
const out=await fs.mkdtemp(path.join(os.tmpdir(),'ptah-bench-'))
let browser,server
try{
 await build({logLevel:'error',configFile:false,build:{outDir:out,emptyOutDir:true,lib:{entry:'tests/performance.ts',formats:['es'],fileName:()=> 'bench.js'}}})
 server=http.createServer(async(req,res)=>{
  if(req.url==='/'){res.setHeader('content-type','text/html');res.end('<main></main>');return}
  try{res.setHeader('content-type','text/javascript');res.end(await fs.readFile(path.join(out,path.basename(req.url))))}catch{res.writeHead(404);res.end()}
 })
 server.listen(0,'127.0.0.1');await once(server,'listening')
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:JSON.parse(process.env.CHROMIUM_ARGS??'["--enable-unsafe-swiftshader","--no-sandbox"]')})
 const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1})
 await page.goto('http://127.0.0.1:'+server.address().port)
 const stats=await page.evaluate(async()=>{const mod=await import('/bench.js');return mod.measure(document.querySelector('main'))})
 console.log(JSON.stringify({cpu:os.cpus()[0]?.model,platform:process.platform,chrome:browser.version(),...stats},null,2))
}finally{if(browser)await browser.close();server?.close();await fs.rm(out,{recursive:true,force:true})}
