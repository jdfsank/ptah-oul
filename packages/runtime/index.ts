import type {Expr} from '../authoring'
import {value,hotCompatible,type Scene,type Values,type NodeDef} from '../scene-compiler'
import {SpatialHash,sweep,overlaps,circleHit,type Box} from './physics'
export type Input={down:Set<string>;pressed:Set<string>}
export const noInput=():Input=>({down:new Set(),pressed:new Set()})
export type Instance={key:string;scope:string;def:NodeDef;parent?:Instance;children:Instance[];x:number;y:number;vx:number;vy:number;floor:boolean;wall:boolean;ceiling:boolean;overrides:Values;input:boolean;once:boolean;remaining:number;active:boolean;frame:number;machine:string;shape?:Instance}
type Signal={source:Instance;name:string;other?:Instance;global?:boolean}
const dt=1/60
const registries=new Set(['ResourceRegistry','PrefabRegistry','Texture','Prefab'])
export class World {
  readonly session=crypto.randomUUID()
  instances=new Map<string,Instance>()
  destroyed=new Set<string>()
  lifecycle:string[]=[]
  state:Values;tick=0;paused=false;error='';pendingRestart=false
  private statics=new SpatialHash<Instance>()
  private pairs=new Map<string,[Instance,Instance]>()
  private queue:Signal[]=[];private commands:(()=>void)[]=[]
  private serial=0;private transitions=0
  constructor(public scene:Scene,public runningRevision=0){
    this.state=structuredClone(scene.defaults)
    const root=this.build(scene.entry,'',undefined)
    this.activate(root)
  }
  private build(def:NodeDef,scope:string,parent?:Instance):Instance {
    if(this.instances.size>=4096)throw Error('实例超出限额')
    const p=def.props,key=scope+'/'+def.id
    const item:Instance={key,scope,def,parent,children:[],x:p.position?.[0]??0,y:p.position?.[1]??0,vx:0,vy:0,floor:false,wall:false,ceiling:false,overrides:{},input:true,once:false,remaining:0,active:false,frame:0,machine:p.initial??''}
    this.instances.set(key,item)
    for(const id of def.children){
      const child=this.scene.nodes.get(id)!
      if(!registries.has(child.type))item.children.push(this.build(child,scope,item))
    }
    item.shape=item.children.find(c=>c.def.type==='CollisionShape2D')
    return item
  }
  private activate(root:Instance) {
    const list:Instance[]=[]
    const enter=(i:Instance)=>{list.push(i);this.lifecycle.push('enter '+i.key);i.children.forEach(enter)}
    enter(root)
    for(const i of list)if(i.def.type==='StaticBody2D')this.statics.add(this.box(i),i)
    for(const i of list)if(i.def.type==='CharacterBody2D'){
      const b=this.box(i)
      for(const s of this.statics.query(b))if(this.blocks(i,s)&&overlaps(b,this.box(s)))throw Error('出生位置穿插 · '+i.def.statement)
    }
    const ready=(i:Instance)=>{
      i.children.forEach(ready);this.lifecycle.push('ready '+i.key)
      const p=i.def.props
      i.active=i.def.type==='Timer'?!!p.autostart:i.def.type==='AnimatedSprite2D'?p.playing!==false:true
      i.remaining=p.interval??p.wait_time??1
      if(i.def.type==='StateMachine')this.action(p.states.find((s:any)=>s.name===i.machine)?.on_enter,i)
      this.queue.push({source:i,name:'ready'})
    }
    ready(root)
  }
  props(i:Instance):Values {
    const p={...i.def.props}
    for(const k of ['text','visible'])if(i.def.fields[k])p[k]=value(i.def.fields[k],this.state)
    return {...p,...i.overrides}
  }
  enabled(i:Instance):boolean{return (i.overrides.enabled??i.def.props.enabled)!==false&&(!i.parent||this.enabled(i.parent))}
  private target(i:Instance,id:string){return this.instances.get(i.scope+'/'+id)}
  box(i:Instance):Box {
    const shape=i.shape!,s=shape.def.props.shape
    let x=shape.x,y=shape.y
    for(let p:Instance|undefined=i;p;p=p.parent){x+=p.x;y+=p.y}
    return {x,y,w:s.size?.[0]??2*s.radius,h:s.size?.[1]??2*s.radius}
  }
  private blocks(i:Instance,s:Instance){return this.instances.has(s.key)&&this.enabled(s)&&((i.def.props.collision_mask??1)&(s.def.props.collision_layer??1))!==0}
  private move(i:Instance,input:Input) {
    const controller=i.children.find(c=>c.def.type.endsWith('Controller')&&this.enabled(c)),p=controller?.def.props??{}
    const bindings=this.scene.root.props.input_map
    const held=(name:string,edge=false)=>i.input&&(bindings[name]??[]).some((k:string)=>(edge?input.pressed:input.down).has(k))
    const axis=(a:string,b:string)=>Number(held(a))-Number(held(b))
    let x=axis(p.right_action??'move_right',p.left_action??'move_left')
    if(controller?.def.type==='PlatformerController'){
      i.vx=x*(p.speed??240)
      if(i.floor&&held(p.jump_action??'jump',true))i.vy=-(p.jump_speed??420)
      i.vy+=(p.gravity??this.scene.entry.props.gravity?.[1]??980)*dt
    } else if(controller){
      const y=axis(p.down_action??'move_down',p.up_action??'move_up'),scale=(p.speed??240)/(Math.hypot(x,y)||1)
      i.vx=x*scale;i.vy=y*scale
    }
    let dx=i.vx*dt,dy=i.vy*dt;i.floor=i.wall=i.ceiling=false
    for(let step=0;step<4&&(dx||dy);step++){
      const b=this.box(i),broad={x:b.x+dx/2,y:b.y+dy/2,w:b.w+Math.abs(dx),h:b.h+Math.abs(dy)}
      let first:ReturnType<typeof sweep>
      for(const s of this.statics.query(broad))if(this.blocks(i,s)){
        const hit=sweep(b,this.box(s),dx,dy)
        if(hit&&(!first||hit.t<first.t))first=hit
      }
      const t=first?.t??1;i.x+=dx*t;i.y+=dy*t
      if(!first)break
      dx*=1-t;dy*=1-t
      if(first.nx){i.wall=true;dx=i.vx=0}
      if(first.ny){i.floor ||= first.ny<0;i.ceiling ||= first.ny>0;dy=i.vy=0}
    }
  }
  private remove(i:Instance) {
    i.children.slice().forEach(c=>this.remove(c))
    this.instances.delete(i.key);this.destroyed.add(i.key)
    if(i.parent)i.parent.children=i.parent.children.filter(c=>c!==i)
    for(const [key,pair] of this.pairs)if(pair.includes(i))this.pairs.delete(key)
  }
  private spawn(template:string,at:number[],parent?:Instance) {
    const prefab=this.scene.nodes.get(template)
    if(prefab?.type!=='Prefab')throw Error('未知模板 '+template)
    const root=this.build(this.scene.nodes.get(prefab.children[0])!,'spawn'+(++this.serial),parent)
    root.x+=at[0];root.y+=at[1];parent?.children.push(root);this.activate(root)
  }
  action(e:Expr|undefined,i:Instance) {
    if(!e||e.k!=='Comp')return
    if(e.name==='Action'){if(e.args[0].k==='Arr')e.args[0].els.forEach(x=>this.action(x,i));return}
    const [a,b]=e.args,arg=b?value(b,this.state):undefined
    if(e.name==='Set'&&a.k==='StateRef'){this.state[a.n]=arg;return}
    if(e.name==='Reset'){if(a?.k==='StateRef')this.state[a.n]=structuredClone(this.scene.defaults[a.n]);else this.state=structuredClone(this.scene.defaults);return}
    const id=a?value(a,this.state):'',target=this.target(i,id)
    switch(e.name){
      case 'EmitGameEvent':this.queue.push({source:i,name:id,global:true});break
      case 'RestartScene':this.commands.push(()=>this.restart());break
      case 'Spawn':this.commands.push(()=>this.spawn(id,arg??[0,0],this.instances.get('/'+this.scene.entry.id)));break
      case 'DestroyNode':if(target)this.commands.push(()=>this.remove(target));break
      case 'SetVisible':if(target)target.overrides.visible=arg;break
      case 'SetEnabled':if(target)target.overrides.enabled=arg;break
      case 'SetInputEnabled':if(target)target.input=arg;break
      case 'StartTimer':if(target){target.active=true;target.remaining=target.def.props.wait_time??1}break
      case 'StopTimer':if(target)target.active=false;break
    }
  }
  restart(){Object.assign(this,new World(this.scene,this.runningRevision))}
  update(next:Scene,revision:number) {
    if(this.pendingRestart||!hotCompatible(this.scene,next)){this.pendingRestart=true;return false}
    for(const i of this.instances.values()) {
      const old=i.def;i.def=next.nodes.get(old.id)!
      for(const k of Object.keys(i.overrides))if(JSON.stringify(old.fields[k])!==JSON.stringify(i.def.fields[k]))delete i.overrides[k]
    }
    this.scene=next;this.runningRevision=revision;return true
  }
  step(input:Input=noInput()) {
    if(this.paused||this.error)return
    try{
      this.tick++;this.transitions=0
      const live=[...this.instances.values()].filter(i=>this.enabled(i)),bodies=live.filter(i=>i.def.type==='CharacterBody2D')
      bodies.forEach(i=>this.move(i,input))
      const next=new Map<string,[Instance,Instance]>()
      for(const area of live.filter(i=>i.def.type==='Area2D'&&i.def.props.monitoring!==false)){
        const box=this.box(area)
        for(const body of bodies){
          if(!((area.def.props.collision_mask??1)&(body.def.props.collision_layer??1)))continue
          if(!(area.shape!.def.props.shape.radius?circleHit:overlaps)(box,this.box(body)))continue
          const key=JSON.stringify([area.key,body.key]);next.set(key,[area,body])
          if(!this.pairs.has(key))this.queue.push({source:area,name:'body_entered',other:body})
        }
      }
      for(const [k,[source,other]] of this.pairs)if(!next.has(k))this.queue.push({source,other,name:'body_exited'})
      this.pairs=next
      for(const i of live){
        if(!i.active)continue
        const p=i.def.props
        if(i.def.type==='AnimatedSprite2D'){
          const anim=p.animations[p.animation];i.frame+=dt*anim.fps
          if(i.frame>=anim.frames.length){i.frame=anim.loop===false?anim.frames.length-1:i.frame%anim.frames.length;i.active=anim.loop!==false;this.queue.push({source:i,name:'animation_finished'})}
        }
        if(!['Timer','Spawner'].includes(i.def.type))continue
        i.remaining-=dt
        if(i.remaining>1e-9)continue
        i.remaining+=p.interval??p.wait_time??1
        if(i.def.type==='Timer'){this.queue.push({source:i,name:'timeout'});if(p.one_shot)i.active=false}
        else if(i.children.filter(c=>c.scope!==i.scope).length<p.limit)this.commands.push(()=>this.spawn(p.template,[0,0],i))
      }
      for(let n=0;n<this.queue.length;n++){
        const ev=this.queue[n]
        if(n>=1000)throw Error('事件预算超限 · '+ev.source.def.statement)
        for(const r of ev.source.children)if(this.enabled(r)&&r.def.type==='SignalRule'){
          const p=r.def.props
          if(r.once||p.signal!==ev.name||p.filter_group&&!ev.other?.def.props.groups?.includes(p.filter_group))continue
          if(p.once)r.once=true
          this.action(r.def.fields.action,r)
        }
        if(ev.global)for(const m of live.filter(i=>i.def.type==='StateMachine'&&i.scope===ev.source.scope)){
          const p=m.def.props,trans=value(m.def.fields.transitions,this.state).find((t:any)=>t.from===m.machine&&t.event===ev.name&&t.condition!==false)
          if(!trans)continue
          if(++this.transitions>64)throw Error('状态转移预算超限 · '+m.def.statement)
          this.action(p.states.find((s:any)=>s.name===m.machine).on_exit,m);m.machine=trans.to
          this.action(p.states.find((s:any)=>s.name===m.machine).on_enter,m)
        }
      }
      this.queue=[];const commands=this.commands;this.commands=[]
      for(const command of commands){const session=this.session;command();if(this.session!==session)break}
    }catch(e){this.error=(e as Error).message;this.paused=true}
  }
}
export class Clock {
  private carry=0
  reset(){this.carry=0}
  advance(seconds:number,step:()=>void){
    if(seconds>0.5){this.reset();return}
    this.carry=Math.min(5*dt,this.carry+Math.max(0,seconds))
    while(this.carry+1e-10>=dt){this.carry-=dt;step()}
  }
}
