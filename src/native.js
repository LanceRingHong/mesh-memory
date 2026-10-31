import fs from 'node:fs'
import path from 'node:path'
import { acceptInbox, rejectInbox } from './inbox.js'
import { flushAllSessions } from './capture.js'

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

export function snapshot(settings, selected) {
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

  let inbox = []
  try {
    inbox = listInboxSync(settings)
  } catch {}

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
    inboxCount: inbox.length,
    inboxLine: inbox.length ? `待确认 ${inbox.length} 条（选一条后点「接受」或「忽略」）` : '没有待确认的会话',
    inbox: inbox.slice(0, 8).map((item) => ({
      label: item.title,
      description: `${item.turns} 轮 · ${(item.updatedAt || item.createdAt || '').replace('T', ' ').slice(0, 16)}`,
      value: item.path,
    })),
    selected,
    updatedAt: new Date().toISOString(),
  }
}

/** 面板数据回调是同步 emit，所以这里用同步读目录的方式列草稿。 */
function listInboxSync(settings) {
  const dir = path.join(settings.dshHome || '', 'dsh-mesh', 'inbox', 'sessions')
  if (!settings.dshHome) return []
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('.')) continue
    try {
      const file = path.join(dir, entry.name)
      const head = fs.readFileSync(file, 'utf8').slice(0, 4096)
      const title = (head.match(/^title:\s*(.+)$/m) || [])[1] || entry.name.replace(/\.md$/, '')
      const turns = Number((head.match(/^turns:\s*(\d+)/m) || [])[1] || 0)
      const updated = (head.match(/^updatedAt:\s*(.+)$/m) || [])[1] || ''
      out.push({
        path: `sessions/${entry.name}`,
        title: String(title).replace(/^["']|["']$/g, ''),
        turns,
        updatedAt: String(updated).replace(/^["']|["']$/g, ''),
        mtimeMs: fs.statSync(file).mtimeMs,
      })
    } catch {}
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

let selectedDraft = ''

function view() {
  const children = [
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
    { type: 'text', text: { $: 'data.inboxLine' }, tone: 'muted' },
    { type: 'options', id: 'pick', options: { $: 'data.inbox' }, selected: { $: 'data.selected' } },
    {
      type: 'actions',
      items: [
        { label: '接受', action: 'accept', style: 'primary' },
        { label: '忽略', action: 'reject' },
        { label: '立即整理', action: 'flush' },
        { label: '刷新', action: 'refresh' },
      ],
    },
    { type: 'text', text: '全部同步内容（点击条目复制正文）', tone: 'muted' },
    { type: 'list', items: { $: 'data.files' } },
    { type: 'callout', text: '「接受」写入笔记（可在桌面端改分类）；「忽略」归档草稿。', tone: 'info' },
  ]
  return { type: 'stack', title: 'DSH Mesh 记忆', children }
}

export function registerNative(ctx, settings) {
  ctx.inject(['dshGo'], (sub) => {
    const dshGo = sub.dshGo
    if (!dshGo || typeof dshGo.panel !== 'function') return () => {}

    const panel = {
      view,
      data: (scope, emit) => {
        const tick = () => emit(snapshot(settings, selectedDraft))
        tick()
        const timer = setInterval(tick, 30_000)
        return () => clearInterval(timer)
      },
      actions: {
        refresh: () => ({ refresh: true }),
        pick: (scope, event) => {
          selectedDraft = String(event?.value?.value || '')
          return { refresh: true }
        },
        accept: async () => {
          if (!selectedDraft) return { toast: '先在待确认里选一条' }
          try {
            const result = await acceptInbox(settings, selectedDraft, { kind: 'notes' })
            selectedDraft = ''
            return { refresh: true, toast: `已接受 → ${result.memory}` }
          } catch (error) {
            return { toast: `接受失败：${error?.message || error}` }
          }
        },
        reject: async () => {
          if (!selectedDraft) return { toast: '先在待确认里选一条' }
          try {
            await rejectInbox(settings, selectedDraft)
            selectedDraft = ''
            return { refresh: true, toast: '已忽略' }
          } catch (error) {
            return { toast: `忽略失败：${error?.message || error}` }
          }
        },
        flush: async () => {
          try {
            const flushed = await flushAllSessions(settings, 'native')
            return { refresh: true, toast: flushed.length ? `已整理 ${flushed.length} 条` : '没有可整理的会话' }
          } catch (error) {
            return { toast: `整理失败：${error?.message || error}` }
          }
        },
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


