#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { settingsOf } from '../src/config.js'
import { ensureLayout, writeNote, searchMemory, readMemory, recentFiles, counts, parseFrontmatter, listDevices } from '../src/store.js'
import { doctor, duplicates, reflectBrief, onboardBlueprint, applyOnboarding } from '../src/maintenance.js'
import { queryMemory, statusCounts } from '../src/query.js'
import { archiveNote, unarchiveNote } from '../src/lifecycle.js'
import { contextFor, buildLinkGraph } from '../src/links.js'
import { listTasks, taskSummary } from '../src/tasks.js'

const argv = process.argv.slice(2)
const cmd = argv[0] || 'help'
const flags = {}
const positional = []
for (let i = 1; i < argv.length; i += 1) {
  const item = argv[i]
  if (item.startsWith('--')) {
    const key = item.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) flags[key] = true
    else {
      flags[key] = next
      i += 1
    }
  } else positional.push(item)
}

const settings = settingsOf({
  memoryDir: String(flags.dir || process.env.DSH_MESH_DIR || ''),
  agentName: process.env.DSH_MESH_AGENT || 'cli',
  deviceName: process.env.DSH_MESH_DEVICE || '',
})

const json = flags.json === true
const out = (value) => console.log(json ? JSON.stringify(value, null, 2) : typeof value === 'string' ? value : JSON.stringify(value, null, 2))

await ensureLayout(settings)

