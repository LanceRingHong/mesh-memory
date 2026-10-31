import fs from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { stamp } from './config.js'
import { readSharedAgents } from './store.js'

const BEGIN = '<!-- dsh-mesh:begin -->'
const END = '<!-- dsh-mesh:end -->'

function blockOf(shared) {
  const body = String(shared || '').trim() || '（AGENTS.shared.md 为空）'
  return `${BEGIN}
## 共享记忆（dsh-mesh 自动生成，请勿手改本块）

${body}
${END}`
}

export async function materializeAgents(settings) {
  const dshHome = settings.dshHome
  await fs.mkdir(dshHome, { recursive: true })
  const target = path.join(dshHome, 'AGENTS.md')
  const shared = await readSharedAgents(settings)
  const block = blockOf(shared)

  let existing = ''
  try {
    existing = await fs.readFile(target, 'utf8')
  } catch {
    existing = ''
  }

  const start = existing.indexOf(BEGIN)
  const end = existing.indexOf(END)
  let next
  if (start >= 0 && end > start) {
    next = existing.slice(0, start) + block + existing.slice(end + END.length)
  } else {
    const base = existing.trimEnd()
    next = `${base}${base ? '\n\n' : ''}${block}\n`
  }
  if (next === existing) return { changed: false, target }

  const backup = `${target}.bak-mesh-${stamp()}`
  if (existing) {
    try {
      await fs.copyFile(target, backup)
    } catch {}
  }
  await fs.writeFile(target, next, 'utf8')
  return { changed: true, target, backup: existing ? backup : null }
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
  const manifest = path.join(settings.memoryDir, '.mesh', 'skills.json')
  await fs.mkdir(path.dirname(manifest), { recursive: true })
  await fs.writeFile(
    manifest,
    JSON.stringify({ updatedAt: new Date().toISOString(), sourceRoot, targetRoot, copied, skipped }, null, 2),
    'utf8',
  )
  return { copied, skipped, manifest }
}
