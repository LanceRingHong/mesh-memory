import fs from 'node:fs/promises'
import path from 'node:path'
import { doctor, duplicates, reflectBrief } from './maintenance.js'

/**
 * 定时反思 / 体检（0.24.0）。
 *
 * 一次跑 doctor + duplicates + reflect，结果写两处：
 * - `$DSH_HOME/dsh-memory/maintenance.json`：机器可读，保留最近 60 次，供 `/api/maintenance` 用；
 * - `$DSH_HOME/dsh-memory/reports/maintenance-<时间>.md`：人可读，保留最近 30 份。
 *
 * 放在 `$DSH_HOME` 而不是共享目录：这是本机运行状态，不该跟着 Syncthing 同步。
 */

export const DEFAULT_REFLECT_HOURS = 6
const MAX_RUNS = 60
const MAX_REPORTS = 30

export function maintenancePaths(settings) {
  const dir = path.join(settings.dshHome, 'dsh-memory')
  return { dir, stateFile: path.join(dir, 'maintenance.json'), reportDir: path.join(dir, 'reports') }
}

export async function readMaintenanceState(settings) {
  const { stateFile } = maintenancePaths(settings)
  try {
    const raw = JSON.parse(await fs.readFile(stateFile, 'utf8'))
    if (raw && Array.isArray(raw.runs)) return { runs: raw.runs, last: raw.last || raw.runs[0] || null }
  } catch {}
  return { runs: [], last: null }
}

function reportMarkdown(entry, reflect) {
  const lines = [
    `# 维护报告 ${entry.at}`,
    '',
    `- 触发：${entry.reason}`,
    `- 耗时：${entry.ms} ms`,
    `- 体检：${entry.doctor.errors} error / ${entry.doctor.warnings} warn / ${entry.doctor.infos} info`,
    `- 重复簇：${entry.duplicates}`,
    `- 自 ${reflect.checkpoint} 起变化：${reflect.changed} 条`,
    '',
    `> ${reflect.hint}`,
    '',
    '## 有变化的记忆',
    '',
  ]
  if (!reflect.groups.length) lines.push('（无）')
  for (const group of reflect.groups) {
    lines.push(`### ${group.kind}（${group.count}）`)
    for (const item of group.items) lines.push(`- ${item.title || item.path}`)
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * 跑一次维护。并发调用共用同一个 promise（serve 的定时器与手动按钮可能撞上）。
 * 每次调用都返回同一份 entry，调用方不需要自己加锁。
 */
export async function runMaintenance(settings, { reason = 'manual' } = {}) {
  const startedAt = new Date().toISOString()
  const started = Date.now()
  const [report, dup, reflect] = await Promise.all([
    doctor(settings),
    duplicates(settings),
    reflectBrief(settings, { days: 7 }),
  ])
  const entry = {
    at: startedAt,
    reason,
    ms: Date.now() - started,
    doctor: report.totals,
    duplicates: dup.clusters.length,
    changed: reflect.changed,
    checkpoint: reflect.checkpoint,
    hint: reflect.hint,
  }
  const { stateFile, reportDir } = maintenancePaths(settings)
  await fs.mkdir(reportDir, { recursive: true })
  const state = await readMaintenanceState(settings)
  state.runs = [entry, ...state.runs].slice(0, MAX_RUNS)
  state.last = entry
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8')
  const stampText = startedAt.replace(/[:.]/g, '-')
  await fs.writeFile(path.join(reportDir, `maintenance-${stampText}.md`), reportMarkdown(entry, reflect), 'utf8')
  try {
    const files = (await fs.readdir(reportDir)).filter((name) => name.startsWith('maintenance-')).sort()
    for (const name of files.slice(0, Math.max(0, files.length - MAX_REPORTS))) {
      await fs.unlink(path.join(reportDir, name)).catch(() => {})
    }
  } catch {}
  return entry
}
