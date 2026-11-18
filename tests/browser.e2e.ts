import test from 'node:test'
import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
import {harness} from './mock-provider'
import {importProject} from '../packages/project-io'
import {compile} from '../packages/scene-compiler'
test('create, play, inspect, patch, generate image, export, reload and import', {timeout:120000},async()=>{
 const h=await harness()
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:JSON.parse(process.env.CHROMIUM_ARGS??'["--enable-unsafe-swiftshader","--no-sandbox"]')})
 try{
  const page=await browser.newPage({viewport:{width:1440,height:960}})
  const failures:string[]=[];page.on('pageerror',e=>failures.push(e.message))
  await page.goto(h.url);await expect(page.locator('canvas')).toBeVisible();await expect(page.getByRole('heading',{name:'暮光遗迹.oui'})).toBeVisible()
  await page.getByLabel('创作任务').selectOption('create');await page.getByLabel('创作指令').fill('CREATE_TEST_LEVEL');await page.getByLabel('发送指令').click()
  await expect(page.locator('footer')).toContainText('R2')
  await page.getByRole('button',{name:'试玩关卡'}).click()
  await page.keyboard.down('KeyD');await expect(page.getByLabel('试玩 HUD')).toContainText('通关',{timeout:20000});await page.keyboard.up('KeyD')
  await page.getByRole('button',{name:'暂停检查',exact:true}).click()
  await page.getByRole('button',{name:'展开 角色',exact:true}).click()
  await page.getByRole('button',{name:'player_visual',exact:true}).first().click()
  await page.getByLabel('创作任务').selectOption('patch');await page.getByLabel('创作指令').fill('PATCH_PLAYER');await page.getByLabel('发送指令').click()
  await expect(page.getByRole('dialog')).toContainText('move')
  await page.getByRole('button',{name:'提交 2 项修改'}).click()
  await expect(page.locator('footer')).toContainText('R3');await expect(page.getByLabel('试玩 HUD')).toContainText('金币 1')
  await page.getByRole('button',{name:'编辑选取',exact:true}).click()
  await page.getByLabel('创作任务').selectOption('image');await page.getByLabel('创作指令').fill('small crystal');await page.getByLabel('发送指令').click()
  await expect(page.locator('footer')).toContainText('R4',{timeout:12000}).catch(async e=>{throw Error(String(e)+' '+await page.locator('.feedback').allTextContents())})
  await page.evaluate(()=>{document.addEventListener('click',e=>{const el=e.target;if(el instanceof HTMLAnchorElement&&el.download)document.body.dataset.archive=el.href},true)
   const create=URL.createObjectURL.bind(URL);URL.createObjectURL=obj=>{const url=create(obj);if(obj instanceof Blob&&obj.type==='application/zip')document.body.dataset.archive=url;return url}
  })
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出项目',exact:true}).click()
  assert.match((await download).suggestedFilename(),/\.ptah\.zip$/)
  const bytes=Buffer.from(await page.evaluate(async()=>Array.from(new Uint8Array(await(await fetch(document.body.dataset.archive!)).arrayBuffer()))))
  const project=importProject(bytes),scene=compile(project.source,project.assets.map(a=>a.id))
  assert.equal(scene.nodes.get('move')?.props.speed,180);assert.equal(scene.nodes.get('player_visual')?.props.color,'#F97316');assert.equal(project.assets.length,1);assert.equal(project.annotations[0].authorId,'player_visual')
  await page.reload();await expect(page.locator('footer')).toContainText('R4')
  await page.getByRole('button',{name:'项目与示例',exact:true}).click();await page.getByRole('button',{name:/晶石回廊/}).click()
  await expect(page.locator('footer')).toContainText('R1')
  await page.locator('input[type=file]').setInputFiles({name:'recovered.zip',mimeType:'application/zip',buffer:bytes})
  await expect(page.locator('footer')).toContainText('R4');await expect(page.getByRole('heading',{name:'暮光遗迹.oui'})).toBeVisible()
  await page.setViewportSize({width:390,height:780});await expect(page.locator('canvas')).toBeVisible()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  assert.deepEqual(failures,[])
 }finally{await browser.close();await h.close()}
})
