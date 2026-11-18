import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { z } from 'zod'
import { compile } from '../scene-compiler'
export interface Annotation {
  id: string
  authorId: string
  statementId: string
  instanceId?: string
  playSessionId?: string
  sceneRevision: number
  scope: 'author_node' | 'template'
  propertyPath?: string
  localAnchor: { x: number; y: number }
  instruction: string
  invalid?: boolean
}
export type Asset = { id: string; data: Uint8Array }
export interface Project {
  id: string
  title: string
  revision: number
  source: string
  assets: Asset[]
  annotations: Annotation[]
  history: {
    before: string
    after: string
    label: string
    revision: number
    txId: string
    reverts?: string
  }[]
}
const assetId = z.string().regex(/^[A-Za-z0-9_-]{1,150}$/)
const note = z.object({
  id: z.string(),
  authorId: z.string(),
  statementId: z.string(),
  instanceId: z.string().optional(),
  playSessionId: z.string().optional(),
  sceneRevision: z.number().int().nonnegative(),
  scope: z.enum(['author_node', 'template']),
  propertyPath: z.string().optional(),
  localAnchor: z.object({ x: z.number(), y: z.number() }),
  instruction: z.string(),
  invalid: z.boolean().optional(),
})
const historySchema = z.array(
  z.object({
    before: z.string(),
    after: z.string(),
    label: z.string(),
    revision: z.number().int(),
    txId: z.string(),
    reverts: z.string().optional(),
  }),
)
const manifest = z.object({
  format: z.literal(1),
  schema: z.literal('game2d/1.0'),
  langCore: z.literal('1.1.1'),
  runtime: z.literal('0.1.0'),
  id: z.string().min(1),
  title: z.string().min(1),
  revision: z.number().int().nonnegative(),
  entry: z.literal('project.oui'),
  assets: z.array(assetId),
})
export function fresh(title: string, source: string): Project {
  compile(source)
  return {
    id: crypto.randomUUID(),
    title,
    revision: 1,
    source,
    assets: [],
    annotations: [],
    history: [],
  }
}
export function commit(
  p: Project,
  source: string,
  label: string,
  base: number,
  txId: string = crypto.randomUUID(),
): Project {
  if (p.history.some((h) => h.txId === txId)) return p
  if (base !== p.revision) throw Error('作者版本已变化，请重新提交')
  const scene = compile(
      source,
      p.assets.map((a) => a.id),
    ),
    revision = base + 1
  return {
    ...p,
    source,
    revision,
    history: [
      ...p.history,
      { before: p.source, after: source, label, revision, txId },
    ],
    annotations: p.annotations.map((a) =>
      !scene.nodes.has(a.authorId) ? { ...a, invalid: true } : a,
    ),
  }
}
export function undoTarget(p: Project) {
  const reverted = new Set(p.history.map((h) => h.reverts).filter(Boolean))
  return p.history.findLast((h) => !h.reverts && !reverted.has(h.txId))
}
export function exportProject(p: Project, withHistory = true) {
  const meta = {
    format: 1,
    schema: 'game2d/1.0',
    langCore: '1.1.1',
    runtime: '0.1.0',
    id: p.id,
    title: p.title,
    revision: p.revision,
    entry: 'project.oui',
    assets: p.assets.map((a) => a.id),
  }
  const files: Record<string, Uint8Array> = {
    'project.oui': strToU8(p.source),
    'manifest.json': strToU8(JSON.stringify(meta)),
    'annotations.json': strToU8(JSON.stringify(p.annotations)),
  }
  if (withHistory) files['history.json'] = strToU8(JSON.stringify(p.history))
  for (const a of p.assets) files['assets/' + a.id + '.png'] = a.data
  return zipSync(files, { level: 3 })
}
export function checkPNG(data: Uint8Array) {
  if (
    data.length < 24 ||
    [137, 80, 78, 71, 13, 10, 26, 10].some((x, i) => data[i] !== x)
  )
    throw Error('需要 PNG 纹理')
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (
    !v.getUint32(16) ||
    !v.getUint32(20) ||
    v.getUint32(16) * v.getUint32(20) > 16777216
  )
    throw Error('图像尺寸超限')
}
export function importProject(data: Uint8Array): Project {
  if (data.length > 64_000_000) throw Error('项目包过大')
  let total = 0,
    count = 0
  const f = unzipSync(data, {
    filter(entry) {
      total += entry.originalSize
      if (
        ++count > 1024 ||
        total > 100_000_000 ||
        entry.originalSize > 32_000_000
      )
        throw Error('项目包超过限额')
      return true
    },
  })
  const read = (name: string) => {
    if (!f[name]) throw Error('缺少 ' + name)
    return strFromU8(f[name])
  }
  const m = manifest.parse(JSON.parse(read('manifest.json'))),
    source = read(m.entry),
    annotations = z.array(note).parse(JSON.parse(read('annotations.json')))
  if (new Set(m.assets).size !== m.assets.length) throw Error('资源 ID 重复')
  const assets = m.assets.map((id) => {
    const data = f['assets/' + id + '.png']
    if (!data) throw Error('缺少纹理 ' + id)
    checkPNG(data)
    return { id, data }
  })
  const scene = compile(source, m.assets)
  if (annotations.some((a) => !a.invalid && !scene.nodes.has(a.authorId)))
    throw Error('标注目标不存在')
  const history = f['history.json']
    ? historySchema.parse(JSON.parse(read('history.json')))
    : []
  return {
    id: m.id,
    title: m.title,
    revision: m.revision,
    source,
    assets,
    annotations,
    history,
  }
}
let connection: Promise<IDBDatabase> | undefined
function db() {
  return (connection ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('ptah-studio', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('project')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
}
export async function loadProject(): Promise<Project | undefined> {
  const conn = await db()
  return new Promise((ok, no) => {
    const r = conn.transaction('project').objectStore('project').get('current')
    r.onsuccess = () => ok(r.result)
    r.onerror = () => no(r.error)
  })
}
export async function saveProject(p: Project) {
  const conn = await db()
  return new Promise<void>((ok, no) => {
    const tx = conn.transaction('project', 'readwrite')
    tx.objectStore('project').put(p, 'current')
    tx.oncomplete = () => ok()
    tx.onabort = () => no(tx.error)
    tx.onerror = () => no(tx.error)
  })
}
