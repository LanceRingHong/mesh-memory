import path from 'node:path'
import { settingsOf } from '../src/config.js'
import { ensureLayout, writeNote, searchMemory, readMemory, recentFiles, parseFrontmatter } from '../src/store.js'
import { doctor } from '../src/maintenance.js'
import { queryMemory } from '../src/query.js'
import { contextFor } from '../src/links.js'

/**
 * mesh-memory MCP server（stdio，JSON-RPC 2.0）。
 * 让 Claude Code / Codex / Cursor 等非 DSH 的 Agent 直接读写同一份记忆。
 *
 * 启动：
 *   node adapters/mcp-server.mjs
 * 环境：
 *   DSH_MESH_DIR  共享目录（默认 ~/DSH-mesh）
 *   DSH_MESH_AGENT  agent 名（默认 mcp）
 */

const settings = settingsOf({
  memoryDir: process.env.DSH_MESH_DIR || '',
  agentName: process.env.DSH_MESH_AGENT || 'mcp',
  deviceName: process.env.DSH_MESH_DEVICE || '',
})

await ensureLayout(settings)

const TOOLS = [
  {
    name: 'memory_search',
    description: 'Search shared memories (AGENTS, memory/, sessions/) by keywords. Returns path + snippet.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number' } },
      required: ['query'],
    },
  },
  {
    name: 'memory_read',
    description: 'Read one memory file by path relative to the shared memory directory.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'memory_write',
    description: 'Write a new memory note (Markdown + frontmatter). Returns the relative path.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        kind: { type: 'string', enum: ['facts', 'decisions', 'projects', 'notes'] },
        memoryType: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'] },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'memory_recent',
    description: 'List recently updated memories, optionally limited to a kind (facts/decisions/projects/notes).',
    inputSchema: { type: 'object', properties: { kind: { type: 'string' }, limit: { type: 'number' } } },
  },
  {
    name: 'memory_context',
    description: 'Build context for a topic: seed notes from search, then expand one hop through [[wikilinks]].',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, path: { type: 'string' }, depth: { type: 'number' }, limit: { type: 'number' } },
    },
  },
  {
    name: 'memory_query',
    description: 'Filter memories by frontmatter metadata: kind, memoryType, status, device, agent, tag, title, updatedAfter/Before.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        memoryType: { type: 'string' },
        status: { type: 'string' },
        device: { type: 'string' },
        agent: { type: 'string' },
        tag: { type: 'string' },
        title: { type: 'string' },
        updatedAfter: { type: 'string' },
        updatedBefore: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'memory_doctor',
    description: 'Read-only health report: permalink/checksum issues, duplicates, conflicts, inbox backlog.',
    inputSchema: { type: 'object', properties: {} },
  },
]

function text(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

async function callTool(name, args = {}) {
  switch (name) {
    case 'memory_search': {
      const rows = await searchMemory(settings, String(args.query || ''), Number(args.limit) || 20)
      return text({ count: rows.length, results: rows })
    }
    case 'memory_read':
      return text(await readMemory(settings, String(args.path || '')))
    case 'memory_write': {
      const file = await writeNote(settings, {
        kind: args.kind || 'notes',
        memoryType: args.memoryType || 'reference',
        title: args.title,
        content: args.content,
        description: args.description,
        tags: Array.isArray(args.tags) ? args.tags : [],
        agent: settings.agentName,
        source: 'mcp',
      })
      return text({ ok: true, path: path.relative(settings.memoryDir, file).replace(/\\/g, '/') })
    }
    case 'memory_recent': {
      const kind = args.kind ? `memory/${String(args.kind)}` : 'memory'
      const rows = await recentFiles(settings, kind, Number(args.limit) || 10)
      return text({ count: rows.length, items: rows })
    }
    case 'memory_context':
      return text(await contextFor(settings, {
        path: args.path,
        query: args.query,
        depth: Number(args.depth) || 1,
        limit: Number(args.limit) || 8,
      }))
    case 'memory_query': {
      const filters = {}
      for (const key of ['kind', 'memoryType', 'status', 'device', 'agent', 'tag', 'title', 'updatedAfter', 'updatedBefore']) {
        if (args[key] !== undefined && args[key] !== '') filters[key] = args[key]
      }
      return text(await queryMemory(settings, filters, { limit: Number(args.limit) || 100 }))
    }
    case 'memory_doctor':
      return text(await doctor(settings))
    default:
      throw new Error(`unknown tool: ${name}`)
  }
}

async function handle(msg) {
  const { id, method, params } = msg
  if (method === 'initialize') {
    return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mesh-memory', version: '0.12.0' } } }
  }
  if (method === 'notifications/initialized') return null
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} }
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
  if (method === 'tools/call') {
    try {
      const result = await callTool(params?.name, params?.arguments || {})
      return { jsonrpc: '2.0', id, result: { content: result } }
    } catch (error) {
      return { jsonrpc: '2.0', id, result: { content: text(`Error: ${error.message}`), isError: true } }
    }
  }
  if (id !== undefined) return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } }
  return null
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    Promise.resolve(handle(msg))
      .then((res) => {
        if (res) process.stdout.write(`${JSON.stringify(res)}\n`)
      })
      .catch((error) => {
        if (msg?.id !== undefined) {
          process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(error?.message || error) } })}\n`)
        }
      })
  }
})
process.stdin.on('end', () => {
  // 不要立刻退出：还可能有一个 tools/call 的异步响应在排队。
  setTimeout(() => process.exit(0), 250)
})
process.stderr.write(`[mesh-memory] mcp server ready dir=${settings.memoryDir}\n`)
