import fs from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { stamp } from './config.js'
import { readSharedAgents, writeFileAtomic } from './store.js'

const BEGIN = '<!-- dsh-mesh:begin -->'
const END = '<!-- dsh-mesh:end -->'
const MARKER_RE = /<!--\s*dsh-mesh:(begin|end)\s*-->/gi
const KEEP_BACKUPS = 10
const MAX_DIFF_LINES = 120

export function sha256(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex')
}

/**
 * 共享内容来自同步目录，属于不可信输入：先转义托管块标记，
 * 避免 `<!-- dsh-mesh:end -->` 提前闭合块（P1-3）。
 */
function escapeMarkers(text) {
  return String(text || '').replace(MARKER_RE, (match) => match.replace('<!--', '&lt;!--'))
}

function blockOf(shared, meta = {}) {
  const body = escapeMarkers(shared).trim() || '（AGENTS.shared.md 为空）'
  const provenance = meta.sha256
    ? `> 来源：AGENTS.shared.md · sha256:${meta.sha256.slice(0, 12)}${meta.updatedAt ? ` · 更新于 ${meta.updatedAt}` : ''}`
    : null
  return [
    BEGIN,
    '## 共享记忆（dsh-mesh 自动生成，请勿手改本块）',
    '',
    ...(provenance ? [provenance, ''] : []),
    body,
    END,
  ].join('\n')
}

/** 逐行 diff（LCS）；超长内容只报告长度，不做逐行比较。 */
export function lineDiff(before, after) {
  const a = before === '' || before === undefined || before === null ? [] : String(before).split('\n')
  const b = after === '' || after === undefined || after === null ? [] : String(after).split('\n')
  if (a.length * b.length > 250_000) {
    return [{ op: '~', line: `（内容过长，跳过逐行 diff：${a.length} 行 → ${b.length} 行）` }]
  }
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: '-', line: a[i] })
      i += 1
    } else {
      out.push({ op: '+', line: b[j] })
      j += 1
    }
  }
  while (i < a.length) out.push({ op: '-', line: a[i++] })
  while (j < b.length) out.push({ op: '+', line: b[j++] })
  return out
}

function summarizeDiff(diff) {
  let added = 0
  let removed = 0
  for (const entry of diff) {
    if (entry.op === '+') added += 1
    if (entry.op === '-') removed += 1
  }
  return { added, removed, lines: diff.slice(0, MAX_DIFF_LINES), truncated: diff.length > MAX_DIFF_LINES }
}

async function readExisting(target) {
  try {
    const text = await fs.readFile(target, 'utf8')
    return { exists: true, text }
  } catch {
    return { exists: false, text: '' }
  }
}

function currentBlock(text) {
  const start = text.indexOf(BEGIN)
  const end = text.indexOf(END)
  if (start < 0 || end <= start) return ''
  return text.slice(start, end + END.length)
}

/** 计算“如果现在应用会写成什么”，不落盘。 */
export async function previewAgents(settings) {
  const dshHome = settings.dshHome
  const target = path.join(dshHome, 'AGENTS.md')
  const source = path.join(settings.memoryDir, 'AGENTS.shared.md')

  if (!existsSync(source)) {
    return { available: false, target, source, reason: 'AGENTS.shared.md 不存在，拒绝物化（避免清空托管块）' }
  }
  const shared = await readSharedAgents(settings)
  const stat = await fs.stat(source)
  const sourceSha256 = sha256(shared)
  const existing = await readExisting(target)
  const before = currentBlock(existing.text)
  const block = blockOf(shared, { sha256: sourceSha256, updatedAt: new Date(stat.mtimeMs).toISOString() })
  const blockBody = before.slice(BEGIN.length, Math.max(BEGIN.length, before.length - END.length)).trim()
  const hasBlock = before.length > 0

  const warnings = []
  if (shared !== escapeMarkers(shared)) warnings.push('共享内容里的 dsh-mesh 标记已被转义')
  if (!shared.trim() && blockBody) warnings.push('共享内容为空，但现有托管块非空')

  const start = existing.text.indexOf(BEGIN)
  const end = existing.text.indexOf(END)
  let next
  let replaced = false
  if (start >= 0 && end > start) {
    next = existing.text.slice(0, start) + block + existing.text.slice(end + END.length)
    replaced = true
  } else {
    const base = existing.text.trimEnd()
    next = `${base}${base ? '\n\n' : ''}${block}\n`
  }

  const diff = hasBlock ? lineDiff(before, block) : lineDiff('', block)
  return {
    available: true,
    target,
    source,
    exists: existing.exists,
    replaced,
    changed: next !== existing.text,
    sourceSha256,
    sourceBytes: Buffer.byteLength(shared, 'utf8'),
    sourceUpdatedAt: new Date(stat.mtimeMs).toISOString(),
    blockSha256: sha256(block),
    sanitized: shared !== escapeMarkers(shared),
    warnings,
    diff: summarizeDiff(diff),
  }
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

/**
 * 应用共享规则到设备级 AGENTS.md。
 * `expectedSha256` 来自预览，用于防止“预览之后源文件又变了”的盲写（P1-2）。
 */
export async function materializeAgents(settings, { expectedSha256 } = {}) {
  const preview = await previewAgents(settings)
  if (!preview.available) throw new Error(preview.reason)
  if (expectedSha256 && String(expectedSha256).toLowerCase() !== preview.sourceSha256) {
    throw new Error('AGENTS.shared.md 在预览之后已变化，请重新执行 preview 再应用')
  }

  const dshHome = settings.dshHome
  await fs.mkdir(dshHome, { recursive: true })
  const target = preview.target
  const existing = await readExisting(target)
  const blockStart = existing.text.indexOf(BEGIN)
  const blockEnd = existing.text.indexOf(END)
  const blockBody =
    blockStart >= 0 && blockEnd > blockStart ? existing.text.slice(blockStart + BEGIN.length, blockEnd).trim() : ''
  const shared = await readSharedAgents(settings)
  if (!String(shared || '').trim() && blockBody) {
    throw new Error('AGENTS.shared.md 为空，拒绝用空内容覆盖现有托管块（如确需清空，请手工编辑 AGENTS.md）')
  }

  const stat = await fs.stat(preview.source)
  const block = blockOf(shared, { sha256: preview.sourceSha256, updatedAt: new Date(stat.mtimeMs).toISOString() })
  let next
  if (blockStart >= 0 && blockEnd > blockStart) {
    next = existing.text.slice(0, blockStart) + block + existing.text.slice(blockEnd + END.length)
  } else {
    const base = existing.text.trimEnd()
    next = `${base}${base ? '\n\n' : ''}${block}\n`
  }
  if (next === existing.text) {
    return { changed: false, target, sourceSha256: preview.sourceSha256, blockSha256: sha256(block) }
  }

  let backup = null
  if (existing.exists) {
    backup = `${target}.bak-mesh-${stamp()}-${randomBytes(3).toString('hex')}`
    try {
      await fs.copyFile(target, backup)
    } catch {
      backup = null
    }
  }
  await writeFileAtomic(target, next)
  await rotateBackups(target)
  return {
    changed: true,
    target,
    backup,
    sourceSha256: preview.sourceSha256,
    blockSha256: sha256(block),
    sanitized: preview.sanitized,
  }
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

/** 发现目录里的符号链接（不跟随），用于 skill 同步的安全检查（P2-6）。 */
async function findSymlink(dir) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const child = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) return child
    if (entry.isDirectory()) {
      const hit = await findSymlink(child)
      if (hit) return hit
    }
  }
  return null
}

