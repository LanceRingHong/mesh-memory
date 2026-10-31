import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { makeSettings } from './helpers.js'
import { ensureLayout, writeNote } from '../src/store.js'
import { listInbox, writeSessionDraft } from '../src/inbox.js'
import { runMeshCommand } from '../src/command.js'

function draft() {
  return {
    id: 'session-cmd-1',
    title: '命令测试',
    startedAt: Date.now() - 1000,
    updatedAt: Date.now(),
    turns: 2,
    messages: [
      { role: 'user', text: '把这件事记下来' },
      { role: 'assistant', text: '好的。' },
    ],
    tools: new Map(),
    files: new Set(),
  }
}

test('/mesh-memory list 与未知操作', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await ensureLayout(settings)

  const empty = await runMeshCommand(settings, 'list')
  assert.equal(empty.kind, 'success')
  assert.match(empty.text, /收件箱为空/)

  const bad = await runMeshCommand(settings, 'nope')
  assert.equal(bad.kind, 'error')
  assert.match(bad.text, /未知操作/)

  const help = await runMeshCommand(settings, '')
  assert.match(help.text, /accept/)
})

test('/mesh-memory accept / reject / delete', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await ensureLayout(settings)

  await writeSessionDraft(settings, draft())
  const [item] = await listInbox(settings)
  assert.ok(item)

  const accepted = await runMeshCommand(settings, `accept ${item.path} facts`)
  assert.equal(accepted.kind, 'success')
  assert.match(accepted.text, /memory\/facts\//)
  assert.equal((await listInbox(settings)).length, 0)

  const note = await writeNote(settings, {
    kind: 'notes',
    title: '待删除',
    description: '命令删除测试',
    content: '正文',
  })
  const rel = path.relative(settings.memoryDir, note).replace(/\\/g, '/')
  const deleted = await runMeshCommand(settings, `delete ${rel}`)
  assert.equal(deleted.kind, 'success')
  assert.match(deleted.text, /回收站/)

  await writeSessionDraft(settings, { ...draft(), id: 'session-cmd-2' })
  const [second] = await listInbox(settings)
  const rejected = await runMeshCommand(settings, `reject ${second.path}`)
  assert.equal(rejected.kind, 'success')
  assert.equal((await listInbox(settings)).length, 0)
})

test('/mesh-memory accept 缺路径时报错', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await ensureLayout(settings)
  const out = await runMeshCommand(settings, 'accept')
  assert.equal(out.kind, 'error')
  assert.match(out.text, /用法/)
})
