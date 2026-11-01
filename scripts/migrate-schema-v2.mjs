#!/usr/bin/env node
/**
 * dsh-mesh 记忆格式 v2 迁移（0.10.0）
 *
 * 做什么：
 *   1. 给 memory/ 下的每条记忆补齐 schema/permalink/checksum/agent/source/updatedAt；
 *   2. 按映射表归一 device 字段（默认：刘瀚予的电脑 → Mate-Book-GT-14，localhost → Magic Pad 3 Pro）；
 *   3. 会话摘要改 device，并把 sessions/<旧slug>/ 并入 sessions/<新slug>/；
 *   4. 合并设备注册表到 index/devices/<slug>.json，保留 hostId/syncthingDeviceId/aliases，清空旧 devices.json。
 *
 * 用法：
 *   node scripts/migrate-schema-v2.mjs --root "C:\Users\28365\DSH-mesh" --dry-run
 *   node scripts/migrate-schema-v2.mjs --root "C:\Users\28365\DSH-mesh" --apply
 *
 * 安全：
 *   - 默认 dry-run，不写任何文件；
 *   - --apply 前自动把 memory/sessions/index 复制到 .backups/migrate-<stamp>/；
 *   - 幂等：第二次执行应输出 0 changed。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseFrontmatter, renderNote, sha256, writeFileAtomic } from '../src/store.js'
import { slugify, stamp } from '../src/config.js'

const args = process.argv.slice(2)
const has = (name) => args.includes(name)
const value = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}

const root = path.resolve(value('--root', process.env.DSH_MESH_DIR || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'DSH-mesh')))
const apply = has('--apply')
const backupRoot = path.resolve(value('--backup', path.join(process.cwd(), '..', '.backups', `migrate-${stamp()}`)))

const DEVICE_MAP = {
  '刘瀚予的电脑': 'Mate-Book-GT-14',
  'localhost': 'Magic Pad 3 Pro',
}

function mapDevice(name) {
  const text = String(name || '').trim().replace(/^["']|["']$/g, '')
  return DEVICE_MAP[text] || text
}

async function walk(dir, out = []) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, out)
    else if (entry.isFile() && /\.md$/i.test(entry.name)) out.push(full)
  }
  return out
}

function relOf(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

function isoOf(stat) {
  return new Date(stat.mtimeMs).toISOString()
}

/** 只改会话摘要里的 device 行，其他字段原样保留。 */
function rewriteSessionDevice(text, device) {
  const normalized = String(text).replace(/\r\n?/g, '\n')
  const line = `device: ${JSON.stringify(device)}`
  if (/^device:.*$/m.test(normalized)) return normalized.replace(/^device:.*$/m, line)
  if (/^sessionId:.*$/m.test(normalized)) return normalized.replace(/^sessionId:.*$/m, (m) => `${m}\n${line}`)
  return normalized
}

const report = {
  root,
  mode: apply ? 'apply' : 'dry-run',
  backupRoot: apply ? backupRoot : null,
  memory: { total: 0, changed: 0, unchanged: 0, conflicts: 0, items: [] },
  sessions: { total: 0, changed: 0, items: [] },
  registries: { before: [], after: [], removed: [], legacyCleared: false },
}

// ---------- 1. memory ----------
const memoryFiles = (await walk(path.join(root, 'memory'))).sort()
const rows = []
for (const file of memoryFiles) {
  const rel = relOf(file)
  if (/\.sync-conflict-/i.test(rel)) {
    report.memory.conflicts += 1
    continue
  }
  const text = await fs.readFile(file, 'utf8')
  const parsed = parseFrontmatter(text)
  const stat = await fs.stat(file)
  rows.push({ file, rel, text, attrs: parsed.attrs, body: parsed.body, mtime: isoOf(stat) })
}
report.memory.total = rows.length

// 写盘前先备份（apply 模式）；dry-run 不产生任何文件。
if (apply) {
  await fs.mkdir(backupRoot, { recursive: true })
  for (const sub of ['memory', 'sessions', 'index']) {
    await fs.cp(path.join(root, sub), path.join(backupRoot, sub), { recursive: true, force: true })
  }
}

// 先登记已有 permalink，再给缺失的分配唯一值（按路径排序，结果可复现）。
const used = new Set()
for (const row of rows) {
  const existing = String(row.attrs.permalink || '').trim()
  if (existing) used.add(existing.toLowerCase())
}