async function dirStats(dir) {  let files = 0
  let bytes = 0
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return { files, bytes }
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const child = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const inner = await dirStats(child)
      files += inner.files
      bytes += inner.bytes
    } else if (entry.isFile()) {
      try {
        const stat = await fs.stat(child)
        files += 1
        bytes += stat.size
      } catch {}
    }
  }
  return { files, bytes }
}

/** 预览 skills 同步结果，不落盘（P1-2）。 */
export async function previewSkills(settings) {
  const sourceRoot = path.join(settings.memoryDir, 'skills')
  const targetRoot = path.join(settings.dshHome, 'skills')
  const sourceDirs = await listSkillDirs(sourceRoot)
  const copy = []
  const skip = []
  const maxBytes = Number(settings.maxSkillBytes) || 2_000_000
  for (const src of sourceDirs) {
    const name = path.basename(src)
    if (!existsSync(path.join(src, 'SKILL.md'))) {
      skip.push({ name, reason: '缺少 SKILL.md' })
      continue
    }
    const link = await findSymlink(src)
    if (link) {
      skip.push({ name, reason: `包含符号链接，拒绝同步（${path.relative(src, link)}）` })
      continue
    }
    const stats = await dirStats(src)
    if (stats.bytes > maxBytes) {
      skip.push({ name, reason: `超过 maxSkillBytes（${stats.bytes} > ${maxBytes}）` })
      continue
    }
    if (existsSync(path.join(targetRoot, name))) {
      skip.push({ name, reason: '本地已存在同名 skill（需要 force 才覆盖）' })
      continue
    }
    copy.push({ name, ...stats })
  }
  return {
    sourceRoot,
    targetRoot,
    copy,
    skip,
    forceRequired: skip.filter((item) => item.reason.includes('force')).map((item) => item.name),
    maxSkillBytes: maxBytes,
  }
}

export async function syncSkills(settings, { force = false } = {}) {
  const sourceRoot = path.join(settings.memoryDir, 'skills')
  const targetRoot = path.join(settings.dshHome, 'skills')
  await fs.mkdir(targetRoot, { recursive: true })
  const sourceDirs = await listSkillDirs(sourceRoot)
  const copied = []
  const skipped = []
  const maxBytes = Number(settings.maxSkillBytes) || 2_000_000
  for (const src of sourceDirs) {
    const name = path.basename(src)
    const skillFile = path.join(src, 'SKILL.md')
    if (!existsSync(skillFile)) {
      skipped.push(`${name} (no SKILL.md)`)
      continue
    }
    // 内容护栏（P2-6）：拒绝符号链接与超大目录，不做整目录盲拷。
    const link = await findSymlink(src)
    if (link) {
      skipped.push(`${name} (contains symlink)`)
      continue
    }
    const stats = await dirStats(src)
    if (stats.bytes > maxBytes) {
      skipped.push(`${name} (too large: ${stats.bytes} bytes)`)
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
