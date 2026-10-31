import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { makeSettings } from './helpers.js'
import { ensureLayout } from '../src/store.js'
import { acceptInbox, inboxRoot, listInbox, readInbox, rejectInbox, writeSessionDraft } from '../src/inbox.js'

function draftBuffer() {
  return {
    id: 'session-test-1',
    title: '测试会话',
    cwd: 'D:/work',
    startedAt: Date.now() - 60_000,
    updatedAt: Date.now(),
    turns: 2,
    messages: [
      { role: 'user', text: '帮我看下构建为什么失败' },
      { role: 'assistant', text: '构建失败是因为依赖没有安装。' },
    ],
    tools: new Map([['bash', true]]),
    files: new Set(['src/a.ts']),
  }
}

test('草稿写入、列出、读取', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await ensureLayout(settings)

  const written = await writeSessionDraft(settings, draftBuffer())
  assert.equal(written.path, 'sessions/session-test-1.md')

  const items = await listInbox(settings)
  assert.equal(items.length, 1)
  assert.equal(items[0].sessionId, 'session-test-1')
  assert.equal(items[0].turns, 2)

  const text = await readInbox(settings, items[0].path)
  assert.match(text, /## 用户诉求/)
  assert.match(text, /帮我看下构建为什么失败/)
  assert.match(text, /## 最后结论/)
  assert.match(text, /src\/a\.ts/)
  assert.match(text, /bash/)
})

test('accept 转成正式记忆并归档草稿', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await ensureLayout(settings)
  await writeSessionDraft(settings, draftBuffer())
  const [item] = await listInbox(settings)

  const result = await acceptInbox(settings, item.path, { kind: 'notes' })
  assert.match(result.memory, /^memory\/notes\//)
  const text = await fs.readFile(path.join(settings.memoryDir, result.memory), 'utf8')
  assert.match(text, /帮我看下构建为什么失败/)
  assert.match(text, /auto-capture/)

  assert.equal((await listInbox(settings)).length, 0)
  const archived = await fs.readdir(path.join(inboxRoot(settings), 'accepted'))
  assert.equal(archived.length, 1)
})

test('reject 归档草稿', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await ensureLayout(settings)
  await writeSessionDraft(settings, draftBuffer())
  const [item] = await listInbox(settings)

  await rejectInbox(settings, item.path)
  assert.equal((await listInbox(settings)).length, 0)
  const archived = await fs.readdir(path.join(inboxRoot(settings), 'rejected'))
  assert.equal(archived.length, 1)
})

test('收件箱只允许 sessions/ 下的相对路径', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await ensureLayout(settings)
  await writeSessionDraft(settings, draftBuffer())
  const [item] = await listInbox(settings)

  // 兼容 dshHome 相对写法
  const text = await readInbox(settings, `dsh-mesh/inbox/${item.path}`)
  assert.match(text, /## 用户诉求/)

  await assert.rejects(() => readInbox(settings, '../../AGENTS.shared.md'), /只允许访问/)
  await assert.rejects(() => readInbox(settings, '/abs/path.md'), /只允许访问/)
  await assert.rejects(() => readInbox(settings, 'sessions/../../AGENTS.shared.md'), /只允许访问/)
})