for (const row of rows) {
  const attrs = { ...row.attrs }
  const before = { device: attrs.device, permalink: attrs.permalink }
  const changes = []

  if (!attrs.permalink) {
    const base = slugify(String(attrs.title || path.basename(row.rel, '.md'))) || 'note'
    let candidate = base
    for (let i = 2; used.has(candidate.toLowerCase()) && i <= 99; i += 1) candidate = `${base}-${i}`
    attrs.permalink = candidate
    used.add(candidate.toLowerCase())
    changes.push(`permalink=${candidate}`)
  }
  if (!attrs.id) {
    attrs.id = randomUUID()
    changes.push('id')
  }
  if (Number(attrs.schema) !== 2) {
    attrs.schema = 2
    changes.push('schema=2')
  }
  const mapped = mapDevice(attrs.device)
  if (mapped && mapped !== attrs.device) {
    attrs.device = mapped
    changes.push(`device: ${before.device} → ${mapped}`)
  }
  if (!attrs.agent) {
    attrs.agent = 'dsh'
    changes.push('agent=dsh')
  }
  if (!attrs.source) {
    attrs.source = 'legacy'
    changes.push('source=legacy')
  }
  if (!attrs.createdAt) {
    attrs.createdAt = row.mtime
    changes.push(`createdAt=${row.mtime}`)
  }
  if (!attrs.updatedAt) {
    attrs.updatedAt = row.mtime
    changes.push(`updatedAt=${row.mtime}`)
  }
  const checksum = sha256(String(row.body || '').trim())
  if (attrs.checksum !== checksum) {
    attrs.checksum = checksum
    changes.push('checksum')
  }

  const nextText = renderNote(attrs, row.body)
  if (nextText === row.text) {
    report.memory.unchanged += 1
    continue
  }
  report.memory.changed += 1
  report.memory.items.push({ path: row.rel, changes })
  if (apply) await writeFileAtomic(row.file, nextText)
}

// ---------- 2. sessions ----------
const sessionFiles = (await walk(path.join(root, 'sessions'))).sort()
for (const file of sessionFiles) {
  const rel = relOf(file)
  if (/\.sync-conflict-/i.test(rel)) continue
  const text = await fs.readFile(file, 'utf8')
  const parsed = parseFrontmatter(text)
  const mapped = mapDevice(parsed.attrs.device)
  report.sessions.total += 1
  if (!mapped || mapped === parsed.attrs.device) continue
  report.sessions.changed += 1
  report.sessions.items.push({ path: rel, from: parsed.attrs.device, to: mapped })
  if (apply) await writeFileAtomic(file, rewriteSessionDevice(text, mapped))
}

// 旧的 sessions/<设备名>/ 目录并入新目录（文件级移动，目标存在则跳过）。
const movedDirs = []
if (apply) {
  const sessionsRoot = path.join(root, 'sessions')
  const dirs = await fs.readdir(sessionsRoot, { withFileTypes: true }).catch(() => [])
  for (const entry of dirs) {
    if (!entry.isDirectory()) continue
    const targetName = slugify(mapDevice(entry.name))
    if (!targetName || targetName === entry.name) continue
    const from = path.join(sessionsRoot, entry.name)
    const to = path.join(sessionsRoot, targetName)
    await fs.mkdir(to, { recursive: true })
    for (const name of await fs.readdir(from)) {
      const src = path.join(from, name)
      const dst = path.join(to, name)
      const exists = await fs.stat(dst).then(() => true).catch(() => false)
      if (exists) continue
      await fs.rename(src, dst)
    }
    const rest = await fs.readdir(from).catch(() => [])
    if (!rest.length) await fs.rmdir(from).catch(() => {})
    movedDirs.push({ from: entry.name, to: targetName })
  }
}