switch (cmd) {
  case 'search': {
    const query = positional.join(' ')
    if (!query) fail('用法：mm search <关键词> [--limit 20] [--json]')
    const rows = await searchMemory(settings, query, Number(flags.limit) || 20)
    if (json) out({ count: rows.length, results: rows })
    else {
      out(`${rows.length} 条结果`)
      for (const row of rows) console.log(`- ${row.path}（${row.score}）${row.title ? ` ${row.title}` : ''}\n  ${row.snippet.slice(0, 160)}`)
    }
    break
  }
  case 'read': {
    const rel = positional[0]
    if (!rel) fail('用法：mm read <相对路径>')
    out(await readMemory(settings, rel))
    break
  }
  case 'write': {
    if (!flags.title || !flags.content) fail('用法：mm write --title "标题" --content "正文" [--kind facts] [--tags a,b]')
    const file = await writeNote(settings, {
      kind: String(flags.kind || 'notes'),
      memoryType: String(flags.type || 'reference'),
      title: String(flags.title),
      content: String(flags.content),
      description: flags.description ? String(flags.description) : undefined,
      tags: flags.tags ? String(flags.tags).split(',').map((x) => x.trim()).filter(Boolean) : [],
      agent: settings.agentName,
      source: 'cli',
    })
    out({ ok: true, path: path.relative(settings.memoryDir, file).replace(/\\/g, '/') })
    break
  }
  case 'recent': {
    const base = flags.kind ? `memory/${String(flags.kind)}` : 'memory'
    const rows = await recentFiles(settings, base, Number(flags.limit) || 10)
    if (json) out(rows)
    else for (const row of rows) console.log(`- ${row.path}\n  ${row.title}`)
    break
  }
  case 'doctor': {
    const report = await doctor(settings)
    if (json) out(report)
    else {
      console.log(`笔记 ${report.totals.notes} · error ${report.totals.errors} · warn ${report.totals.warnings} · 冲突 ${report.totals.conflicts}`)
      for (const item of report.findings) console.log(`- [${item.severity}] ${item.path}: ${item.message} → ${item.fix}`)
      if (!report.findings.length) console.log('干净。')
    }
    break
  }
  case 'duplicates': {
    const report = await duplicates(settings)
    if (json) out(report)
    else {
      console.log(`${report.clusters.length} 组重复`)
      for (const cluster of report.clusters) console.log(`- ${cluster.reason}: ${cluster.items.map((i) => i.path).join(' / ')}`)
    }
    break
  }
  case 'reflect': {
    const report = await reflectBrief(settings, { days: Number(flags.days) || 7 })
    if (json) out(report)
    else {
      console.log(`自 ${report.checkpoint} 起变化 ${report.changed} 条`)
      for (const group of report.groups) {
        console.log(`\n[${group.kind}] ${group.count}`)
        for (const item of group.items) console.log(`- ${item.path}  ${item.title}`)
      }
    }
    break
  }
  case 'context': {
    const query = positional.join(' ')
    const ctx = await contextFor(settings, {
      path: flags.path ? String(flags.path) : undefined,
      query: query || undefined,
      depth: Number(flags.depth) || 1,
      limit: Number(flags.limit) || 8,
    })
    if (json) out(ctx)
    else {
      console.log(`${ctx.count} 条（种子 ${ctx.seeds.length}）`)
      for (const item of ctx.items) {
        console.log(`\n## [${item.relation}] ${item.title || item.path}\n${item.path}\n\n${item.excerpt.slice(0, 400)}`)
      }
      if (ctx.broken.length) console.log(`\n断链 ${ctx.broken.length} 条`)
    }
    break
  }
  case 'query': {
    const filters = {}
    for (const [key, value] of Object.entries({
      kind: flags.kind, memoryType: flags.type, status: flags.status,
      device: flags.device, agent: flags.agent, tag: flags.tag, title: flags.title,
      updatedAfter: flags.after, updatedBefore: flags.before,
    })) {
      if (value !== undefined && value !== true) filters[key] = String(value)
    }
    const result = await queryMemory(settings, filters, {
      limit: Number(flags.limit) || 100,
      includeInvalid: flags['include-invalid'] === true,
    })
    if (json) out(result)
    else {
      console.log(`${result.count} 条`)
      for (const item of result.items) console.log(`- ${item.path}  [${item.status}] ${item.title}`)
    }
    break
  }
  case 'archive': {
    const rel = positional[0]
    if (!rel) fail('用法：mm archive <相对路径> --confirm')
    if (flags.confirm !== true) fail('归档需要 --confirm（可 unarchive 恢复）')
    out(await archiveNote(settings, rel, { confirm: true }))
    break
  }
  case 'unarchive': {
    const rel = positional[0]
    if (!rel) fail('用法：mm unarchive <相对路径>')
    out(await unarchiveNote(settings, rel))
    break
  }
  case 'tasks': {
    if (flags.summary === true) {
      out(await taskSummary(settings))
      break
    }
    const result = await listTasks(settings, { status: flags.status ? String(flags.status) : undefined, limit: Number(flags.limit) || 50 })
    if (json) out(result)
    else {
      console.log(`${result.count} 个任务`)
      for (const task of result.items) console.log(`- [${task.status}] ${task.id} ${task.title} → ${task.hostName || task.hostId || ''}`)
    }
    break
  }
  case 'topology': {
    await ensureLayout(settings)
    const [devices, c, statuses, tasks, graph] = await Promise.all([
      listDevices(settings), counts(settings), statusCounts(settings), taskSummary(settings), buildLinkGraph(settings),
    ])
    out({
      local: { device: settings.deviceName, agent: settings.agentName, memoryDir: settings.memoryDir },
      counts: c,
      statuses,
      tasks,
      graph: { nodes: graph.nodes.length, edges: graph.edges.length, broken: graph.broken.length },
      devices: devices.map((d) => ({ name: d.name, deviceSlug: d.deviceSlug, hostId: d.hostId || '', platform: d.platform || '', lastSeen: d.lastSeen || '' })),
    })
    break
  }
  case 'onboard': {
    const domains = flags.domains ? String(flags.domains).split(',').map((x) => x.trim()).filter(Boolean) : []
    const blueprint = onboardBlueprint({ domains, volume: String(flags.volume || 'light'), project: String(flags.project || 'my-memory') })
    if (flags.apply !== true) {
      out(blueprint)
      break
    }
    const result = await applyOnboarding(settings, blueprint, { confirm: flags.confirm === true })
    out(result)
    break
  }
  case 'status': {
    const [c, inbox] = await Promise.all([counts(settings), fs.readdir(path.join(settings.dshHome, 'dsh-mesh', 'inbox', 'sessions')).catch(() => [])])
    out({ device: settings.deviceName, agent: settings.agentName, memoryDir: settings.memoryDir, counts: { ...c, inbox: inbox.filter((x) => x.endsWith('.md')).length } })
    break
  }
  default:
    console.log(`mesh-memory CLI

  mm search <关键词>        搜索记忆
  mm read <相对路径>        读取一条
  mm write --title ... --content ...
  mm recent [--kind facts]  最近更新
  mm context <主题>         沿 wikilink 组装上下文
  mm query --kind facts --tag x  按元数据过滤
  mm archive <路径> --confirm     归档
  mm unarchive <路径>             取消归档
  mm tasks [--status running]     任务列表
  mm topology                     设备/计数/图规模
  mm doctor                 体检
  mm duplicates             重复检测
  mm reflect [--days 7]     反思简报
  mm onboard --domains a,b [--apply --confirm]
  mm status                 设备/计数

环境：DSH_MESH_DIR / DSH_MESH_DEVICE / DSH_MESH_AGENT；加 --json 输出原始 JSON。`)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
