import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { makeSettings, writeMemoryFile, memoryDoc } from './helpers.js'
import { conflictBase, pairConflict, resolveConflict } from '../src/conflicts.js'

test('冲突副本：基名解析与非法路径', async () => {
  assert.equal(
    conflictBase('memory/facts/标题.sync-conflict-20261101-120000-ABCDEF.md'),
    'memory/facts/标题.md',
  )
  assert.equal(conflictBase('memory/facts/normal.md'), '')
  assert.equal(conflictBase(''), '')

  const { settings, cleanup } = await makeSettings()
  try {
    // 不是冲突副本：配对应当直接拒绝，避免误当"裁决"入口。
    await assert.rejects(() => pairConflict(settings, 'memory/facts/normal.md'), /不是 Syncthing 冲突副本/)
    await assert.rejects(() => resolveConflict(settings, 'memory/facts/normal.md', 'base'), /不是/)
  } finally {
    await cleanup()
  }
})

test('冲突副本：配对返回两侧正文，基名缺失时为空串', async (t) => {
  const { settings, memoryDir, cleanup } = await makeSettings()
  t.after(cleanup)
  await writeMemoryFile(memoryDir, 'memory/facts/a.md', memoryDoc({ title: 'A', body: '本机版本' }))
  await writeMemoryFile(
    memoryDir,
    'memory/facts/a.sync-conflict-20261101-120000-ABCDEF.md',
    memoryDoc({ title: 'A', body: '平板版本' }),
  )

  const pair = await pairConflict(settings, 'memory/facts/a.sync-conflict-20261101-120000-ABCDEF.md')
  assert.equal(pair.base, 'memory/facts/a.md')
  assert.match(pair.baseText, /本机版本/)
  assert.match(pair.conflictText, /平板版本/)

  // 只有副本、没有基名文件：baseText 为空，不抛错（界面显示"原文件已不存在"）。
  const orphanRel = 'memory/facts/orphan.sync-conflict-20261101-120000-ABCDEF.md'
  await writeMemoryFile(memoryDir, orphanRel, memoryDoc({ title: 'Orphan', body: '只剩副本' }))
  const orphan = await pairConflict(settings, orphanRel)
  assert.equal(orphan.base, 'memory/facts/orphan.md')
  assert.equal(orphan.baseText, '')
  assert.match(orphan.conflictText, /只剩副本/)
})

test('冲突裁决：采用副本会覆盖基名文件并把副本移进回收站', async (t) => {
  const { settings, memoryDir, cleanup } = await makeSettings()
  t.after(cleanup)
  const conflictRel = 'memory/facts/b.sync-conflict-20261101-120000-ABCDEF.md'
  await writeMemoryFile(memoryDir, 'memory/facts/b.md', memoryDoc({ title: 'B', body: '旧内容' }))
  await writeMemoryFile(memoryDir, conflictRel, memoryDoc({ title: 'B', body: '新内容' }))

  const result = await resolveConflict(settings, conflictRel, 'conflict')
  assert.equal(result.take, 'conflict')
  assert.equal(result.base, 'memory/facts/b.md')

  const baseText = await fs.readFile(path.join(memoryDir, 'memory/facts/b.md'), 'utf8')
  assert.match(baseText, /新内容/)
  await assert.rejects(() => fs.stat(path.join(memoryDir, conflictRel)), /ENOENT/)

  // 冲突副本进回收站，可恢复（不是物理删除）。
  const trashDir = path.join(memoryDir, '.trash')
  const trashEntries = await fs.readdir(trashDir, { recursive: true })
  assert.ok(trashEntries.some((entry) => String(entry).includes('b.sync-conflict-')), '副本应进回收站')
})

test('冲突裁决：采用基名文件则只清理副本', async (t) => {
  const { settings, memoryDir, cleanup } = await makeSettings()
  t.after(cleanup)
  const conflictRel = 'memory/facts/c.sync-conflict-20261101-120000-ABCDEF.md'
  await writeMemoryFile(memoryDir, 'memory/facts/c.md', memoryDoc({ title: 'C', body: '保留我' }))
  await writeMemoryFile(memoryDir, conflictRel, memoryDoc({ title: 'C', body: '丢弃我' }))

  await resolveConflict(settings, conflictRel, 'base')
  const baseText = await fs.readFile(path.join(memoryDir, 'memory/facts/c.md'), 'utf8')
  assert.match(baseText, /保留我/)
  await assert.rejects(() => fs.stat(path.join(memoryDir, conflictRel)), /ENOENT/)
})
