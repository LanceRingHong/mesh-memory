#!/usr/bin/env node
import http from 'node:http'
import path from 'node:path'
import { URL } from 'node:url'
import { settingsOf } from '../src/config.js'
import { ensureLayout, walk, readInside, parseFrontmatter, counts, listDevices, searchMemory, readMemory } from '../src/store.js'
import { buildLinkGraph } from '../src/links.js'
import { listTasks, taskSummary } from '../src/tasks.js'
import { listInbox, readInbox } from '../src/inbox.js'
import { doctor } from '../src/maintenance.js'
import { readProfile, ensureProfile } from '../src/profile.js'
import { collectionCounts, queryMemory, statusCounts } from '../src/query.js'

/**
 * mesh-memory serve（M1）：只读 REST + SSE，供客户端/原型连接。
 * 默认 127.0.0.1:8767；写操作留给 M2。
 */
const port = Number(process.env.MESH_PORT || 8767)
const token = String(process.env.MESH_TOKEN || '').trim()
const settings = settingsOf({
  memoryDir: process.env.DSH_MESH_DIR || '',
  deviceName: process.env.DSH_MESH_DEVICE || '',
  agentName: process.env.DSH_MESH_AGENT || 'serve',
})

await ensureLayout(settings)
await ensureProfile(settings)

async function collectData() {
  const memories = []
  for (const file of await walk(settings.memoryDir, 'memory')) {
    const rel = path.relative(settings.memoryDir, file).replace(/\\/g, '/')
    if (rel.includes('.sync-conflict-')) continue
    let text = ''
    try {
      text = await readInside(settings, rel, { maxBytes: 2_000_000 })
    } catch {
      continue
    }
    const parsed = parseFrontmatter(text)
    memories.push({
      path: rel,
      title: String(parsed.attrs.title || path.basename(rel, '.md')),
      description: String(parsed.attrs.description || ''),
      kind: String(parsed.attrs.kind || rel.split('/')[1] || 'notes'),
      memoryType: String(parsed.attrs.memoryType || ''),
      status: String(parsed.attrs.status || 'active'),
      device: String(parsed.attrs.device || ''),
      agent: String(parsed.attrs.agent || ''),
      permalink: String(parsed.attrs.permalink || ''),
      tags: Array.isArray(parsed.attrs.tags) ? parsed.attrs.tags : [],
      updatedAt: String(parsed.attrs.updatedAt || parsed.attrs.createdAt || ''),
      body: String(parsed.body || '').slice(0, 6000),
    })
  }
  memories.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  const inbox = await listInbox(settings)
  for (const item of inbox) {
    try {
      item.body = String(parseFrontmatter(await readInbox(settings, item.path)).body || '').slice(0, 4000)
    } catch {
      item.body = ''
    }
  }
  const tasks = await listTasks(settings, { limit: 100 })
  const devices = await listDevices(settings)
  const graph = await buildLinkGraph(settings)
  const report = await doctor(settings)
  const profile = await readProfile(settings)
  return {
    generatedAt: new Date().toISOString(),
    live: true,
    local: { device: settings.deviceName, agent: settings.agentName, memoryDir: settings.memoryDir },
    counts: { ...(await counts(settings)), inbox: inbox.length },
    profile,
    collections: await collectionCounts(settings),
    statuses: await statusCounts(settings),
    doctor: report.totals,
    memories,
    inbox,
    tasks: tasks.items,
    taskSummary: await taskSummary(settings),
    devices: devices.map((d) => ({ name: d.name, deviceSlug: d.deviceSlug, platform: d.platform || '', hostId: d.hostId || '', role: d.role || '', aliases: d.aliases || [], lastSeen: d.lastSeen || '' })),
    graph: { nodes: graph.nodes, edges: graph.edges, broken: graph.broken },
  }
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type,x-mesh-token',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Cache-Control': 'no-store',
  })
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : String(body))
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '')
  const url = new URL(req.url, `http://127.0.0.1:${port}`)
  if (token && req.headers['x-mesh-token'] !== token && url.searchParams.get('token') !== token) {
    return send(res, 401, { ok: false, error: 'token required' })
  }
  try {
    if (url.pathname === '/api/health') {
      return send(res, 200, { ok: true, version: '0.14.0', device: settings.deviceName, agent: settings.agentName })
    }
    if (url.pathname === '/api/data') return send(res, 200, await collectData())
    if (url.pathname === '/api/topology') {
      const data = await collectData()
      return send(res, 200, { local: data.local, counts: data.counts, collections: data.collections, statuses: data.statuses, tasks: data.taskSummary, graph: { nodes: data.graph.nodes.length, edges: data.graph.edges.length, broken: data.graph.broken.length }, devices: data.devices })
    }
    if (url.pathname === '/api/profile') return send(res, 200, { ok: true, profile: await readProfile(settings) })
    if (url.pathname === '/api/graph') return send(res, 200, await buildLinkGraph(settings))
    if (url.pathname === '/api/inbox') return send(res, 200, { items: await listInbox(settings) })
    if (url.pathname === '/api/tasks') return send(res, 200, await listTasks(settings, { status: url.searchParams.get('status') || undefined, limit: 100 }))
    if (url.pathname === '/api/memories') {
      const filters = {}
      for (const key of ['kind', 'memoryType', 'status', 'device', 'agent', 'tag', 'title', 'updatedAfter', 'updatedBefore']) {
        if (url.searchParams.get(key)) filters[key] = url.searchParams.get(key)
      }
      return send(res, 200, await queryMemory(settings, filters, { limit: Number(url.searchParams.get('limit')) || 100 }))
    }
    if (url.pathname.startsWith('/api/memories/')) {
      const rel = decodeURIComponent(url.pathname.slice('/api/memories/'.length))
      return send(res, 200, { path: rel, text: await readMemory(settings, rel) })
    }
    if (url.pathname === '/api/search') {
      const q = url.searchParams.get('q') || ''
      return send(res, 200, { items: await searchMemory(settings, q, Number(url.searchParams.get('limit')) || 20) })
    }
    if (url.pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })
      res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`)
      const timer = setInterval(() => res.write(`event: ping\ndata: ${Date.now()}\n\n`), 15_000)
      req.on('close', () => clearInterval(timer))
      return
    }
    return send(res, 404, { ok: false, error: 'not found' })
  } catch (error) {
    return send(res, 500, { ok: false, error: String(error?.message || error) })
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[mesh-memory] serve http://127.0.0.1:${port} device=${settings.deviceName} dir=${settings.memoryDir}`)
})
