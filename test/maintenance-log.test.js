import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { makeSettings, writeMemoryFile, memoryDoc } from './helpers.js'
import { runMaintenance, readMaintenanceState, maintenancePaths } from '../src/maintenance-log.js'
import { duplicates } from '../src/maintenance.js'

test('定时反思：一次运行落状态文件与可读报告', async (t) => {
  const { settings, memoryDir, cleanup } = await makeSettings()
  t.after(cleanup)
  await writeMemoryFile(
    memoryDir,
    'memory/facts/a.md',
    memoryDoc({ title: '甲', body: '内容一', extra: { kind: 'facts', permalink: 'a-1', device: 'test-device' } }),
  )

  const entry = await runMaintenance(settings, { reason: 'scheduled' })
  assert.equal(entry.reason, 'scheduled')
  assert.equal(typeof entry.at, 'string')
  assert.equal(entry.doctor.errors, 0)
  assert.ok(entry.changed >= 1, '新建的记忆应算作变化')

  const { stateFile, reportDir } = maintenancePaths(settings)
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'))
  assert.equal(state.runs.length, 1)
  assert.equal(state.last.at, entry.at)

  const reports = await fs.readdir(reportDir)
  assert.equal(reports.length, 1)
  const report = await fs.readFile(path.join(reportDir, reports[0]), 'utf8')
  assert.match(report, /维护报告/)
  assert.match(report, /甲/)
})

test('定时反思：多次运行累积（最近一次在前），并提供最近状态', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await runMaintenance(settings, { reason: 'manual' })
  await runMaintenance(settings, { reason: 'scheduled' })

  const state = await readMaintenanceState(settings)
  assert.equal(state.runs.length, 2)
  assert.equal(state.runs[0].reason, 'scheduled')
  assert.equal(state.last.reason, 'scheduled')
})

test('去重数据源：同 checksum 的副本会被分组，供合并界面使用', async (t) => {
  const { settings, memoryDir, cleanup } = await makeSettings()
  t.after(cleanup)
  const body = '完全相同的正文'
  const extra = { kind: 'facts', checksum: 'same-checksum-abc', device: 'test-device' }
  await writeMemoryFile(memoryDir, 'memory/facts/x.md', memoryDoc({ title: 'X', body, extra }))
  await writeMemoryFile(memoryDir, 'memory/facts/y.md', memoryDoc({ title: 'Y', body, extra }))

  const result = await duplicates(settings)
  assert.ok(result.clusters.length >= 1)
  const cluster = result.clusters.find((item) => item.reason === 'same-checksum')
  assert.ok(cluster, '应有 same-checksum 分组')
  assert.equal(cluster.items.length, 2)
  assert.ok(cluster.items.every((item) => item.path.includes('memory/facts/')))
})
