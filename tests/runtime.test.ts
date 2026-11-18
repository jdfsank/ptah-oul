import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { World, Clock } from '../packages/runtime'
import { compile, applyPatch } from '../packages/scene-compiler'
import { sweep } from '../packages/runtime/physics'
for (const level of ['platformer', 'topdown'])
  test(
    level + ' is playable and restart restores score, inputs and pickups',
    () => {
      const s = compile(
          fs.readFileSync('tests/fixtures/' + level + '.oui', 'utf8'),
        ),
        w = new World(s)
      for (let i = 0; i < 220; i++)
        w.step({ down: new Set(['KeyD']), pressed: new Set() })
      assert.equal(w.error, '')
      assert.equal(w.state.$score, 1)
      assert.equal(w.instances.get('/flow')?.machine, 'won')
      assert.equal(w.instances.get('/player')?.input, false)
      assert.ok(!w.instances.has('/coin'))
      const lifecycle = w.lifecycle.slice(),
        x = w.instances.get('/player')!.x
      assert.ok(
        w.update(
          applyPatch(
            s,
            s.index.get('player_visual')!.raw.replace('#38BDF8', '#ff9900'),
          ),
          1,
        ),
      )
      assert.deepEqual(w.lifecycle, lifecycle)
      assert.equal(w.instances.get('/player')!.x, x)
      assert.ok(!w.instances.has('/coin'))
      assert.equal(
        w.update(
          applyPatch(
            s,
            s.index.get('player_shape')!.raw.replace('28, 36', '30, 36'),
          ),
          2,
        ),
        false,
      )
      assert.ok(w.pendingRestart)
      assert.equal(w.runningRevision, 1)
      w.restart()
      assert.equal(w.runningRevision, 2)
      assert.equal(
        w.instances.get('/player_shape')?.def.props.shape.size[0],
        30,
      )
      assert.equal(w.state.$score, 0)
      assert.ok(w.instances.has('/coin'))
    },
  )
test('swept AABB catches thin walls and preserves tangent', () => {
  const hit = sweep(
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 100, y: 0, w: 2, h: 100 },
    200,
    20,
  )!
  assert.equal(hit.t, 0.47)
  assert.equal(hit.nx, -1)
  assert.equal(hit.ny, 0)
})
test('clocks bound catch-up and freeze long gaps', () => {
  const c = new Clock()
  let ticks = 0
  for (let i = 0; i < 30; i++) c.advance(1 / 30, () => ticks++)
  assert.equal(ticks, 60)
  c.advance(4, () => ticks++)
  assert.equal(ticks, 60)
  c.advance(0.4, () => ticks++)
  assert.equal(ticks, 65)
})
