export interface Box {x:number;y:number;w:number;h:number}
export const overlaps=(a:Box,b:Box)=>Math.abs(a.x-b.x)*2<a.w+b.w && Math.abs(a.y-b.y)*2<a.h+b.h
export function circleHit(circle:Box,rect:Box) {
  const dx=Math.max(0,Math.abs(circle.x-rect.x)-rect.w/2),dy=Math.max(0,Math.abs(circle.y-rect.y)-rect.h/2)
  return dx*dx+dy*dy<=(circle.w/2)**2
}
export class SpatialHash<T> {
  private buckets=new Map<string,Set<T>>()
  private keys(b:Box) {
    const out:string[]=[]
    const x0=Math.floor((b.x-b.w/2)/96),x1=Math.floor((b.x+b.w/2)/96),y0=Math.floor((b.y-b.h/2)/96),y1=Math.floor((b.y+b.h/2)/96)
    if((x1-x0+1)*(y1-y0+1)>65536)throw Error('空间索引超过预算')
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)out.push(x+','+y)
    return out
  }
  add(b:Box,item:T){for(const k of this.keys(b)){let bucket=this.buckets.get(k);if(!bucket)this.buckets.set(k,bucket=new Set);bucket.add(item)}}
  query(b:Box){const found=new Set<T>();for(const k of this.keys(b))this.buckets.get(k)?.forEach(x=>found.add(x));return found}
}
export function sweep(a:Box,b:Box,dx:number,dy:number) {
  function slab(dist:number,extent:number,delta:number):[number,number] {
    if(delta===0)return Math.abs(dist)<extent?[-Infinity,Infinity]:[Infinity,-Infinity]
    const t1=(dist-extent)/delta,t2=(dist+extent)/delta
    return [Math.min(t1,t2),Math.max(t1,t2)]
  }
  const [x0,x1]=slab(b.x-a.x,(a.w+b.w)/2,dx),[y0,y1]=slab(b.y-a.y,(a.h+b.h)/2,dy)
  const t=Math.max(x0,y0)
  if(t<0||t>1||t>Math.min(x1,y1))return
  return {t,nx:x0>=y0?-Math.sign(dx):0,ny:y0>=x0?-Math.sign(dy):0}
}
