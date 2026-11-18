import {useEffect,useMemo,useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Layers3,Play,Pause,RotateCcw,MousePointer2,Grid2X2,Maximize2,ChevronRight,ChevronDown,Box,Diamond,UserRound,Mountain,Shapes,Flag,Monitor,Timer,Network,Code2,Sparkles,ArrowUp,Plus,Download,Upload,Save,History,FolderOpen,SlidersHorizontal,ImagePlus,Settings2,X,Check,Pin,Undo2,Scan,Square,PanelLeft,Search,Keyboard,Eye,Move,Braces,Image as ImageIcon,Expand,GitBranch,Menu,ArrowUpLeft} from 'lucide-react'
import type {LucideIcon} from 'lucide-react'
import twilight from './examples/twilight.oui?raw'
import platformer from '../../tests/fixtures/platformer.oui?raw'
import topdown from '../../tests/fixtures/topdown.oui?raw'
import {compile,applyPatch,value,type NodeDef} from '../../packages/scene-compiler'
import {indexSource,literal,print,propertyPatch} from '../../packages/authoring'
import {World} from '../../packages/runtime'
import {fresh,loadProject,saveProject,importProject,exportProject,commit,undoTarget,checkPNG,type Project,type Annotation,type Asset} from '../../packages/project-io'
import {Canvas,type Mode} from './Canvas'
import {requestSource,draftScene} from './model'
import type {Point} from '../../packages/editor-tools'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-700.css'
import '@fontsource/barlow-condensed/latin-700.css'
import './studio.css'
const examples=[{name:'暮光遗迹',kind:'平台跳跃',source:twilight},{name:'晶石回廊',kind:'俯视收集',source:topdown},{name:'初始试炼',kind:'平台跳跃',source:platformer}]
const iconFor=(n:NodeDef):LucideIcon=>({GameProject:FolderOpen,Scene2D:Layers3,CharacterBody2D:UserRound,StaticBody2D:Mountain,Area2D:n.id==='goal'?Flag:Diamond,Polygon2D:Shapes,CollisionShape2D:Scan,CanvasLayer:Monitor,StateMachine:Network,Timer,Sprite2D:ImageIcon,Label:Braces,Node2D:Layers3}[n.type]??Box)
const names:Record<string,string>={main:'主场景',move:'移动控制器',flow:'通关逻辑',hud:'游戏界面',player:'角色',floor:'地面',goal:'出口',coin:'晶石'}
const title=(n:NodeDef)=>n.props.name||names[n.id]||n.id
const blankProject=()=>fresh('暮光遗迹',twilight)
function Tool({icon:Icon,label,onClick,active,disabled}:{icon:LucideIcon;label:string;onClick:()=>void;active?:boolean;disabled?:boolean}){return <button type="button" className={'iconbtn '+(active?'active':'')} title={label} aria-label={label} onClick={onClick} disabled={disabled}><Icon size={16}/></button>}
function Sheet({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}){return <dialog ref={el=>{if(el&&!el.open)el.showModal()}} onCancel={close}><header><h2>{title}</h2><Tool icon={X} label="关闭" onClick={close}/></header>{children}</dialog>}
function App({initial}:{initial:Project}){
 const [p,setProject]=useState(initial),current=useRef(initial)
 const setP=(v:Project)=>{current.current=v;setProject(v)}
 const scene=useMemo(()=>compile(p.source,p.assets.map(a=>a.id)),[p.source,p.assets])
 const [world,setWorld]=useState<World>(),[mode,setMode]=useState<Mode>('edit'),[selected,select]=useState<string[]>(['/player']),[anchor,setAnchor]=useState<Point>([0,0])
 const [section,setSection]=useState('scene'),[view,setView]=useState('canvas'),[open,setOpen]=useState(new Set([scene.entry.id])),[search,setSearch]=useState(''),[dialog,setDialog]=useState(''),[mobilePane,setMobilePane]=useState('')
 const [inspectTab,setInspectTab]=useState('properties'),[grid,setGrid]=useState(false),[zoom,setZoom]=useState(1),[prompt,setPrompt]=useState(''),[task,setTask]=useState<'patch'|'create'|'image'>('patch'),[scope,setScope]=useState<'instance'|'template'>('instance')
 const [busy,setBusy]=useState(false),[draft,setDraft]=useState(''),[draftMode,setDraftMode]=useState<'patch'|'create'>('patch'),[error,setError]=useState(''),[saved,setSaved]=useState('保存中'),[info,setInfo]=useState(''),[code,setCode]=useState(p.source),[config,setConfig]=useState<Record<string,{model:string;baseURL:string;configured:boolean}>>({})
 const [staged,setStaged]=useState<{source:string;base:number;txId:string;label:string;notes:Annotation[];changed:string[]}|null>(null)
 const abort=useRef<AbortController|undefined>(undefined),file=useRef<HTMLInputElement>(null),canvasPanel=useRef<HTMLElement>(null),promptBox=useRef<HTMLTextAreaElement>(null),serial=useRef(0)
 const liveScene=mode==='edit'?scene:world?.scene??scene
 const inst=mode==='edit'?undefined:world?.instances.get(selected[0]),node=mode!=='edit'&&inst?inst.def:scene.nodes.get(selected[0]?.slice(1)),isInstance=mode!=='edit'&&!!inst?.scope
 const draftView=useMemo(()=>draft?draftScene(scene,draft,draftMode):undefined,[draft,scene,draftMode])
 useEffect(()=>{const id=++serial.current;setSaved('保存中');saveProject(p).then(()=>{if(serial.current===id)setSaved('已保存')}).catch(()=>{if(serial.current===id)setSaved('未保存')})},[p])
 useEffect(()=>{setCode(p.source)},[p.source])
 useEffect(()=>{fetch('/api/config').then(r=>r.json()).then(setConfig).catch(()=>{})},[])
 useEffect(()=>{if(!info)return;const t=setTimeout(()=>setInfo(''),4500);return ()=>clearTimeout(t)},[info])
 function run(f:()=>void){try{setError('');f()}catch(e){setError((e as Error).message)}}
 function apply(source:string,label:string,base=p.revision,txId:string=crypto.randomUUID(),notes:Annotation[]=[],assets=p.assets,reverts?:string){
   const old=current.current,next=commit({...old,assets,annotations:[...old.annotations,...notes]},source,label,base,txId)
   if(reverts&&next!==old)next.history[next.history.length-1].reverts=reverts
   if(world)world.update(compile(next.source,assets.map(a=>a.id)),next.revision)
   setP(next);setInfo(label);setDraft('')
 }
 function replace(next:Project){
   abort.current?.abort();setWorld(undefined);setMode('edit');setP(next);setDraft('');setStaged(null);setError('');setView('canvas');setDialog('');select([]);setOpen(new Set([compile(next.source,next.assets.map(a=>a.id)).entry.id]))
 }
 function play(restart=false){run(()=>{
   if(mode==='play'&&!restart){setMode('inspect');return}
   if(!world||restart||mode==='edit'||world.pendingRestart){setWorld(new World(scene,p.revision));select([])}
   setMode('play');setView('canvas');setDraft('')
 })}
 function pick(key:string,multi=false){select(prev=>multi?(prev.includes(key)?prev.filter(k=>k!==key):[...prev,key]):[key]);setInspectTab('properties');setScope('instance')}
 function editProp(id:string,key:string,v:unknown,explicit=false){run(()=>{
   if(mode!=='edit'&&world?.pendingRestart)throw Error('请切换编辑模式，以最新版本为基线')
   const n=scene.nodes.get(id);if(!n)throw Error('对象已删除')
   if(isInstance&&scope==='instance'&&inst){
     if(!['visible','text','color','speed','modulate'].includes(key))throw Error('此属性需要修改模板并重新试玩')
     const patch=propertyPatch(scene.index.get(n.statement)!,key,v,explicit)
     applyPatch(scene,patch,p.assets.map(a=>a.id));inst.overrides[key]=v;select([...selected]);setInfo('已更新本次试玩实例');return
   }
   const patch=propertyPatch(scene.index.get(n.statement)!,key,v,explicit)
   apply(applyPatch(scene,patch,p.assets.map(a=>a.id)).source,'修改 '+title(n)+' · '+key)
 })}
 function undo(){run(()=>{const h=undoTarget(p);if(h)apply(h.before,'撤销 '+h.label,p.revision,crypto.randomUUID(),[],p.assets,h.txId)})}
 function exportFile(){run(()=>{const data=exportProject(p),url=URL.createObjectURL(new Blob([new Uint8Array(data)],{type:'application/zip'})),a=document.createElement('a');a.href=url;a.download=p.title+'.ptah.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);setInfo('已导出项目包')})}
 function notes(instruction:string):Annotation[]{return selected.flatMap(key=>{
   const instance=mode==='edit'?undefined:world?.instances.get(key),n=instance?.def??scene.nodes.get(key.slice(1))
   return n?[{id:crypto.randomUUID(),authorId:n.id,statementId:n.statement,instanceId:instance?world?.session+key:undefined,playSessionId:instance?world?.session:undefined,sceneRevision:mode==='edit'?p.revision:world?.runningRevision??p.revision,scope:instance?.scope?'template':'author_node',localAnchor:{x:anchor[0],y:anchor[1]},instruction}]:[]
 })}
 async function addImage(a:Asset,base:number,label:string){
   checkPNG(a.data)
   const bitmap=await createImageBitmap(new Blob([new Uint8Array(a.data)],{type:'image/png'}));bitmap.close()
   const old=current.current
   if(old.id!==p.id||old.revision!==base)throw Error('生成期间项目发生变化，请重试')
   const s=compile(old.source,old.assets.map(x=>x.id)),root=s.root,entry=s.entry
   const registry=[...s.nodes.values()].find(n=>n.type==='ResourceRegistry'),suffix=a.id.slice(-12),tex='asset_'+suffix,sprite='sprite_'+suffix
   const registryName=registry?.statement??'resources_'+suffix
   const attach=(n:NodeDef,ref:string)=>{const e=structuredClone(s.index.get(n.statement)!.expr);if(e.k!=='Comp'||e.args[2].k!=='Arr')throw Error('无效节点');e.args[2].els.push({k:'Ref',n:ref});return n.statement+' = '+print(e)}
   const pieces=[tex+' = Texture("'+tex+'", {asset_id: "'+a.id+'"}, [])',sprite+' = Sprite2D("'+sprite+'", {name: "生成素材",position: [480, 240],size: [128, 128], texture: "'+a.id+'"}, [])',attach(entry,sprite)]
   if(registry)pieces.push(attach(registry,tex));else pieces.push(attach(root,registryName),registryName+' = ResourceRegistry("'+registryName+'", {}, ['+tex+'])')
   const assets=[...old.assets,a];apply(applyPatch(s,pieces.join('\n'),assets.map(x=>x.id)).source,label,base,crypto.randomUUID(),[],assets);pick('/'+sprite)
 }
 async function generate(){
   if(!prompt.trim()||busy)return
   const base=current.current,controller=new AbortController(),instruction=prompt.trim(),annotations=notes(instruction)
   if(task==='patch'&&isInstance&&scope==='instance'){setError('使用属性面板覆盖本实例，或选择模板后提交 AI 修改');return}
   if(task==='patch'&&mode!=='edit'&&world?.pendingRestart){setError('运行基线已过期，请切换到编辑模式');return}
   setError('');setInfo('');setDraft('');setStaged(null);setBusy(true);abort.current=controller
   let frame=0
   try{
     if(task==='image'){
       const res=await fetch('/api/images',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({prompt:instruction})}),data=await res.json()
       if(!res.ok)throw Error(data.error);await addImage({id:data.assetId,data:Uint8Array.from(atob(data.data),c=>c.charCodeAt(0))},base.revision,'生成图像素材')
     }else{
       setDraftMode(task);setView('canvas')
       let pending=''
       const result=await requestSource(base,instruction,task,annotations,controller.signal,s=>{pending=s;if(!frame)frame=requestAnimationFrame(()=>{frame=0;setDraft(pending)})})
       cancelAnimationFrame(frame)
       if(current.current.id!==base.id||current.current.revision!==base.revision)throw Error('版本冲突，原版本已保留')
       const ids=base.assets.map(a=>a.id),next=task==='patch'?applyPatch(scene,result.source,ids):compile(result.source,ids)
       const changed=[...new Set([...scene.index.keys(),...next.index.keys()])].filter(k=>next.index.get(k)?.raw!==scene.index.get(k)?.raw)
       if(task==='patch'&&(isInstance||changed.some(k=>!next.index.has(k)||!annotations.some(n=>n.statementId===k)))){
         setStaged({source:next.source,base:base.revision,txId:result.txId,label:instruction,notes:annotations,changed});setDialog('review')
       }else apply(next.source,instruction,base.revision,result.txId,task==='patch'?annotations:[])
       setDraft('')
     }
     setPrompt('')
   }catch(e){setError(controller.signal.aborted?'已取消生成，原版本已保留':(e as Error).message)}
   finally{cancelAnimationFrame(frame);setBusy(false)}
 }
 function tree(n:NodeDef,depth=0):React.ReactNode{
   const Icon=iconFor(n),expanded=open.has(n.id)||!!search,key='/'+n.id,active=selected.includes(key)
   if(search&&!title(n).toLowerCase().includes(search.toLowerCase())&&!n.id.includes(search)&&!n.children.length)return null
   return <div key={n.id}><div className={'tree-row '+(active?'chosen':'')} style={{paddingLeft:8+depth*13}}><button aria-label={'展开 '+title(n)} className="twisty" disabled={!n.children.length} onClick={()=>{const next=new Set(open);next.has(n.id)?next.delete(n.id):next.add(n.id);setOpen(next)}}>{n.children.length?(expanded?<ChevronDown/>:<ChevronRight/>):null}</button><button className="treename" onClick={e=>{pick(key,e.shiftKey);setAnchor([0,0]);setMobilePane('')}}><Icon size={15} className={'nodeicon '+n.type}/>{title(n)}</button></div>{expanded&&n.children.map(id=>tree(scene.nodes.get(id)!,depth+1))}</div>
 }
 const values=node?(mode!=='edit'&&inst&&world?world.props(inst):node.props):{}
 const editable=node?Object.keys({...node.props,...(['Node2D','CharacterBody2D','StaticBody2D','Area2D','Polygon2D','Sprite2D','Label','Button'].includes(node.type)?{position:0,visible:0}:{})}).filter(k=>!['position','name','groups','polygon','shape','action','states','transitions','animations','input_map'].includes(k)):[]
 const status=error||info, Icon=node?iconFor(node):Box
 return <div className="shell">
 <header className="top"><div className="brand"><span className="brandmark"><Layers3 size={25} strokeWidth={2.7}/></span>Ptah<span className="thin">Studio</span></div><div className="crumb"><span>/</span> 工作空间 <ChevronRight size={13}/> <strong>{p.title}</strong></div><div className="top-actions"><span className={'saved '+(saved==='未保存'?'bad':'')}><i/>{saved}</span><button className="outline compact" onClick={exportFile}><Download size={15}/>导出项目</button><Tool icon={Settings2} label="服务配置" onClick={()=>setDialog('settings')}/></div></header>
 <div className="workbench"><aside className={'sidebar '+(mobilePane==='tree'?'mobile-open':'')}><div className="side-head"><b>项目资源</b><Tool icon={Plus} label="打开示例或导入项目" onClick={()=>setDialog('projects')}/></div><div className="side-tabs">{[['scene','场景树'],['assets','素材库']].map(([k,v])=><button className={section===k?'on':''} key={k} onClick={()=>setSection(k)}>{v}</button>)}</div>
 {section==='scene'?<><div className="filter"><Search size={14}/><input aria-label="搜索节点" placeholder="搜索节点…" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="tree">{tree(scene.entry)}{scene.root.children.filter(k=>k!==scene.entry.id).map(k=>tree(scene.nodes.get(k)!))}</div></>:<div className="asset-list">{p.assets.map(a=><div key={a.id}><ImageIcon size={16}/><code>{a.id.slice(-12)}</code></div>)}{!p.assets.length&&<p>当前关卡使用矢量图形。生成纹理后会出现在这里。</p>}<button className="outline" onClick={()=>{setTask('image');promptBox.current?.focus()}}><ImagePlus size={15}/>生成纹理</button></div>}
 <div className="side-bottom"><button onClick={()=>setDialog('projects')}><FolderOpen/>项目与示例<ChevronRight/></button><button onClick={()=>setDialog('history')}><History/>版本历史<span>R{p.revision}</span></button><button onClick={()=>setDialog('keys')}><Keyboard/>操作指南<ChevronRight/></button></div></aside>
 <main><div className="workspace-title"><div><div className="project-path"><span className="project-dot"/>关卡编辑器</div><h1>{p.title}<small>.oui</small></h1></div><div className="run-actions"><Tool icon={Undo2} label="撤销上次修改" onClick={undo} disabled={!undoTarget(p)}/><Tool icon={RotateCcw} label="重新试玩" onClick={()=>play(true)}/><button className="primary" onClick={()=>play()}>{mode==='play'?<Pause/>:<Play fill="currentColor"/>}{mode==='play'?'暂停检查':mode==='inspect'?'继续试玩':'试玩关卡'}</button></div></div>
 <section className="canvas-card" ref={canvasPanel}><div className="canvas-head"><div className="view-tabs"><button className={view==='canvas'?'on':''} onClick={()=>setView('canvas')}><Layers3/>场景</button><button className={view==='code'?'on':''} onClick={()=>setView('code')}><Code2/>源码</button></div><div className="canvas-tools"><Tool icon={MousePointer2} label="编辑选取" active={mode==='edit'} onClick={()=>{setMode('edit');setDraft('')}}/><Tool icon={Grid2X2} label="显示网格" active={grid} onClick={()=>setGrid(!grid)}/><select aria-label="画布缩放" value={zoom} onChange={e=>setZoom(+e.target.value)}>{[.75,1,1.25,1.5].map(v=><option key={v} value={v}>{v*100}%</option>)}</select><Tool icon={Maximize2} label="切换全屏" onClick={()=>{(document.fullscreenElement?document.exitFullscreen():canvasPanel.current?.requestFullscreen())?.catch(e=>setError(e.message))}}/></div></div>
 {view==='canvas'?<div className="stage"><Canvas scene={draftView??(mode==='edit'?scene:liveScene)} world={draftView?undefined:world} mode={draftView?'edit':mode} selected={selected} assets={p.assets} grid={grid} zoom={zoom} onError={setError} onRun={()=>play()} onPick={(h,a,m)=>{if(draft)return;pick(h.key,m);setAnchor(a)}} onMove={(id,[x,y])=>{if(draft)return;const pos=scene.nodes.get(id)?.props.position??[0,0];editProp(id,'position',[Math.round(pos[0]+x),Math.round(pos[1]+y)])}}/></div>:<div className="source"><textarea aria-label="OpenUI 源码" spellCheck={false} value={code} onChange={e=>setCode(e.target.value)}/><button className="outline" onClick={()=>run(()=>apply(code,'保存源码'))}><Save size={14}/>提交源码</button></div>}
 <div className="canvas-foot"><span><i className={'mode-dot '+mode}/>{draft?'生成草稿':mode==='edit'?'编辑模式':mode==='inspect'?'暂停检查':'试玩中'}</span><span>{world?.pendingRestart?'结构已变更 · 需要重新试玩':scene.root.props.viewport.join(' × ')}<em/>60 Hz</span></div></section>
 <div className="mobile-actions"><button onClick={()=>setMobilePane(mobilePane==='tree'?'':'tree')}><PanelLeft/>场景树</button><button onClick={()=>setMobilePane(mobilePane==='inspector'?'':'inspector')}><SlidersHorizontal/>属性</button></div>
 <section className="assistant"><div className="ai-head"><div className="ai-icon"><Sparkles size={18}/></div><h2>创作助手</h2><span className="model">{task==='image'?(config.IMAGE?.model??'gpt-image-2.6-sunburst'):(config.TEXT?.model??'gpt-6.2-sol')}</span></div><div className="composer"><textarea aria-label="创作指令" ref={promptBox} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={task==='patch'?'描述想修改的对象，例如“让角色跳得更高”…':task==='create'?'描述新关卡的玩法、目标和风格…':'描述纹理的主体、色彩和风格…'} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')void generate()}}/><div className="compose-foot"><div className="compose-options"><select value={task} aria-label="创作任务" onChange={e=>setTask(e.target.value as typeof task)}><option value="patch">局部修改</option><option value="create">生成关卡</option><option value="image">生成素材</option></select>{task==='patch'&&node&&<span className="target"><MousePointer2 size={12}/>{title(node)}{selected.length>1?' +'+(selected.length-1):''}</span>}</div>{busy?<button className="send" aria-label="取消生成" onClick={()=>abort.current?.abort()}><Square size={14}/></button>:<button className="send" aria-label="发送指令" disabled={!prompt.trim()} onClick={()=>void generate()}><ArrowUp size={18}/></button>}</div></div>
 {busy&&<div className="feedback">正在生成{draft?' · '+draft.length+' 字符':''}…</div>}{status&&<div role="status" className={'feedback '+(error?'error':'')}>{status}<button aria-label="关闭提示" onClick={()=>{setError('');setInfo('')}}><X size={12}/></button></div>}
 {draft&&!busy&&<details><summary>查看未提交草稿</summary><pre>{draft}</pre></details>}
 </section></main>
 <aside className={'inspector '+(mobilePane==='inspector'?'mobile-open':'')}><div className="side-head"><b>检查器</b><SlidersHorizontal size={16}/></div><div className="side-tabs">{[['properties','属性'],['notes','标注']].map(([k,v])=><button className={inspectTab===k?'on':''} key={k} onClick={()=>setInspectTab(k)}>{v}</button>)}</div>
 {inspectTab==='notes'?<div className="inspect-body">{p.annotations.length?p.annotations.map(a=><article key={a.id}><b>{a.authorId} · R{a.sceneRevision}</b><p>{a.instruction}</p>{a.invalid&&<small>对象已删除</small>}</article>):<p className="muted">选中对象并提交修改，标注会保存在这里。</p>}</div>:node?<div className="inspect-body" key={selected[0]+p.revision}><div className="object-title"><span><Icon size={23}/></span><div><h3>{title(node)}</h3><code>{node.type}</code></div></div>
 {isInstance&&<label>修改范围<select value={scope} onChange={e=>setScope(e.target.value as typeof scope)}><option value="instance">仅本次实例</option><option value="template">所有模板实例</option></select></label>}
 <div className="property-group"><h4><Box/>节点</h4><div className="prop-line"><label>标识</label><code>{node.id}</code></div><div className="prop-line"><label>父节点</label><button className="parent-link" disabled={!node.parent} onClick={()=>node.parent&&pick('/'+node.parent)}>{node.parent??'—'}<ArrowUpLeft size={12}/></button></div></div>
 {('position' in values||node.type.endsWith('2D'))&&<div className="property-group"><h4><Move/>变换</h4><label>位置 <small>px</small></label><div className="coords">{['X','Y'].map((axis,i)=><label key={axis}>{axis}<input aria-label={'位置 '+axis} type="number" defaultValue={values.position?.[i]??0} onBlur={e=>{const pos=[...(values.position??[0,0])];if(Number.isFinite(e.target.valueAsNumber)&&pos[i]!==+e.target.value){pos[i]=+e.target.value;editProp(node.id,'position',pos)}}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/></label>)}</div></div>}
 <div className="property-group"><h4><SlidersHorizontal/>对象属性</h4>{editable.map(k=>{const field=node.fields[k],v=values[k]??(k==='visible'?true:'')
 return <div className="prop-line" key={k}><label title={k}>{{visible:'可见',collision_layer:'碰撞层',collision_mask:'碰撞遮罩',speed:'速度',color:'颜色',text:'文本',jump_speed:'跳跃速度',gravity:'重力',monitoring:'监测'}[k]??k}</label>{field&&!literal(field)?<button className="expr" title={print(field)} onClick={()=>setDialog('expr:'+k)}>ƒ 表达式</button>:typeof v==='boolean'?<button role="switch" aria-checked={v} aria-label={k} className={'switch '+(v?'enabled':'')} onClick={()=>editProp(node.id,k,!v)}><i/></button>:typeof v==='object'?<code title={JSON.stringify(v)}>{JSON.stringify(v).slice(0,22)}</code>:<input aria-label={k} type={k==='color'||k==='modulate'?'color':typeof v==='number'?'number':'text'} defaultValue={String(v)} onBlur={e=>{const val=typeof v==='number'?Number(e.target.value):e.target.value;if(val!==v)editProp(node.id,k,val)}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/>}</div>})}</div>
 {node.children.length>0&&<div className="property-group"><h4><GitBranch/>子节点 <small>{node.children.length}</small></h4>{node.children.slice(0,16).map(id=><button className="child" key={id} onClick={()=>pick((inst?.scope??'')+'/'+id)}><Box size={13}/>{title(liveScene.nodes.get(id)!)}<ChevronRight size={12}/></button>)}</div>}
 <button className="annotate" onClick={()=>{setTask('patch');promptBox.current?.focus();setMobilePane('')}}><Pin size={14}/>标注并修改</button></div>:<p className="empty">在场景树或画布上选择对象。</p>}</aside></div>
 <footer><span><span className="status-light"/>Ptah Studio</span><span>OpenUI Lang <em/> game2d/1.0 <em/> R{p.revision}</span></footer>
 <input hidden type="file" accept=".zip" ref={file} onChange={async e=>{const f=e.target.files?.[0];e.target.value='';if(f)try{replace(importProject(new Uint8Array(await f.arrayBuffer())))}catch(e){setError((e as Error).message)}}}/>
 {dialog&&<Sheet title={dialog==='projects'?'项目与示例':dialog==='history'?'版本历史':dialog==='settings'?'模型服务配置':dialog==='keys'?'操作指南':dialog==='review'?'确认补丁范围':'替换表达式为常量'} close={()=>setDialog('')}>
 {dialog==='projects'&&<><p>打开示例会切换当前项目。可先导出项目包保留当前工作。</p>{examples.map(e=><button className="project-option" key={e.name} onClick={()=>replace(fresh(e.name,e.source))}><Layers3/><b>{e.name}</b><span>{e.kind}</span><ChevronRight size={16}/></button>)}<div className="dialog-actions"><button className="outline" onClick={exportFile}><Download size={15}/>导出当前项目</button><button className="outline" onClick={()=>file.current?.click()}><Upload size={15}/>导入项目包</button></div></>}
 {dialog==='history'&&<><p>作者版本 R{p.revision}{world?' · 试玩版本 R'+world.runningRevision:''}</p>{p.history.length?p.history.slice().reverse().map(h=><div className="history-line" key={h.txId}><code>R{h.revision}</code><span>{h.label}</span><button onClick={()=>run(()=>{apply(h.before,'恢复至 R'+(h.revision-1));setDialog('')})}>恢复此前版本</button></div>):<p>尚无修改记录。</p>}</>}
 {dialog==='settings'&&<><p>在服务端 .env 分别设置模型、base URL 和 API key，重启服务后生效。</p>{['TEXT','IMAGE'].map(k=><article key={k}><h3>{k==='TEXT'?'语言模型':'生图模型'}</h3><code>{config[k]?.model??'连接中'}</code><p>{config[k]?.baseURL}</p><small>{config[k]?.configured?'已配置密钥':'等待服务端密钥'}</small></article>)}</>}
 {dialog==='keys'&&<div className="help">{[['A / D · ← / →','水平移动'],['空格','平台跳跃'],['WASD · 方向键','俯视移动'],['拖动','移动字面量位置'],['Alt + 点击','穿透选取'],['Shift + 点击','多选'],['Ctrl / ⌘ + Enter','发送创作指令']].map(([a,b])=><p key={a}><kbd>{a}</kbd>{b}</p>)}</div>}
 {dialog==='review'&&staged&&<><p>补丁涉及以下声明，提交后将记录到版本历史。</p><pre>{staged.changed.join('\n')}</pre><button className="primary" onClick={()=>run(()=>{apply(staged.source,staged.label,staged.base,staged.txId,staged.notes);setStaged(null);setDialog('')})}>提交 {staged.changed.length} 项修改</button></>}
 {dialog.startsWith('expr:')&&node&&<form onSubmit={e=>{e.preventDefault();const k=dialog.slice(5),data=new FormData(e.currentTarget);run(()=>{const v=JSON.parse(String(data.get('value')));editProp(node.id,k,v,true);setDialog('')})}}><pre>{print(node.fields[dialog.slice(5)])}</pre><label>常量（JSON）<input name="value" defaultValue={JSON.stringify(values[dialog.slice(5)])}/></label><button className="primary">替换并保存</button></form>}
 </Sheet>}
 </div>
}
async function boot(){let p:Project|undefined;try{p=await loadProject();if(p)compile(p.source,p.assets.map(a=>a.id))}catch{p=undefined}createRoot(document.getElementById('root')!).render(<App initial={p??blankProject()}/>)}
void boot()
