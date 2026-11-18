import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fresh,
  commit,
  exportProject,
  importProject,
} from '../packages/project-io'
import { source } from './mock-provider'
import {
  PickRegistry,
  local,
  matrix,
  multiply,
  transform,
} from '../packages/editor-tools'
import { World } from '../packages/runtime'
import { compile } from '../packages/scene-compiler'
import {
  previewStatements,
  StreamDraft,
  digest,
} from '../packages/authoring/stream'
test('save package preserves expressions, notes, history, exact source; undo advances revision', () => {
  const p = fresh('测试', source)
  p.annotations.push({
    id: 'note',
    authorId: 'player',
    statementId: 'player',
    sceneRevision: 1,
    scope: 'author_node',
    localAnchor: { x: 0, y: -2 },
    instruction: '调速',
  })
  const edit = commit(
    p,
    p.source.replace('speed: 260', 'speed: 180'),
    '调速',
    1,
    'tx',
  )
  assert.equal(commit(edit, edit.source, '重放', 1, 'tx'), edit)
  assert.throws(() => commit(edit, source, '冲突', 1, 'new'))
  assert.deepEqual(importProject(exportProject(edit)), edit)
  assert.equal(commit(edit, source, '撤销', 2).revision, 3)
})
test('picking handles parent rotation, camera zoom, overlap and locked decorations', () => {
  const m = multiply(
      matrix(30, 75, 0.6, [2, 1]),
      matrix(200, 100, 0.2, [1, 1]),
    ),
    where = transform(m, [1, 3]),
    p = new PickRegistry()
  const hit = {
    key: '/hero',
    id: 'hero',
    matrix: m,
    parent: m,
    polygon: [
      [-8, -8],
      [8, -8],
      [8, 8],
      [-8, 8],
    ] as [number, number][],
    locked: false,
  }
  p.entries = [hit, { ...hit, key: '/decoration', locked: true }]
  assert.equal(p.at(where)[0].key, '/hero')
  assert.ok(Math.abs(local(m, where)[0] - 1) < 1e-8)
})
test('prefab instances keep separate identities, timers pause and lifecycle ordering is stable', () => {
  const s =
    source
      .replace('[main])', '[main, templates])')
      .replace(
        '[floor, player, coin, goal, hud, flow]',
        '[floor, player, coin, goal, hud, flow, maker, timer]',
      ) +
    '\n' +
    [
      'templates = PrefabRegistry("templates",{},[template])',
      'template = Prefab("template",{},[orb])',
      'orb = Node2D("orb",{},[])',
      'maker = Spawner("maker",{template:"template", interval: 0.02,limit:2},[])',
      'timer = Timer("timer",{wait_time:0.05,autostart:true,one_shot:true},[rule])',
      'rule = SignalRule("timer_rule",{signal:"timeout",action:@Set($score, 5)},[])',
    ].join('\n')
  const w = new World(compile(s))
  const before = w.instances.get('/timer')!.remaining
  w.paused = true
  w.step()
  assert.equal(w.instances.get('/timer')!.remaining, before)
  w.paused = false
  for (let i = 0; i < 12; i++) w.step()
  assert.equal(w.error, '')
  assert.equal(w.state.$score, 5)
  assert.equal(w.instances.get('/maker')?.children.length, 2)
  assert.ok(w.instances.has('spawn1/orb') && w.instances.has('spawn2/orb'))
  assert.ok(
    w.lifecycle.indexOf('enter /main') < w.lifecycle.indexOf('enter /player'),
  )
  assert.ok(
    w.lifecycle.indexOf('ready /player') < w.lifecycle.indexOf('ready /main'),
  )
})
test('draft previews stay side-effect free across arbitrary chunk boundaries', async () => {
  const expected = JSON.stringify(
    [...previewStatements(source)].map(([id, s]) => [id, s.expr]),
  )
  for (const size of [1, 13, 307, source.length]) {
    const draft = new StreamDraft('t', 'p', 1, 'create')
    await draft.accept({
      kind: 'begin',
      txId: 't',
      sceneId: 'p',
      baseRevision: 1,
      mode: 'create',
      libraryVersion: 'game2d/1.0',
    })
    for (let i = 0; i < source.length; i += size)
      await draft.accept({
        kind: 'delta',
        seq: 1 + Math.floor(i / size),
        sourceDelta: source.slice(i, i + size),
        txId: 't',
      })
    await draft.accept({
      kind: 'end',
      txId: 't',
      lastSeq: draft.parts.length,
      sourceHash: await digest(source),
    })
    assert.equal(
      JSON.stringify(
        [...previewStatements(draft.parts.join(''))].map(([id, s]) => [
          id,
          s.expr,
        ]),
      ),
      expected,
    )
  }
  assert.ok(!previewStatements('root = GameProject(').size)
})
