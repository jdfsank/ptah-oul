import {Application,Container,Graphics,Text,Sprite,Texture,Matrix as PixiMatrix,Rectangle} from 'pixi.js'
import {identity,matrix,multiply,transform,PickRegistry,type Matrix,type Point} from '../editor-tools'
import type {Scene,NodeDef,Values} from '../scene-compiler'
import type {World} from '../runtime'
import type {Asset} from '../project-io'
type Drawing={key:string;id:string;type:string;p:Values;mat:Matrix;parent:Matrix;z:number;order:number;layer:number;locked:boolean}
type Cached={item:Container;signature:string;polygon:Point[];texture?:Texture}
const rect=(x:number,y:number,w:number,h:number):Point[]=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]
const paintable=new Set(['Polygon2D','Sprite2D','AnimatedSprite2D','Label','Button'])
export class Viewport {
 app=new Application();picks=new PickRegistry();private cache=new Map<string,Cached>();private selection=new Graphics()
 private assets=new Map<string,Texture>();private assetData=new Map<string,Uint8Array>();private loadEpoch=0
 async init(host:HTMLElement){await this.app.init({width:960,height:540,background:0x1e243e,preference:'webgl',antialias:true,resolution:Math.min(devicePixelRatio,2),autoDensity:true});this.app.stop();host.appendChild(this.app.canvas);this.app.stage.addChild(this.selection)}
 async textures(assets:Asset[]) {
  const epoch=++this.loadEpoch,newAssets=new Map<string,Texture>()
  try{
    for(const a of assets){
      if(this.assetData.get(a.id)===a.data)continue
      const blob=new Blob([new Uint8Array(a.data)],{type:'image/png'}),bitmap=await createImageBitmap(blob)
      newAssets.set(a.id,Texture.from(bitmap))
    }
    if(epoch!==this.loadEpoch){for(const t of newAssets.values())t.destroy(true);return}
    for(const [id,t] of this.assets)if(!assets.some(a=>a.id===id)||newAssets.has(id)){t.destroy(true);this.assets.delete(id);this.assetData.delete(id)}
    for(const [id,t] of newAssets){this.assets.set(id,t);this.assetData.set(id,assets.find(a=>a.id===id)!.data)}
    if(newAssets.size)this.clear()
  }catch(e){for(const t of newAssets.values())t.destroy(true);throw e}
 }
 private clear(){for(const c of this.cache.values()){c.item.destroy({children:true});c.texture?.destroy(false)}this.cache.clear()}
 destroy(){this.loadEpoch++;this.clear();for(const t of this.assets.values())t.destroy(true);this.app.destroy(true,{children:true})}
 draw(scene:Scene,world:World|undefined,selected:string[],grid:boolean,zoom=1) {
  const [w,h]=scene.root.props.viewport
  if(this.app.screen.width!==w||this.app.screen.height!==h)this.app.renderer.resize(w,h)
  let order=0
  const list:Drawing[]=[],matrices=new Map<string,Matrix>(),cameras:{m:Matrix;p:Values;scope:string}[]=[]
  const walk=(n:NodeDef,key:string,parent:Matrix,z:number,layer:number,visible:boolean,locked:boolean,tint:number)=>{
    const i=world?.instances.get(key)
    if(world&&!i)return
    const p=i?world!.props(i):n.props,isHud=n.type==='CanvasLayer'
    if(isHud){parent=identity;layer=p.layer??1}
    const m=multiply(parent,matrix(i?.x??p.position?.[0]??0,i?.y??p.position?.[1]??0,p.rotation??0,p.scale??[1,1]))
    matrices.set(key,m)
    if(p.modulate){const c=parseInt(p.modulate.slice(1),16);tint=(((((tint>>16)&255)*((c>>16)&255)/255)<<16)|((((tint>>8)&255)*((c>>8)&255)/255)<<8)|((tint&255)*(c&255)/255))}
    visible &&= p.visible!==false;locked ||= !!p.locked
    z=(p.z_as_relative===false?0:z)+(p.z_index??0)
    if(n.type==='Camera2D'&&p.enabled!==false)cameras.push({m,p,scope:i?.scope??''})
    if(visible&&paintable.has(n.type)){
      let texture=p.texture
      if(n.type==='AnimatedSprite2D')texture=p.animations[p.animation].frames[Math.floor(i?.frame??0)]
      list.push({key,id:n.id,type:n.type,p:{...p,texture,tint},mat:m,parent,z,layer,order:order++,locked})
    }
    if(i)i.children.forEach(c=>walk(c.def,c.key,m,z,layer,visible,locked,tint))
    else for(const child of n.children){const def=scene.nodes.get(child);if(def&&!['PrefabRegistry','ResourceRegistry'].includes(def.type))walk(def,'/'+child,m,z,layer,visible,locked,tint)}
  }
  walk(scene.entry,'/'+scene.entry.id,identity,0,0,true,false,0xffffff)
  const cam=cameras[0],at=cam?.p.follow?matrices.get(cam.scope+'/'+cam.p.follow):cam?.m
  const [sx,sy]=cam?.p.zoom??[1,1],camera:Matrix=at?[sx,0,0,sy,w/2-at[4]*sx,h/2-at[5]*sy]:identity
  const editor:Matrix=[zoom,0,0,zoom,(1-zoom)*w/2,(1-zoom)*h/2]
  list.sort((a,b)=>a.layer-b.layer||a.z-b.z||a.order-b.order)
  this.picks.entries=[]
  const used=new Set<string>()
  for(const d of list){
    used.add(d.key)
    const view=multiply(editor,d.layer===0?camera:identity),m=multiply(view,d.mat),p=d.p
    const signature=JSON.stringify([d.type,p.polygon,p.color,p.text,p.font_size,p.size,p.texture,p.region,p.centered,p.offset,p.flip_h,p.flip_v])
    let c=this.cache.get(d.key)
    if(!c||c.signature!==signature){
      c?.item.destroy({children:true});c?.texture?.destroy(false)
      let item:Container,poly:Point[],crop:Texture|undefined
      if(d.type==='Polygon2D'){
        poly=p.polygon;item=new Graphics().poly(poly.flat()).fill(p.color??'#ffffff')
      }else if(d.type==='Label'||d.type==='Button'){
        item=new Container()
        const text=new Text({text:String(p.text??''),style:{fontFamily:'sans-serif',fontSize:p.font_size??17,fill:p.color??'#ffffff'}})
        const [sw,sh]=p.size??[text.width,text.height];poly=rect(0,0,sw,sh)
        if(d.type==='Button'){item.addChild(new Graphics().roundRect(0,0,sw,sh,6).fill('#344154'));text.position.set(10,(sh-text.height)/2)}
        item.addChild(text)
      }else{
        let texture=this.assets.get(p.texture)
        if(texture&&p.region){const [x,y,a,b]=p.region;crop=new Texture({source:texture.source,frame:new Rectangle(x,y,a,b)});texture=crop}
        const [sw,sh]=p.size??[texture?.width??48,texture?.height??48],x=(p.offset?.[0]??0)-(p.centered===false?0:sw/2),y=(p.offset?.[1]??0)-(p.centered===false?0:sh/2)
        poly=rect(x,y,sw,sh);item=new Container()
        if(texture){const sp=new Sprite(texture);sp.width=sw;sp.height=sh;sp.position.set(x+(p.flip_h?sw:0),y+(p.flip_v?sh:0));if(p.flip_h)sp.scale.x*=-1;if(p.flip_v)sp.scale.y*=-1;item.addChild(sp)}
        else item.addChild(new Graphics().rect(x,y,sw,sh).fill('#9c83a0'))
      }
      c={item,signature,polygon:poly,texture:crop};this.cache.set(d.key,c);this.app.stage.addChild(item)
    }
    c.item.setFromMatrix(new PixiMatrix(...m));c.item.tint=p.tint;this.app.stage.setChildIndex(c.item,this.app.stage.children.length-1)
    this.picks.entries.push({key:d.key,id:d.id,matrix:m,parent:multiply(view,d.parent),polygon:c.polygon,locked:d.locked})
  }
  for(const [k,c] of this.cache)if(!used.has(k)){c.item.destroy({children:true});c.texture?.destroy(false);this.cache.delete(k)}
  this.selection.clear()
  if(grid){for(let x=0;x<w;x+=32)this.selection.moveTo(x,0).lineTo(x,h);for(let y=0;y<h;y+=32)this.selection.moveTo(0,y).lineTo(w,y);this.selection.stroke({color:0xffffff,alpha:.12,width:1})}
  for(const hit of this.picks.entries)if(selected.includes(hit.key)){
    const pts=hit.polygon.map(v=>transform(hit.matrix,v)),xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),l=Math.min(...xs)-3,t=Math.min(...ys)-3,r=Math.max(...xs)+3,b=Math.max(...ys)+3
    this.selection.rect(l,t,r-l,b-t).stroke({color:0xffcb7c,width:1.5})
    for(const [x,y] of rect(l,t,r-l,b-t))this.selection.rect(x-2.5,y-2.5,5,5).fill(0xffdd9c)
  }
  this.app.stage.setChildIndex(this.selection,this.app.stage.children.length-1);this.app.render()
 }
}
