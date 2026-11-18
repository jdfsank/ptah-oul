import {useEffect,useRef,useState} from 'react'
import {Viewport} from '../../packages/render-pixi'
import {Clock,noInput,type World} from '../../packages/runtime'
import {local,type Hit,type Point} from '../../packages/editor-tools'
import type {Scene} from '../../packages/scene-compiler'
import type {Asset} from '../../packages/project-io'
export type Mode='edit'|'play'|'inspect'
type Props={scene:Scene;world?:World;mode:Mode;selected:string[];assets:Asset[];grid:boolean;zoom:number;onPick:(h:Hit,anchor:Point,multi:boolean)=>void;onMove:(id:string,delta:Point)=>void;onError:(s:string)=>void;onRun:()=>void}
export function Canvas(props:Props){
 const host=useRef<HTMLDivElement>(null),current=useRef(props),view=useRef<Viewport|null>(null),[ready,setReady]=useState(false),[failed,setFailed]=useState('');current.current=props
 const summary=useRef(''),[hud,setHud]=useState('')
 const inputs=useRef(noInput()),dirty=useRef(true),clock=useRef(new Clock())
 useEffect(()=>{dirty.current=true;inputs.current=noInput();clock.current.reset()},[props.scene,props.mode,props.grid,props.zoom,props.selected,props.world])
 useEffect(()=>{
   let disposed=false,frame=0,previous=performance.now();const v=new Viewport()
   const blur=()=>{inputs.current=noInput();clock.current.reset();previous=performance.now()}
   function key(e:KeyboardEvent){
     if(current.current.mode!=='play'||(e.target instanceof HTMLElement&&['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)))return
     if(!Object.values(current.current.scene.root.props.input_map).some(keys=>(keys as string[]).includes(e.code)))return
     e.preventDefault();const i=inputs.current
     if(e.type==='keyup')i.down.delete(e.code)
     else {if(!i.down.has(e.code)&&!e.repeat)i.pressed.add(e.code);i.down.add(e.code)}
   }
   function render(now:number){
     if(disposed)return
     const p=current.current,w=p.mode==='edit'?undefined:p.world
     try{
       if(!document.hidden&&p.mode==='play'&&w&&!w.paused){
         clock.current.advance((now-previous)/1000,()=>{w.step(inputs.current);inputs.current.pressed.clear()})
         if(w.error)p.onError(w.error)
         const text=[...w.instances.values()].filter(i=>i.def.type==='Label').flatMap(i=>{
           const props=w.props(i);return props.visible===false?[]:[props.text]
         }).join(' · ')
         if(summary.current!==text){summary.current=text;setHud(text)}
       }
       if(!document.hidden&&(dirty.current||p.mode==='play')){v.draw(w?.scene??p.scene,w,p.mode==='play'?[]:p.selected,p.grid,p.zoom);dirty.current=false}
     }catch(e){p.onError((e as Error).message);return}
     previous=now;frame=requestAnimationFrame(render)
   }
   v.init(host.current!).then(()=>{if(disposed){v.destroy();return}view.current=v;setReady(true);frame=requestAnimationFrame(render)}).catch(e=>{if(!disposed){setFailed(String(e));current.current.onError('WebGL 初始化失败')}})
   window.addEventListener('keydown',key);window.addEventListener('keyup',key);window.addEventListener('blur',blur);document.addEventListener('visibilitychange',blur)
   return ()=>{disposed=true;cancelAnimationFrame(frame);if(view.current){v.destroy();view.current=null}window.removeEventListener('keydown',key);window.removeEventListener('keyup',key);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',blur)}
 },[])
 useEffect(()=>{if(ready)view.current?.textures(props.assets).then(()=>dirty.current=true).catch(e=>current.current.onError(e.message))},[ready,props.assets])
 const drag=useRef<{hit:Hit;start:Point}|undefined>(undefined)
 function point(e:React.PointerEvent):Point {const r=host.current!.getBoundingClientRect(),s=view.current!.app.screen;return [(e.clientX-r.left)*s.width/r.width,(e.clientY-r.top)*s.height/r.height]}
 return <div className="viewport" ref={host} tabIndex={0} aria-label="关卡画布" style={{aspectRatio:props.scene.root.props.viewport.join('/')}} onPointerDown={e=>{
   if(!view.current)return
   host.current!.focus();const pos=point(e),hits=view.current.picks.at(pos)
   if(props.mode==='play'){
     const button=hits.map(h=>props.world?.instances.get(h.key)).find(i=>i?.def.type==='Button')
     if(button&&props.world?.enabled(button))props.world.action(button.def.fields.action,button)
     return
   }
   const base=hits.findIndex(h=>props.selected.includes(h.key)),hit=hits[e.altKey?(base+1)%hits.length:0]
   if(!hit)return
   props.onPick(hit,local(hit.matrix,pos),e.shiftKey)
   if(props.mode==='edit'){drag.current={hit,start:pos};e.currentTarget.setPointerCapture(e.pointerId)}
 }} onPointerCancel={()=>drag.current=undefined} onPointerUp={e=>{
   const d=drag.current;drag.current=undefined
   if(!d||!view.current)return
   const end=point(e);if(Math.hypot(end[0]-d.start[0],end[1]-d.start[1])<3)return
   const a=local(d.hit.parent,d.start),b=local(d.hit.parent,end);props.onMove(d.hit.id,[b[0]-a[0],b[1]-a[1]])
 }}><output className="sr-only" aria-label="试玩 HUD">{props.mode==='edit'?'':hud}</output>{failed&&<div className="canvas-error">WebGL 无法启动，请启用浏览器硬件加速。</div>}</div>
}
