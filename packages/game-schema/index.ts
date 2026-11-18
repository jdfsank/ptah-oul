import { z } from 'zod'
const n=z.number().finite(), pos=n.positive(), v=z.tuple([n,n]), size=z.tuple([pos,pos]), s=z.string(), b=z.boolean(), color=z.string().regex(/^#[0-9a-f]{6}$/i)
const common={name:s,groups:z.array(s),enabled:b,locked:b}, spatial={position:v,rotation:n,scale:v,visible:b,modulate:color,z_index:n.int(),z_as_relative:b}
const body={collision_layer:n.int().nonnegative(),collision_mask:n.int().nonnegative()}
const action=z.unknown(), sprite={texture:s,region:z.tuple([n,n,pos,pos]),centered:b,offset:v,flip_h:b,flip_v:b,size}
const shapes:Record<string,Record<string,z.ZodType>>={
 GameProject:{profile:z.literal('game2d/1.0'),entry_scene:s,viewport:size,fixed_hz:z.literal(60),input_map:z.record(s,z.array(s))},Scene2D:{...spatial,gravity:v},Node:{},Node2D:spatial,
 StaticBody2D:{...spatial,...body},CharacterBody2D:{...spatial,...body},Area2D:{...spatial,...body,monitoring:b},
 CollisionShape2D:{position:v,shape:z.discriminatedUnion('type',[z.strictObject({type:z.literal('RectangleShape2D'),size}),z.strictObject({type:z.literal('CircleShape2D'),radius:pos})])},
 Polygon2D:{...spatial,polygon:z.array(v).min(3),color},Sprite2D:{...spatial,...sprite},AnimatedSprite2D:{...spatial,...sprite,animations:z.record(s,z.strictObject({frames:z.array(s).min(1),fps:pos,loop:b.optional()})),animation:s,playing:b},
 Camera2D:{...spatial,zoom:size,follow:s},CanvasLayer:{layer:n.int(),visible:b},Label:{...spatial,text:s,color,font_size:pos},Button:{...spatial,text:s,color,size,action},
 PlatformerController:{left_action:s,right_action:s,jump_action:s,speed:pos,jump_speed:pos,gravity:n.nonnegative()},TopDownController:{left_action:s,right_action:s,up_action:s,down_action:s,speed:pos},
 SignalRule:{signal:s,filter_group:s,once:b,action},Timer:{wait_time:pos,autostart:b,one_shot:b},
 StateMachine:{initial:s,states:z.array(z.strictObject({name:s,on_enter:action.optional(),on_exit:action.optional()})).min(1),transitions:z.array(z.strictObject({from:s,to:s,event:s,condition:b.optional()}))},
 ResourceRegistry:{},Texture:{asset_id:s},PrefabRegistry:{},Prefab:{},Spawner:{template:s,interval:pos,limit:n.int().positive(),position:v}
}
const required:Record<string,string[]>={GameProject:['profile','entry_scene','viewport','fixed_hz','input_map'],CollisionShape2D:['shape'],Polygon2D:['polygon'],Sprite2D:['texture'],AnimatedSprite2D:['animations','animation'],SignalRule:['signal','action'],StateMachine:['initial','states','transitions'],Texture:['asset_id'],Spawner:['template','interval','limit']}
export const schemas=Object.fromEntries(Object.entries(shapes).map(([kind,props])=>[kind,z.strictObject(Object.fromEntries(Object.entries({...common,...props}).map(([k,v])=>[k,required[kind]?.includes(k)?v:v.optional()]))) ]))
export const signatures=Object.entries(shapes).map(([k,v])=>k+'('+Object.keys(v).join(', ')+')').join('\n')
export const visualHot=new Set(['color','texture','text','visible','modulate','flip_h','flip_v','speed','jump_speed','gravity','font_size'])
