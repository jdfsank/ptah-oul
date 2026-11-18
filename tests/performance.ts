import { compile, applyPatch } from '../packages/scene-compiler'
import { World, noInput } from '../packages/runtime'
import { Viewport } from '../packages/render-pixi'
import { draftScene } from '../apps/editor/model'
import { propertyPatch } from '../packages/authoring'
function fixture() {
  const lines: string[] = [],
    ids: string[] = []
  for (let n = 0; n < 500; n++) {
    const id = 'paint_' + n
    if (n >= 30) ids.push(id)
    lines.push(
      id +
        ' = Polygon2D("' +
        id +
        '",{position:[' +
        (n < 30 ? 0 : 36 + (n % 25) * 76) +
        ',' +
        (n < 30 ? 0 : 30 + Math.floor(n / 25) * 51) +
        '],polygon:[[-10,-10],[10,-10],[10,10],[-10,10]],color:"#a588cb"},[])',
    )
  }
  for (const [type, count, row] of [
    ['StaticBody2D', 100, 800],
    ['CharacterBody2D', 30, 150],
    ['Area2D', 100, 450],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const id = type.toLowerCase() + '_' + i,
        shape = id + '_shape',
        controller = id + '_control'
      ids.push(id)
      lines.push(
        id +
          ' = ' +
          type +
          '("' +
          id +
          '",{position:[' +
          (20 + (i % 50) * 37) +
          ',' +
          (row + Math.floor(i / 50) * 45) +
          ']},[' +
          shape +
          (type === 'CharacterBody2D'
            ? ', ' + controller + ', paint_' + i
            : '') +
          '])',
        shape +
          ' = CollisionShape2D("' +
          shape +
          '", {shape:{type:"RectangleShape2D",size:[20,20]}},[])',
      )
      if (type === 'CharacterBody2D')
        lines.push(
          controller +
            ' = TopDownController("' +
            controller +
            '",{speed:150},[])',
        )
    }
  }
  return [
    'root = GameProject("bench",{profile:"game2d/1.0",entry_scene:"main",viewport:[1920,1080],fixed_hz:60,input_map:{move_right:["KeyD"],move_left:["KeyA"]}},[main])',
    'main = Scene2D("main",{},[' + ids.join(',') + '])',
    ...lines,
  ].join('\n')
}
const p95 = (samples: number[]) =>
  Math.round(
    samples.slice().sort((a, b) => a - b)[
      Math.ceil(samples.length * 0.95) - 1
    ] * 100,
  ) / 100
export async function measure(host: HTMLElement) {
  const source = fixture(),
    s = compile(source),
    w = new World(s),
    viewport = new Viewport()
  await viewport.init(host)
  const intervals: number[] = [],
    sim: number[] = [],
    submit: number[] = [],
    input = noInput()
  let previous = 0
  for (let i = 0; i < 150; i++) {
    const time: number = await new Promise((ok) => requestAnimationFrame(ok)),
      start = performance.now()
    input.down = new Set([i % 120 < 60 ? 'KeyD' : 'KeyA'])
    w.step(input)
    const after = performance.now()
    viewport.draw(s, w, [], false)
    if (w.error) throw Error(w.error)
    if (i >= 30) {
      intervals.push(time - previous)
      sim.push(after - start)
      submit.push(performance.now() - after)
    }
    previous = time
  }
  const patch = Array.from({ length: 20 }, (_, i) =>
    propertyPatch(s.index.get('paint_' + i)!, 'color', '#daa556'),
  ).join('\n')
  const previews: number[] = [],
    commits: number[] = []
  for (let i = 0; i < 10; i++) {
    const t = performance.now(),
      d = draftScene(s, patch, 'patch')!
    viewport.draw(d, undefined, [], false)
    const done = performance.now()
    const next = applyPatch(s, patch)
    w.update(next, i + 1)
    const finish = performance.now()
    previews.push(done - t)
    commits.push(finish - done)
  }
  viewport.destroy()
  return {
    viewport: [1920, 1080],
    dpr: devicePixelRatio,
    visible: 500,
    staticBodies: 100,
    characters: 30,
    areas: 100,
    externalTextures: 0,
    sourceBytes: new TextEncoder().encode(source).length,
    samples: 120,
    frameIntervalP95ms: p95(intervals),
    simulationP95ms: p95(sim),
    renderSubmitP95ms: p95(submit),
    preview20P95ms: p95(previews),
    commit20P95ms: p95(commits),
  }
}
