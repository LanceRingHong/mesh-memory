import fs from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { stamp } from './config.js'
import { readSharedAgents, writeFileAtomic } from './store.js'

const BEGIN = '<!-- dsh-mesh:begin -->'
const END = '<!-- dsh-mesh:end -->'
const MARKER_RE = /<!--\s*dsh-mesh:(begin|end)\s*-->/gi
const KEEP_BACKUPS = 10

/**
 * 共享内容来自同步目录，属于不可信输入：先转义托管块标记，
 * 避免 `<!-- dsh-mesh:end -->` 提前闭合块（P1-3）。
 */
function escapeMarkers(text) {
  return String(text || '').replace(MARKER_RE, (match) => match.replace('<!--', '&lt;!--'))
}

function blockOf(shared) {
  const body = escapeMarkers(shared).trim() || '（AGENTS.shared.md 为空）'
  return `${BEGIN}
## 共享记忆（dsh-mesh 自动生成，请勿手改本块）

${body}
${END}`
}

async function rotateBackups(target, keep = KEEP_BACKUPS) {
  const dir = path.dirname(target)
  const prefix = `${path.basename(target)}.bak-mesh-`
  let names = []
  try {
    names = (await fs.readdir(dir)).filter((name) => name.startsWith(prefix))
  } catch {
    return
  }
  names.sort().reverse()
  for (const name of names.slice(keep)) {
    try {
      await fs.rm(path.join(dir, name), { force: true })
    } catch {}
  }
}

export async function materializeAgents(settings) {
  const dshHome = settings.dshHome
  await fs.mkdir(dshHome, { recursive: true })
  const target = path.join(dshHome, 'AGENTS.md')
  const source = path.join(settings.memoryDir, 'AGENTS.shared.md')

  // 源文件不存在时拒绝写入：否则一次同步抖动就会清空设备上的共享规则（P1-11）。
  if (!existsSync(source)) {
    throw new Error('AGENTS.shared.md 不存在，拒绝物化（避免清空设备级 AGENTS.md 的托管块）')
  }
  const shared = await readSharedAgents(settings)

  let existing = ''
  try {
    existing = await fs.readFile(target, 'utf8')
  } catch {
    existing = ''
  }

  const hasBlock = existing.includes(BEGIN) && existing.includes(END)
  const blockStart = existing.indexOf(BEGIN)
  const blockEnd = existing.indexOf(END)
  const blockBody = hasBlock && blockEnd > blockStart ? existing.slice(blockStart + BEGIN.length, blockEnd).trim() : ''

  if (!String(shared || '').trim() && blockBody) {
    throw new Error('AGENTS.shared.md 为空，拒绝用空内容覆盖现有托管块（如确需清空，请手工编辑 AGENTS.md）')
  }

  const block = blockOf(shared)
  let next
  if (hasBlock && blockEnd > blockStart) {
    next = existing.slice(0, blockStart) + block + existing.slice(blockEnd + END.length)
  } else {
    const base = existing.trimEnd()
    next = `${base}${base ? '\n\n' : ''}${block}\n`
  }
  if (next === existing) return { changed: false, target, sanitized: shared !== escapeMarkers(shared) }
  if (next.includes(BEGIN, next.indexOf(BEGIN) + 1) || next.split(BEGIN).length > 2) {
    throw new Error('AGENTS.md 中出现重复的托管块标记，请先手工修复后再同步')
  }

  let backup = null
  if (existing) {
    backup = `${target}.bak-mesh-${stamp()}-${randomBytes(3).toString('hex')}`
    try {
      await fs.copyFile(target, backup)
    } catch {
      backup = null
    }
  }
  await writeFileAtomic(target, next)
  await rotateBackups(target)
  return { changed: true, target, backup, sanitized: shared !== escapeMarkers(shared) }
}

async function listSkillDirs(root) {
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => path.join(root, e.name))
}

export async function syncSkills(settings, { force = false } = {}) {
  const sourceRoot = path.join(settings.memoryDir, 'skills')
  const targetRoot = path.join(settings.dshHome, 'skills')
  await fs.mkdir(targetRoot, { recursive: true })
  const sourceDirs = await listSkillDirs(sourceRoot)
  const copied = []
  const skipped = []
  for (const src of sourceDirs) {
    const name = path.basename(src)
    const skillFile = path.join(src, 'SKILL.md')
    if (!existsSync(skillFile)) {
      skipped.push(`${name} (no SKILL.md)`)
      continue
    }
    const dst = path.join(targetRoot, name)
    if (existsSync(dst) && !force) {
      skipped.push(`${name} (exists)`)
      continue
    }
    await fs.cp(src, dst, { recursive: true, force })
    copied.push(name)
  }
  // 本地路径只写在本地清单里，且 `.mesh/` 不进同步内容（见 manifest 过滤）。
  const manifest = path.join(settings.dshHome, 'dsh-mesh-skills.json')
  await writeFileAtomic(
    manifest,
    JSON.stringify({ updatedAt: new Date().toISOString(), sourceRoot, targetRoot, copied, skipped }, null, 2),
  )
  return { copied, skipped, manifest }
}
