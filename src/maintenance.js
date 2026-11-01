import fs from 'node:fs/promises'
import path from 'node:path'
import { parseFrontmatter, readInside, sha256, listConflicts, walk, writeNote } from './store.js'

/**
 * 记忆维护层（0.11.0）：doctor / duplicates / reflect / onboard。
 * 只读为主；任何写操作都由调用方显式传入 confirm。
 */

function relOf(settings, file) {
  return path.relative(settings.memoryDir, file).replace(/\\/g, '/')
}

function iso(ms) {
  return new Date(ms).toISOString()
}

async function loadMemoryDocs(settings) {
  const docs = []
  for (const file of await walk(settings.memoryDir, 'memory')) {
    const rel = relOf(settings, file)
    if (/\.sync-conflict-/i.test(rel)) continue
    let text = ''
    try {
      text = await readInside(settings, rel, { maxBytes: 2_000_000 })
    } catch {
      continue
    }
    const stat = await fs.stat(file).catch(() => null)
    const parsed = parseFrontmatter(text)
    docs.push({
      path: rel,
      file,
      text,
      attrs: parsed.attrs,
      body: String(parsed.body || ''),
      size: stat?.size || 0,
      mtimeMs: stat?.mtimeMs || 0,
      updatedAt: String(parsed.attrs.updatedAt || ''),
    })
  }
  return docs
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^\d{8}-\d{6}-[0-9a-f]{6,8}-/, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** 体检：只读，给出可执行的修复建议。 */
export async function doctor(settings) {
  const docs = await loadMemoryDocs(settings)
  const findings = []
  const permalinks = new Map()
  const checksums = new Map()

  for (const doc of docs) {
    const a = doc.attrs
    if (!a.permalink) {
      findings.push({ severity: 'error', code: 'missing-permalink', path: doc.path, message: '缺少 permalink', fix: '运行 scripts/migrate-schema-v2.mjs --apply' })
    } else {
      const key = String(a.permalink).toLowerCase()
      if (permalinks.has(key)) {
        findings.push({ severity: 'error', code: 'duplicate-permalink', path: doc.path, message: `permalink 与 ${permalinks.get(key)} 重复`, fix: '改 permalink（-2/-3）' })
      } else {
        permalinks.set(key, doc.path)
      }
    }
    const body = String(doc.body || '').trim()
    const checksum = sha256(body)
    if (!a.checksum) {
      findings.push({ severity: 'warn', code: 'missing-checksum', path: doc.path, message: '缺少 checksum', fix: '更新一次正文或重跑迁移' })
    } else if (String(a.checksum) !== checksum) {
      findings.push({ severity: 'warn', code: 'checksum-mismatch', path: doc.path, message: 'checksum 与正文不一致（可能被手工改过）', fix: '用 mesh_memory_update 重写正文以重算' })
    }
    if (!a.title) findings.push({ severity: 'warn', code: 'missing-title', path: doc.path, message: '缺少 title', fix: '补 title' })
    if (!a.device) findings.push({ severity: 'warn', code: 'missing-device', path: doc.path, message: '缺少 device', fix: '补 device' })
    if (!a.agent) findings.push({ severity: 'info', code: 'missing-agent', path: doc.path, message: '缺少 agent（旧数据）', fix: '可忽略' })
    for (const key of ['validAt', 'invalidAt']) {
      if (a[key] && Number.isNaN(Date.parse(String(a[key])))) {
        findings.push({ severity: 'warn', code: 'bad-date', path: doc.path, message: `${key} 不是可解析时间`, fix: '改成 ISO 时间' })
      }
    }
    if (a.supersededBy && !docs.some((d) => d.attrs.permalink === a.supersededBy || d.path === a.supersededBy)) {
      findings.push({ severity: 'info', code: 'dangling-superseded', path: doc.path, message: `supersededBy 指向不存在：${a.supersededBy}`, fix: '检查路径/permalink' })
    }
    if (doc.size > 200_000) {
      findings.push({ severity: 'info', code: 'large-note', path: doc.path, message: `文件较大（${Math.round(doc.size / 1024)} KB）`, fix: '考虑拆分成多条' })
    }
    const cs = String(a.checksum || '')
    if (cs) {
      if (!checksums.has(cs)) checksums.set(cs, [])
      checksums.get(cs).push(doc.path)
    }
  }

  for (const [cs, paths] of checksums) {
    if (paths.length > 1) {
      findings.push({ severity: 'warn', code: 'exact-duplicate', path: paths[0], message: `正文完全相同：${paths.join('、')}`, fix: '用 mesh_memory_duplicates 查看后合并/删除' })
    }
  }

  const conflicts = await listConflicts(settings).catch(() => [])
  for (const conflict of conflicts) {
    findings.push({ severity: 'warn', code: 'sync-conflict', path: conflict.path, message: '存在 Syncthing 冲突副本', fix: '在 UI 的待确认里合并，或手工保留一份' })
  }

  const inboxDir = path.join(settings.dshHome || '', 'dsh-mesh', 'inbox', 'sessions')
  const inboxCount = await fs.readdir(inboxDir).then((list) => list.filter((x) => x.endsWith('.md')).length).catch(() => 0)
  if (inboxCount > 20) {
    findings.push({ severity: 'info', code: 'inbox-backlog', path: 'inbox', message: `待确认草稿 ${inboxCount} 条`, fix: '用 mesh_memory_inbox flush/accept/reject 清理' })
  }

  const errors = findings.filter((x) => x.severity === 'error').length
  const warnings = findings.filter((x) => x.severity === 'warn').length
  return {
    ok: errors === 0,
    generatedAt: new Date().toISOString(),
    totals: {
      notes: docs.length,
      errors,
      warnings,
      infos: findings.length - errors - warnings,
      conflicts: conflicts.length,
      inbox: inboxCount,
    },
    findings,
  }
}

/** 重复检测：正文 checksum 完全相同 + 标题归一化后相同。 */
export async function duplicates(settings) {
  const docs = await loadMemoryDocs(settings)
  const byChecksum = new Map()
  const byTitle = new Map()
  for (const doc of docs) {
    const cs = String(doc.attrs.checksum || '').trim()
    if (cs) {
      if (!byChecksum.has(cs)) byChecksum.set(cs, [])
      byChecksum.get(cs).push(doc)
    }
    const key = normalizeTitle(doc.attrs.title)
    if (key) {
      if (!byTitle.has(key)) byTitle.set(key, [])
      byTitle.get(key).push(doc)
    }
  }
  const clusters = []
  for (const [checksum, items] of byChecksum) {
    if (items.length > 1) clusters.push({ reason: 'same-checksum', checksum, items: items.map(brief), suggestion: '保留最早的一条，其余软删除' })
  }
  for (const [title, items] of byTitle) {
    if (items.length > 1 && !clusters.some((c) => items.every((i) => c.items.some((x) => x.path === i.path)))) {
      clusters.push({ reason: 'same-title', title, items: items.map(brief), suggestion: '人工确认后合并' })
    }
  }
  return { ok: true, generatedAt: new Date().toISOString(), clusters }

  function brief(doc) {
    return {
      path: doc.path,
      title: String(doc.attrs.title || ''),
      permalink: String(doc.attrs.permalink || ''),
      updatedAt: doc.updatedAt,
      size: doc.size,
    }
  }
}

/** 反思简报：自上次反思（或 N 天前）以来变化的记忆。 */
export async function reflectBrief(settings, { since = '', days = 7 } = {}) {
  const docs = await loadMemoryDocs(settings)
  let checkpoint = since ? Date.parse(since) : NaN

  if (!Number.isFinite(checkpoint)) {
    const reflections = docs
      .filter((d) => /reflection|反思/i.test(`${d.attrs.title || ''} ${d.path}`))
      .map((d) => Date.parse(d.updatedAt || iso(d.mtimeMs)))
      .filter((t) => Number.isFinite(t))
    checkpoint = reflections.length ? Math.max(...reflections) : Date.now() - Math.max(1, Number(days) || 7) * 86_400_000
  }

  const changed = docs
    .map((doc) => ({ doc, at: Date.parse(doc.updatedAt || iso(doc.mtimeMs)) }))
    .filter((row) => Number.isFinite(row.at) && row.at > checkpoint)
    .sort((a, b) => b.at - a.at)

  const groups = new Map()
  for (const { doc, at } of changed) {
    const kind = String(doc.attrs.kind || doc.path.split('/')[1] || 'notes')
    if (!groups.has(kind)) groups.set(kind, [])
    groups.get(kind).push({ path: doc.path, title: String(doc.attrs.title || ''), updatedAt: iso(at) })
  }

  return {
    ok: true,
    checkpoint: iso(checkpoint),
    changed: changed.length,
    groups: [...groups.entries()].map(([kind, items]) => ({ kind, count: items.length, items: items.slice(0, 20) })),
    hint: changed.length
      ? '用 mesh_reflect 技能：把持久结论折回对应笔记，再写一条 reflection 笔记。'
      : '自上次反思以来没有变化。',
  }
}

/** 入门蓝图：根据领域生成结构建议，不写盘。 */
export function onboardBlueprint({ domains = [], volume = 'light', project = 'my-memory' } = {}) {
  const picked = (Array.isArray(domains) ? domains.filter(Boolean) : []).slice(0, 6)
  const list = picked.length ? picked : ['项目与任务', '偏好与决策', '技术笔记']
  const kinds = [
    { kind: 'projects', purpose: '目标、路线、里程碑', noteType: 'project' },
    { kind: 'decisions', purpose: '做过的选择与理由', noteType: 'project' },
    { kind: 'facts', purpose: '稳定事实、偏好、环境', noteType: 'user' },
    { kind: 'notes', purpose: '临时笔记与反思', noteType: 'reference' },
  ]
  const heavy = volume === 'heavy'
  return {
    project,
    volume,
    domains: list,
    kinds,
    baseline: [
      { title: `${project} 使用约定`, kind: 'facts', memoryType: 'feedback', baseline: true, baselinePriority: 10 },
    ],
    firstNotes: list.map((d) => ({ title: d, kind: 'projects', memoryType: 'project', description: `${d} 的目标与进展` })),
    folders: heavy ? ['memory/{kind}', 'sessions/{device}', 'skills', 'index'] : ['memory/{kind}', 'sessions/{device}'],
    rules: [
      '先 search 再 write，避免重复',
      '一条记忆一个主题；标题写清结论，description 写一句话',
      '决策写 decisions 并带理由；偏好写 facts 且 baseline 视需要',
      '过期用 supersededBy / invalidAt，不删除',
    ],
  }
}

/** 把蓝图落成一条笔记；必须 confirm。 */
export async function applyOnboarding(settings, blueprint, { confirm = false } = {}) {
  if (confirm !== true) throw new Error('落盘需要 confirm:true')
  const title = `${blueprint.project} 入门蓝图`
  const content = [
    `## 领域`,
    ...blueprint.domains.map((d) => `- ${d}`),
    '',
    '## 分类',
    ...blueprint.kinds.map((k) => `- \`${k.kind}\`：${k.purpose}`),
    '',
    '## 规则',
    ...blueprint.rules.map((r) => `- ${r}`),
    '',
    '## 下一步',
    '- 按领域各写 2–3 条真实记忆（不要占位数据）',
    '- 需要时把稳定规则写进 AGENTS.shared.md（预览 + confirm）',
  ].join('\n')
  const file = await writeNote(settings, {
    kind: 'notes',
    memoryType: 'reference',
    title,
    description: `入门蓝图：${blueprint.domains.join('、')}`,
    content,
    tags: ['onboarding', 'blueprint'],
    agent: settings.agentName,
    source: 'onboard',
  })
  return { path: path.relative(settings.memoryDir, file).replace(/\\/g, '/'), title }
}

/** 定时维护：体检 + 重复检测，报告写到 $DSH_HOME/dsh-mesh/reports/。 */
export async function runMaintenance(settings) {
  const report = await doctor(settings)
  const dup = await duplicates(settings)
  const dir = path.join(settings.dshHome || '', 'dsh-mesh', 'reports')
  await fs.mkdir(dir, { recursive: true })
  const day = new Date().toISOString().slice(0, 10)
  const file = path.join(dir, `doctor-${day}.md`)
  const lines = [
    `# 记忆体检 ${report.generatedAt}`,
    '',
    `- 笔记：${report.totals.notes}`,
    `- error：${report.totals.errors}`,
    `- warn：${report.totals.warnings}`,
    `- 冲突：${report.totals.conflicts}`,
    `- 收件箱：${report.totals.inbox}`,
    `- 重复簇：${dup.clusters.length}`,
  ]
  if (report.findings.length) {
    lines.push('', '## 发现')
    for (const item of report.findings) lines.push(`- [${item.severity}] ${item.path}：${item.message}（${item.fix}）`)
  }
  if (dup.clusters.length) {
    lines.push('', '## 重复')
    for (const cluster of dup.clusters) lines.push(`- ${cluster.reason}：${cluster.items.map((i) => i.path).join('、')}`)
  }
  await fs.writeFile(file, `${lines.join('\n')}\n`, 'utf8')
  return { ...report.totals, duplicateClusters: dup.clusters.length, report: file }
}
