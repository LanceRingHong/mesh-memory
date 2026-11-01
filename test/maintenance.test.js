import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as store from '../src/store.js'
import * as maintenance from '../src/maintenance.js'
import { loadSkillPack } from '../src/skills.js'
import { makeSettings, writeMemoryFile } from './helpers.js'

function rel(settings, file) {
  return path.relative(settings.memoryDir, file).replace(/\\/g, '/')
}

test('doctor：干净的库 error=0（0.11.0）', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  await store.writeNote(settings, { kind: 'facts', title: 'ok note', content: 'hello' })
  const report = await maintenance.doctor(settings)
  assert.equal(report.ok, true)
  assert.equal(report.totals.errors, 0)
  assert.equal(report.totals.notes, 1)
})

test('doctor：缺 permalink / 重复 permalink / checksum 不一致（0.11.0）', async (t) => {
  const { settings, cleanup, memoryDir } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  const noPermalink = '---\ntitle: "no permalink"\nkind: "facts"\n---\nbody\n'
  await writeMemoryFile(memoryDir, 'memory/facts/a.md', noPermalink)
  const dupA = '---\ntitle: "dup a"\npermalink: "same"\nchecksum: "bad"\nkind: facts\n---\nbody a\n'
  const dupB = '---\ntitle: "dup b"\npermalink: "same"\nkind: facts\n---\nbody b\n'
  await writeMemoryFile(memoryDir, 'memory/facts/b.md', dupA)
  await writeMemoryFile(memoryDir, 'memory/facts/c.md', dupB)

  const report = await maintenance.doctor(settings)
  const codes = report.findings.map((f) => f.code)
  assert.ok(codes.includes('missing-permalink'))
  assert.ok(codes.includes('duplicate-permalink'))
  assert.ok(codes.includes('checksum-mismatch'))
  assert.equal(report.ok, false)
})

test('duplicates：正文相同与标题相同分别成簇（0.11.0）', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  await store.writeNote(settings, { kind: 'facts', title: 'one', content: 'same body' })
  await store.writeNote(settings, { kind: 'facts', title: 'two', content: 'same body' })
  await store.writeNote(settings, { kind: 'facts', title: 'title clash', content: 'a' })
  await store.writeNote(settings, { kind: 'facts', title: 'Title Clash', content: 'b' })
  const report = await maintenance.duplicates(settings)
  const reasons = report.clusters.map((c) => c.reason)
  assert.ok(reasons.includes('same-checksum'))
  assert.ok(reasons.includes('same-title'))
})

test('reflectBrief：列出指定时间之后变化的条目（0.11.0）', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  await store.writeNote(settings, { kind: 'facts', title: 'recent change', content: 'x' })
  const report = await maintenance.reflectBrief(settings, { since: '2000-01-01T00:00:00.000Z' })
  assert.equal(report.changed, 1)
  assert.equal(report.groups[0].kind, 'facts')
})

test('onboard：preview 不写盘，apply 需要 confirm（0.11.0）', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  const blueprint = maintenance.onboardBlueprint({ domains: ['任务', '研究'], project: 'demo' })
  assert.equal(blueprint.domains.length, 2)
  assert.ok(Array.isArray(blueprint.kinds))

  await assert.rejects(() => maintenance.applyOnboarding(settings, blueprint, { confirm: false }), /confirm/)
  const result = await maintenance.applyOnboarding(settings, blueprint, { confirm: true })
  assert.match(result.path, /^memory\/notes\//)
  const text = await store.readMemory(settings, result.path)
  assert.match(text, /入门蓝图/)
})

test('loadSkillPack：读取并解析内置技能（0.11.0）', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills')
  const skills = loadSkillPack(dir)
  assert.ok(skills.length >= 7, `技能数量 ${skills.length}`)
  const names = skills.map((s) => s.name)
  for (const name of ['mesh-doctor', 'mesh-reflect', 'mesh-onboard', 'mesh-capture']) {
    assert.ok(names.includes(name), `缺少 ${name}`)
  }
  const onboard = skills.find((s) => s.name === 'mesh-onboard')
  assert.ok(onboard.description.length > 10)
  assert.ok(onboard.body.includes('访谈'))
})
