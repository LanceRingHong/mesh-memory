import test from 'node:test'
import assert from 'node:assert/strict'
import { makeSettings } from './helpers.js'
import { ensureLayout } from '../src/store.js'
import { writeSessionDraft } from '../src/inbox.js'
import { snapshot } from '../src/native.js'

test('原生面板数据包含待确认选项', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await ensureLayout(settings)
  await writeSessionDraft(settings, {
    id: 'session-native-1',
    title: '面板测试',
    startedAt: Date.now() - 1000,
    updatedAt: Date.now(),
    turns: 2,
    messages: [{ role: 'user', text: '记录一下' }, { role: 'assistant', text: '好' }],
    tools: new Map(),
    files: new Set(),
  })
  const data = snapshot(settings, '')
  assert.equal(data.inboxCount, 1)
  assert.equal(data.inbox.length, 1)
  assert.match(data.inbox[0].value, /^sessions\/session-native-1\.md$/)
  assert.match(data.inboxLine, /待确认 1 条/)
})
