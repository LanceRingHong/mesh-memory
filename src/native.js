import fs from 'node:fs'
import path from 'node:path'

function walkSync(root, rel = '') {
  const out = []
  let entries
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const child = path.join(rel, entry.name)
    if (entry.isDirectory()) out.push(...walkSync(root, child))
    else if (entry.isFile() && /\.(md|markdown|txt|jsonl)$/i.test(entry.name)) out.push(child)
  }
  return out
}

function countSync(root, rel) {
  return walkSync(root, rel).length
}

function titleOf(file) {
  try {
    const head = fs.readFileSync(file, 'utf8').slice(0, 4096)
    const match = head.match(/^title:\s*(.+)$/m)
    if (match) return match[1].trim().replace(/^["']|["']$/g, '')
  } catch {}
  return path.basename(file, path.extname(file))
}

function recentSync(root, rel, limit = 12) {
  const rows = []
  for (const file of walkSync(root, rel)) {
    try {
      const stat = fs.statSync(file)
      rows.push({
        title: titleOf(file),
        subtitle: path.relative(root, file).replace(/\\/g, '/'),
        mtimeMs: stat.mtimeMs,
        path: path.relative(root, file).replace(/\\/g, '/'),
      })
    } catch {}
  }
  return rows.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit)
}

/** 同步版安全读取（P0-2）：拒符号链接、realpath 必须仍在根目录内。 */
function readInsideSync(root, rel, maxBytes = 8000) {
  const realRoot = fs.realpathSync(root)
  const target = path.resolve(realRoot, String(rel || ''))
  if (target !== realRoot && !target.startsWith(realRoot + path.sep)) throw new Error('path escapes memoryDir')
  const link = fs.lstatSync(target)
  if (link.isSymbolicLink()) throw new Error('refuse symlink')
  if (!link.isFile()) throw new Error('not a file')
  const real = fs.realpathSync(target)
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error('path escapes memoryDir')
  return fs.readFileSync(real, 'utf8').slice(0, maxBytes)
}

function devicesSync(root) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(root, 'index', 'devices.json'), 'utf8'))
    return Array.isArray(data.devices) ? data.devices : []
  } catch {
    return []
  }
}

function snapshot(settings) {
  const root = settings.memoryDir
  const files = []
  const agents = path.join(root, 'AGENTS.shared.md')
  if (fs.existsSync(agents)) {
    files.push({
      title: '[AGENTS] AGENTS.shared.md',
      subtitle: 'AGENTS.shared.md',
      mtimeMs: fs.statSync(agents).mtimeMs,
      path: 'AGENTS.shared.md',
    })
  }
  for (const [label, rel] of [
    ['技能', 'skills'],
    ['事实', 'memory/facts'],
    ['决策', 'memory/decisions'],
    ['项目', 'memory/projects'],
    ['笔记', 'memory/notes'],
    ['摘要', 'sessions'],
    ['索引', 'index'],
  ]) {
    for (const row of recentSync(root, rel, 12)) {
      files.push({ ...row, title: `[${label}] ${row.title}`, category: label })
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)

  return {
    device: settings.deviceName,
    memoryDir: root,
    facts: countSync(root, 'memory/facts'),
    decisions: countSync(root, 'memory/decisions'),
    projects: countSync(root, 'memory/projects'),
    notes: countSync(root, 'memory/notes'),
    sessions: countSync(root, 'sessions'),
    totalFiles: files.length,
    total: files.slice(0, 50).length,
    files: files.slice(0, 50).map((row) => ({
      title: row.title,
      subtitle: row.path,
      action: { id: 'open', args: { path: row.path } },
    })),
    devices: devicesSync(root).map((d) => d.name || d.deviceSlug || 'device'),
    updatedAt: new Date().toISOString(),
  }
}

const VIEW = {
  type: 'stack',
  title: 'DSH Mesh 记忆',
  children: [
    {
      type: 'row',
      children: [
        { type: 'metric', label: '事实', value: { $: 'data.facts' } },
        { type: 'metric', label: '决策', value: { $: 'data.decisions' } },
        { type: 'metric', label: '项目', value: { $: 'data.projects' } },
        { type: 'metric', label: '会话摘要', value: { $: 'data.sessions' } },
      ],
    },
    {
      type: 'keyValue',
      items: [
        ['设备', { $: 'data.device' }],
        ['目录', { $: 'data.memoryDir' }],
      ],
    },
    { type: 'text', text: '全部同步内容（点击条目复制正文）', tone: 'muted' },
    { type: 'list', items: { $: 'data.files' } },
    {
      type: 'actions',
      items: [{ label: '刷新', action: 'refresh', style: 'primary' }],
    },
    {
      type: 'callout',
      text: '只读；完整树与搜索在浏览器 127.0.0.1:8765',
      tone: 'info',
    },
  ],
}

export function registerNative(ctx, settings) {
  ctx.inject(['dshGo'], (sub) => {
    const dshGo = sub.dshGo
    if (!dshGo || typeof dshGo.panel !== 'function') return () => {}

    const panel = {
      view: () => VIEW,
      data: (scope, emit) => {
        const tick = () => emit(snapshot(settings))
        tick()
        const timer = setInterval(tick, 30_000)
        return () => clearInterval(timer)
      },
      actions: {
        refresh: () => ({ refresh: true }),
        open: (scope, event) => {
          const rel = String(event?.value?.path || '')
          try {
            const text = readInsideSync(settings.memoryDir, rel)
            return { copy: text, toast: '已复制到剪贴板' }
          } catch {
            return { toast: '读取失败（只允许共享目录内的普通文件）' }
          }
        },
      },
    }

    const dispose = dshGo.panel('memory', panel)
    return typeof dispose === 'function' ? dispose : () => {}
  })
  return () => {}
}
