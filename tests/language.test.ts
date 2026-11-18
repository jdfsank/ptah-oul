import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { applyPatch, compile, hotCompatible } from '../packages/scene-compiler'
import { propertyPatch } from '../packages/authoring'
import { StreamDraft, digest } from '../packages/authoring/stream'
const source = fs.readFileSync('tests/fixtures/platformer.oui', 'utf8')
test('appendix compiles and literal patch retains all other declarations', () => {
  const s = compile(source),
    before = s.index.get('player_visual')!,
    patched = propertyPatch(before, 'color', '#ff7700')
  const after = applyPatch(s, patched)
  assert.equal(after.source, source.replace(before.raw, patched))
  assert.ok(hotCompatible(s, after))
  assert.throws(() =>
    propertyPatch(s.index.get('score_label')!, 'text', 'constant'),
  )
})
test('strict compilation rejects recovery, invalid graph, properties and physics', () => {
  for (const src of [
    source + 'garbage',
    source.slice(0, -4),
    source.replace('collision_layer: 2', 'bad: 2'),
    source.replace('position: [480, 500]', 'rotation: 1'),
    source.replace('"coin_visual"', '"coin"'),
    source.replace(
      '[player_shape, player_visual, move]',
      '[unknown, player_visual, move]',
    ),
  ])
    assert.throws(() => compile(src))
  assert.throws(() => applyPatch(compile(source), 'unused = Bad("x", {}, [])'))
})
test('stream requires consistent sequence, hash, base and end', async () => {
  const d = new StreamDraft('t', 's', 1, 'create')
  await d.accept({
    kind: 'begin',
    txId: 't',
    sceneId: 's',
    baseRevision: 1,
    mode: 'create',
    libraryVersion: 'game2d/1.0',
  })
  const e = { kind: 'delta' as const, txId: 't', seq: 1, sourceDelta: 'x' }
  await d.accept(e)
  await d.accept(e)
  await assert.rejects(d.accept({ ...e, seq: 3 }))
  await assert.rejects(
    d.accept({ kind: 'end', txId: 't', lastSeq: 1, sourceHash: 'bad' }),
  )
  await d.accept({
    kind: 'end',
    txId: 't',
    lastSeq: 1,
    sourceHash: await digest('x'),
  })
  assert.ok(d.done)
})
test('deletion requires closed references and node identities survive edits', () => {
  const scene = compile(source)
  assert.throws(() => applyPatch(scene, 'coin = null'))
  assert.throws(() =>
    applyPatch(
      scene,
      scene.index.get('coin')!.raw.replace('"coin"', '"reused_id"'),
    ),
  )
  const cut = scene.index
    .get('main')!
    .raw.replace('player, coin, goal', 'player, goal')
  // A removed parent can be garbage collected together with its children.
  const next = applyPatch(scene, cut)
  assert.ok(!next.nodes.has('coin'))
  assert.ok(!next.nodes.has('pickup'))
})