// ---------- 3. device registries ----------
async function migrateRegistries() {
  const dir = path.join(root, 'index', 'devices')
  const legacyPath = path.join(root, 'index', 'devices.json')
  const records = new Map()

  const merge = (slug, incoming = {}) => {
    const prev = records.get(slug) || { deviceSlug: slug }
    const next = { ...prev }
    for (const [key, val] of Object.entries(incoming)) {
      if (val === undefined || val === null || val === '') continue
      if (key === 'deviceSlug') continue
      if (key === 'aliases') {
        next.aliases = [...new Set([...(next.aliases || []), ...(Array.isArray(val) ? val : [val])])]
      } else if (key === 'lastSeen') {
        if (!next.lastSeen || String(val) > String(next.lastSeen)) next.lastSeen = val
      } else if (next[key] === undefined) {
        next[key] = val
      }
    }
    records.set(slug, next)
  }

  const legacy = await fs.readFile(legacyPath, 'utf8').then(JSON.parse).catch(() => ({ devices: [] }))
  for (const item of Array.isArray(legacy.devices) ? legacy.devices : []) {
    const name = mapDevice(item.name || item.deviceSlug)
    const slug = slugify(name)
    merge(slug, { ...item, name, deviceSlug: slug, aliases: [item.name, item.deviceSlug].filter((x) => x && x !== name) })
  }

  const existing = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of existing) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.includes('.sync-conflict-')) continue
    const file = path.join(dir, entry.name)
    let data = null
    try {
      data = JSON.parse(await fs.readFile(file, 'utf8'))
    } catch {
      data = null
    }
    if (!data) continue
    const name = mapDevice(data.name || entry.name.replace(/\.json$/, ''))
    const slug = slugify(name)
    merge(slug, { ...data, name, deviceSlug: slug, aliases: [data.name, data.deviceSlug].filter((x) => x && x !== name) })
  }

  report.registries.before = [...records.keys()]
  if (apply) {
    for (const [slug, record] of records) {
      const ordered = {
        name: record.name,
        deviceSlug: slug,
        platform: record.platform || undefined,
        hostId: record.hostId || undefined,
        syncthingDeviceId: record.syncthingDeviceId || undefined,
        role: record.role || undefined,
        dashboard: record.dashboard || undefined,
        aliases: record.aliases && record.aliases.length ? [...new Set(record.aliases)] : undefined,
        lastSeen: record.lastSeen || undefined,
      }
      const clean = Object.fromEntries(Object.entries(ordered).filter(([, v]) => v !== undefined))
      await fs.mkdir(dir, { recursive: true })
      await writeFileAtomic(path.join(dir, `${slug}.json`), `${JSON.stringify(clean, null, 2)}\n`)
    }
    for (const entry of existing) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const slug = slugify(mapDevice(entry.name.replace(/\.json$/, '')))
      if (slug !== entry.name.replace(/\.json$/, '')) {
        await fs.rm(path.join(dir, entry.name), { force: true })
        report.registries.removed.push(entry.name)
      }
    }
    await writeFileAtomic(legacyPath, JSON.stringify({ devices: [] }, null, 2) + '\n')
    report.registries.legacyCleared = true
  }
  report.registries.after = [...records.keys()]
  return records
}

const registries = await migrateRegistries()

// ---------- 4. 备份 + 输出 ----------
if (apply) {
  await fs.writeFile(path.join(backupRoot, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
}

console.log(`[${report.mode}] root=${root}`)
console.log(`memory: ${report.memory.total} 条，变更 ${report.memory.changed}，未变 ${report.memory.unchanged}，冲突副本跳过 ${report.memory.conflicts}`)
for (const item of report.memory.items.slice(0, 40)) {
  console.log(`  - ${item.path}: ${item.changes.join(', ')}`)
}
if (report.memory.items.length > 40) console.log(`  … 其余 ${report.memory.items.length - 40} 条省略`)
console.log(`sessions: ${report.sessions.total} 条，device 变更 ${report.sessions.changed}`)
for (const item of report.sessions.items) console.log(`  - ${item.path}: ${item.from} → ${item.to}`)
if (movedDirs.length) for (const d of movedDirs) console.log(`  - 目录：sessions/${d.from} → sessions/${d.to}`)
console.log(`registries: ${report.registries.before.join(', ') || '(空)'} → ${report.registries.after.join(', ') || '(空)'}`)
for (const name of report.registries.removed) console.log(`  - 删除旧注册文件 index/devices/${name}`)
if (registries.size) console.log(`  当前设备：${[...registries.values()].map((r) => r.name).join(' / ')}`)
if (apply) console.log(`备份：${backupRoot}`)
else console.log('（dry-run：没有写任何文件；确认后加 --apply）')
