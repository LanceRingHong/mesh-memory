import assert from 'node:assert/strict'
import test from 'node:test'
import { writeText, writeJson, destroyQuietly } from '../src/http-util.js'

function fakeRes({ headersSent = false, writableEnded = false } = {}) {
  const calls = []
  return {
    calls,
    headersSent,
    writableEnded,
    writeHead(status, headers) {
      if (this.headersSent || this.writableEnded) throw new Error('ERR_HTTP_HEADERS_SENT')
      this.headersSent = true
      calls.push(['writeHead', status, headers])
    },
    end(body) {
      this.writableEnded = true
      calls.push(['end', body])
    },
    destroy() {
      calls.push(['destroy'])
    },
  }
}

test('writeJson：正常情况写头写体', () => {
  const res = fakeRes()
  writeJson(res, 200, { ok: true })
  assert.deepEqual(res.calls.map((call) => call[0]), ['writeHead', 'end'])
})

test('writeJson：响应头已发出时不再 writeHead（0.25.0 崩溃回归）', () => {
  const res = fakeRes({ headersSent: true })
  assert.doesNotThrow(() => writeJson(res, 503, { ok: false }))
  assert.deepEqual(res.calls.map((call) => call[0]), ['end'])
})

test('writeText：响应已结束时完全无操作', () => {
  const res = fakeRes({ writableEnded: true })
  assert.doesNotThrow(() => writeText(res, 500, 'text/plain', 'x'))
  assert.equal(res.calls.length, 0)
})

test('destroyQuietly：未结束时断开连接，已结束时不重复操作', () => {
  const open = fakeRes({ headersSent: true })
  destroyQuietly(open)
  assert.deepEqual(open.calls.map((call) => call[0]), ['destroy'])

  const done = fakeRes({ writableEnded: true })
  destroyQuietly(done)
  assert.equal(done.calls.length, 0)
})
