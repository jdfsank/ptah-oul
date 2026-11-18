import {
  StreamDraft,
  previewStatements,
  type Envelope,
} from '../../packages/authoring/stream'
import { value, type Scene, type NodeDef } from '../../packages/scene-compiler'
import { schemas } from '../../packages/game-schema'
import type { Project, Annotation } from '../../packages/project-io'
export async function requestSource(
  p: Project,
  instruction: string,
  mode: 'create' | 'patch',
  selection: Partial<Annotation>[],
  signal: AbortSignal,
  preview: (code: string) => void,
) {
  let repair: { draft: string; error: string } | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    const txId = crypto.randomUUID(),
      draft = new StreamDraft(txId, p.id, p.revision, mode)
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        txId,
        sceneId: p.id,
        baseRevision: p.revision,
        mode,
        selection,
        source: mode === 'patch' ? p.source : '',
        instruction,
        assets: p.assets.map((x) => x.id),
        repair,
      }),
    })
    if (!response.ok || !response.body)
      throw Error((await response.json()).error ?? '请求失败')
    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader()
    let buffer = '',
      diagnostic = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += value
        let newline
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (!line.startsWith('data:')) continue
          const e: Envelope = JSON.parse(line.slice(5))
          if (e.kind === 'error' && e.txId === txId && e.code !== 'PROVIDER') {
            diagnostic = e.message
            break
          }
          await draft.accept(e)
          if (e.kind === 'delta') preview(draft.parts.join(''))
        }
        if (diagnostic) break
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    if (diagnostic && attempt < 2) {
      repair = { draft: draft.parts.join(''), error: diagnostic }
      continue
    }
    if (diagnostic || !draft.done)
      throw Error(diagnostic || '连接中断，原版本已保留')
    return { txId, source: draft.parts.join('') }
  }
  throw Error('定向修复未通过')
}
// Drafts contain only validated, complete visual declarations and never instantiate a World.
export function draftScene(
  base: Scene,
  source: string,
  mode: 'create' | 'patch',
): Scene | undefined {
  const statements = previewStatements(source),
    nodes = new Map<string, NodeDef>(),
    ids = new Map<string, string>(),
    defaults = { ...(mode === 'patch' ? base.defaults : {}) }
  const merged =
    mode === 'patch' ? new Map([...base.index, ...statements]) : statements
  for (const [name, s] of merged)
    if (name.startsWith('$')) {
      try {
        defaults[name] = value(s.expr, defaults)
      } catch {}
    }
  for (const [name, s] of merged) {
    const e = s.expr
    if (e.k !== 'Comp' || !Object.hasOwn(schemas, e.name)) continue
    const [a, b, c] = e.args
    if (a?.k !== 'Str' || b?.k !== 'Obj' || c?.k !== 'Arr') continue
    try {
      const props = value(b, defaults)
      if (!schemas[e.name].safeParse(props).success) continue
      ids.set(name, a.v)
      nodes.set(a.v, {
        id: a.v,
        statement: name,
        type: e.name,
        props,
        fields: Object.fromEntries(b.entries),
        children: c.els.flatMap((x) => (x.k === 'Ref' ? [x.n] : [])),
      })
    } catch {}
  }
  const root = nodes.get(ids.get('root') ?? ''),
    entry = nodes.get(root?.props.entry_scene)
  if (!root || !entry) return
  const seen = new Set([entry.id])
  function attach(n: NodeDef, depth: number) {
    n.children = n.children.flatMap((ref) => {
      const id = ids.get(ref),
        child = id ? nodes.get(id) : null
      if (!child || seen.has(child.id) || depth >= 96) return []
      seen.add(child.id)
      child.parent = n.id
      attach(child, depth + 1)
      return [child.id]
    })
  }
  attach(entry, 0)
  return { ...base, root, entry, nodes, defaults }
}
