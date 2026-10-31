import http from 'node:http'
import path from 'node:path'
import {
  ensureLayout,
  counts,
  searchMemory,
  readMemory,
  recentFiles,
  treeMemory,
  listConflicts,
  updateDevices,
  writeNote,
  updateNote,
  trashNote,
} from './store.js'
import { listInbox, readInbox, acceptInbox, rejectInbox } from './inbox.js'
import { flushAllSessions } from './capture.js'
import { snapshot, listSnapshots, restoreSnapshot, scheduleSnapshot } from './backup.js'

const HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DSH Mesh 记忆</title>
<style>
:root{--bg:#0f1115;--panel:#171a21;--panel2:#1e222b;--text:#e7eaf0;--muted:#8b93a5;--line:#2a303c;--accent:#6ee7b7;--accent2:#93c5fd;--warn:#fbbf24}
@media(prefers-color-scheme:light){:root{--bg:#f5f7fb;--panel:#fff;--panel2:#eef2f8;--text:#172033;--muted:#5b6475;--line:#dfe5ef;--accent:#0f766e;--accent2:#1d4ed8;--warn:#b45309}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}
.wrap{max-width:1120px;margin:0 auto;padding:22px 16px 48px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;justify-content:space-between;margin-bottom:18px}
h1{font-size:22px;margin:0;letter-spacing:.2px}
.sub{color:var(--muted);font-size:12px;margin-top:4px}
button{background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:9px;padding:8px 12px;cursor:pointer;font:inherit}
button:hover{border-color:var(--accent)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.card .n{font-size:24px;font-weight:700;color:var(--accent)}
.card .l{font-size:11px;color:var(--muted);margin-top:2px}
.grid{display:grid;grid-template-columns:1.15fr .85fr;gap:14px}
@media(max-width:820px){.grid{grid-template-columns:1fr}}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}
.panel h2{font-size:13px;margin:0 0 10px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.08em}
.search{display:flex;gap:8px;margin-bottom:12px}
.search input{flex:1;background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:9px;padding:9px 11px;font:inherit;outline:none}
.search input:focus{border-color:var(--accent2)}
.list{display:flex;flex-direction:column;gap:6px;max-height:420px;overflow:auto}
.item{background:var(--panel2);border:1px solid transparent;border-radius:9px;padding:9px 10px;cursor:pointer}
.item:hover{border-color:var(--line)}
.item .t{font-weight:600;font-size:13px}
.item .p{color:var(--muted);font-size:11px;word-break:break-all;margin-top:2px}
.empty{color:var(--muted);font-size:12px;padding:10px 0}
.pill{display:inline-block;background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:2px 8px;font-size:11px;color:var(--muted);margin:2px 4px 2px 0}
pre{background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:12px;white-space:pre-wrap;word-break:break-word;max-height:460px;overflow:auto;font:12px/1.5 ui-monospace,Consolas,monospace}
.hint{color:var(--muted);font-size:11px}
.hit{border-left:2px solid var(--accent2)}
.err{color:var(--warn);font-size:12px}
</style>
</head>
<body>
<div class="wrap">
<header>
  <div>
    <h1>DSH Mesh 记忆</h1>
    <div class="sub" id="sub">加载中…</div>
  </div>
  <div>
    <button id="refresh">刷新</button>
    <button id="agents">AGENTS.shared.md</button>
  </div>
</header>
<div class="cards" id="cards"></div>
<div class="grid">
  <div class="panel">
    <h2>搜索共享记忆</h2>
    <div class="search"><input id="q" placeholder="关键词，空格分隔；回车搜索"><button id="go">搜索</button></div>
    <div class="list" id="results"><div class="empty">输入关键词开始搜索。</div></div>
    <h2 style="margin-top:16px">最近事实 / 决策</h2>
    <div class="list" id="recent"></div>
  </div>
  <div class="panel">
    <h2>内容</h2>
    <pre id="view">点击左侧条目查看内容。</pre>
    <div class="hint" id="viewPath"></div>
    <h2 style="margin-top:16px">设备</h2>
    <div id="devices"></div>
    <h2 style="margin-top:16px">待确认记忆</h2>
    <div class="list" id="inbox"><div class="empty">加载中…</div></div>
  </div>
</div>
</div>
<script>
const $=(s)=>document.querySelector(s);
const esc=(s)=>String(s??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(p){const r=await fetch(p,{cache:'no-store'});const j=await r.json();if(!j.ok)throw new Error(j.error||'request failed');return j;}
function item(row,kind){const d=document.createElement('div');d.className='item';d.dataset.path=row.path;d.innerHTML='<div class="t">'+esc(row.title||row.path)+'</div><div class="p">'+esc(kind?kind+' · ':'')+esc(row.path)+'</div>';d.onclick=()=>openFile(row.path);return d;}
async function openFile(p){try{const j=await api('/dsh-mesh/api/file?path='+encodeURIComponent(p));$('#view').textContent=j.text;$('#viewPath').textContent=p;}catch(e){$('#view').textContent='读取失败：'+e.message;}}
async function openInboxFile(p){try{const j=await api('/dsh-mesh/api/inbox/file?path='+encodeURIComponent(p));$('#view').textContent=j.text;$('#viewPath').textContent=p;}catch(e){$('#view').textContent='读取失败：'+e.message;}}
async function load(){
  try{
    const j=await api('/dsh-mesh/api/status');
    $('#sub').textContent=j.device+' · '+j.memoryDir+(j.loopbackOnly?' · 仅本机':'');
    const c=j.counts||{};
    const cards=[['事实',c.facts],['决策',c.decisions],['项目',c.projects],['笔记',c.notes],['会话摘要',c.sessions],['待确认',c.inbox]];
    $('#cards').innerHTML=cards.map(([l,n])=>'<div class="card"><div class="n">'+(n??0)+'</div><div class="l">'+l+'</div></div>').join('');
    $('#recent').innerHTML='';
    const rows=[...(j.recentFacts||[]),...(j.recentSessions||[])];
    if(!rows.length)$('#recent').innerHTML='<div class="empty">还没有记忆条目。</div>';
    rows.forEach((r)=>$('#recent').appendChild(item(r)));
    $('#devices').innerHTML=(j.devices||[]).length?(j.devices.map((d)=>'<span class="pill">'+esc(d.name||d.deviceSlug||d.deviceId||'device')+'</span>').join('')):'<div class="empty">index/devices.json 为空；配对设备后由插件维护。</div>';
    try{
      const ib=await api('/dsh-mesh/api/inbox');
      $('#inbox').innerHTML='';
      if(!ib.items.length){$('#inbox').innerHTML='<div class="empty">没有待确认的自动记录。会话结束或空闲后会出现。</div>';}
      ib.items.slice(0,10).forEach((r)=>{const d=document.createElement('div');d.className='item';d.innerHTML='<div class="t">'+esc(r.title||r.path)+'</div><div class="p">'+esc(r.updatedAt||r.createdAt||'')+' · '+esc(r.turns)+' 轮</div>';d.onclick=()=>openInboxFile(r.path);$('#inbox').appendChild(d);});
    }catch(e){$('#inbox').innerHTML='<div class="empty">读取失败：'+esc(e.message)+'</div>';}
  }catch(e){$('#sub').textContent='加载失败：'+e.message;}
}
async function search(){
  const q=$('#q').value.trim();if(!q)return;
  $('#results').innerHTML='<div class="empty">搜索中…</div>';
  try{
    const j=await api('/dsh-mesh/api/search?q='+encodeURIComponent(q));
    $('#results').innerHTML='';
    if(!j.results.length)$('#results').innerHTML='<div class="empty">没有命中。</div>';
    j.results.forEach((r)=>{const d=item(r,'hit');d.classList.add('hit');$('#results').appendChild(d);});
  }catch(e){$('#results').innerHTML='<div class="err">'+esc(e.message)+'</div>';}
}
$('#refresh').onclick=load;
$('#agents').onclick=()=>openFile('AGENTS.shared.md');
$('#go').onclick=search;
$('#q').addEventListener('keydown',(e)=>{if(e.key==='Enter')search();});
load();
</script>
</body>
</html>`

function writeText(res, status, type, text) {
  res.writeHead(status, {
    'content-type': `${type}; charset=utf-8`,
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function writeJson(res, status, body) {
  writeText(res, status, 'application/json', JSON.stringify(body))
}

/**
 * 回环判断（P2-7）：Host 头可以伪造，socket 地址不行——两者都必须指向本机。
 * 导出给测试用。
 */
export function isLoopbackRequest(req) {
  const socket = req?.socket?.remoteAddress || req?.connection?.remoteAddress || ''
  const bare = String(socket).replace(/^::ffff:/, '')
  const socketLoopback = bare === '127.0.0.1' || bare === '::1' || bare === 'localhost'
  if (!socketLoopback) return false
  const host = req?.headers?.host
  if (typeof host !== 'string' || !host) return false
  const name = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]
  return name === '127.0.0.1' || name === 'localhost' || name === '::1'
}

function tokenOk(req, url, settings) {
  const expected = String(settings.dashboardToken || '')
  if (!expected) return true
  const given = url.searchParams.get('token') || req.headers['x-dsh-mesh-token']
  return String(given || '') === expected
}

function readJsonBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8').trim()
        resolve(text ? JSON.parse(text) : {})
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

/** 写操作必须带自定义头且同源：跨站表单/脚本无法伪造。 */
function mutationAllowed(req) {
  if (String(req.headers['x-dsh-mesh-action'] || '') !== '1') return false
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

async function handleMutation(pathname, body, settings) {
  await ensureLayout(settings)
  switch (pathname) {
    case '/dsh-mesh/api/inbox/flush': {
      const flushed = await flushAllSessions(settings, 'manual')
      return { ok: true, flushed: flushed.length, items: flushed }
    }
    case '/dsh-mesh/api/inbox/accept': {
      if (!body.path) throw new Error('path 必填')
      const result = await acceptInbox(settings, body.path, {
        kind: body.kind || 'notes',
        title: body.title,
      })
      scheduleSnapshot(settings, 'ui:accept')
      return { ok: true, ...result }
    }
    case '/dsh-mesh/api/inbox/reject': {
      if (!body.path) throw new Error('path 必填')
      const result = await rejectInbox(settings, body.path)
      scheduleSnapshot(settings, 'ui:reject')
      return { ok: true, ...result }
    }
    case '/dsh-mesh/api/memory/write': {
      if (!body.title || !body.content) throw new Error('title 和 content 必填')
      const file = await writeNote(settings, {
        kind: body.kind || 'notes',
        memoryType: body.memoryType || 'reference',
        title: body.title,
        description: body.description,
        content: body.content,
        tags: Array.isArray(body.tags) ? body.tags : ['ui'],
        device: settings.deviceName,
      })
      scheduleSnapshot(settings, 'ui:write')
      return { ok: true, path: path.relative(settings.memoryDir, file).replace(/\\/g, '/') }
    }
    case '/dsh-mesh/api/memory/update': {
      if (!body.path) throw new Error('path 必填')
      const patch = {}
      for (const key of ['content', 'title', 'description']) {
        if (body[key] !== undefined) patch[key] = body[key]
      }
      const result = await updateNote(settings, body.path, patch)
      scheduleSnapshot(settings, 'ui:update')
      return { ok: true, ...result }
    }
    case '/dsh-mesh/api/memory/delete': {
      if (!body.path) throw new Error('path 必填')
      const result = await trashNote(settings, body.path)
      scheduleSnapshot(settings, 'ui:delete')
      return { ok: true, ...result }
    }
    case '/dsh-mesh/api/backup/snapshot': {
      const result = await snapshot(settings, 'ui')
      return { ok: true, ...result }
    }
    case '/dsh-mesh/api/backup/restore': {
      const result = await restoreSnapshot(settings, body.commit, { confirm: body.confirm === true })
      return { ok: true, ...result }
    }
    default:
      throw new Error('not found')
  }
}

export function registerDashboard(ctx, settings) {
  let dispose = () => {}
  let listening = false
  ctx.inject(['webServer'], (sub) => {
    const buildHandler = (requireToken) => async (req, res) => {
      if (!isLoopbackRequest(req)) {
        writeJson(res, 403, { ok: false, error: 'non-loopback request' })
        return
      }
      if (req.method !== 'GET' && req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: 'GET/POST only' })
        return
      }
      const url = new URL(req.url || '/', 'http://dsh.internal')
      if (requireToken && !tokenOk(req, url, settings)) {
        writeJson(res, 401, { ok: false, error: 'dashboard token required' })
        return
      }
      const pathname = url.pathname
      try {
        if (req.method === 'POST') {
          if (!mutationAllowed(req)) {
            writeJson(res, 403, { ok: false, error: '写操作需要 x-dsh-mesh-action 头且必须同源' })
            return
          }
          const body = await readJsonBody(req)
          const result = await handleMutation(pathname, body, settings)
          writeJson(res, 200, result)
          return
        }
        if (pathname === '/' || pathname === '/dsh-mesh' || pathname === '/dsh-mesh/') {
          writeText(res, 200, 'text/html', HTML)
          return
        }
        if (pathname === '/dsh-mesh/api/status') {
          await ensureLayout(settings)
          const [c, devices, inbox] = await Promise.all([
            counts(settings),
            updateDevices(settings).catch(() => []),
            listInbox(settings).catch(() => []),
          ])
          const [recentFacts, recentSessions] = await Promise.all([
            recentFiles(settings, 'memory/facts', 10),
            recentFiles(settings, 'sessions', 10),
          ])
          writeJson(res, 200, {
            ok: true,
            device: settings.deviceName,
            deviceSlug: settings.deviceSlug,
            memoryDir: settings.memoryDir,
            dshHome: settings.dshHome,
            counts: { ...c, inbox: inbox.length },
            capture: {
              enabled: settings.captureEnabled,
              idleMinutes: settings.captureIdleMinutes,
              minTurns: settings.captureMinTurns,
            },
            backup: {
              enabled: settings.backupEnabled,
              debounceSeconds: settings.backupDebounceSeconds,
              intervalMinutes: settings.backupIntervalMinutes,
            },
            devices: devices.length ? devices : [{ name: settings.deviceName, deviceSlug: settings.deviceSlug }],
            recentFacts,
            recentSessions,
            loopbackOnly: true,
            dashboardListening: listening,
            tokenRequired: Boolean(settings.dashboardToken),
          })
          return
        }
        if (pathname === '/dsh-mesh/api/inbox') {
          await ensureLayout(settings)
          const items = await listInbox(settings)
          writeJson(res, 200, { ok: true, count: items.length, items })
          return
        }
        if (pathname === '/dsh-mesh/api/inbox/file') {
          const rel = url.searchParams.get('path') || ''
          const text = await readInbox(settings, rel)
          writeJson(res, 200, { ok: true, path: rel, text: text.slice(0, 200000) })
          return
        }
        if (pathname === '/dsh-mesh/api/backup') {
          const items = await listSnapshots(settings)
          writeJson(res, 200, { ok: true, count: items.length, items })
          return
        }
        if (pathname === '/dsh-mesh/api/conflicts') {
          await ensureLayout(settings)
          const items = await listConflicts(settings)
          writeJson(res, 200, { ok: true, count: items.length, items })
          return
        }
        if (pathname === '/dsh-mesh/api/search') {
          await ensureLayout(settings)
          const q = url.searchParams.get('q') || ''
          const results = await searchMemory(settings, q, 30)
          writeJson(res, 200, { ok: true, results })
          return
        }
        if (pathname === '/dsh-mesh/api/tree') {
          const tree = await treeMemory(settings)
          writeJson(res, 200, { ok: true, ...tree })
          return
        }
        if (pathname === '/dsh-mesh/api/file') {
          const rel = url.searchParams.get('path') || ''
          const text = await readMemory(settings, rel)
          writeJson(res, 200, { ok: true, path: rel, text: text.slice(0, 200000) })
          return
        }
        writeJson(res, 404, { ok: false, error: 'not found' })
      } catch (error) {
        writeJson(res, 500, { ok: false, error: String(error?.message || error) })
      }
    }
    // /dsh-mesh 路由本身受 DSH 登录保护，不额外要求 token；独立端口需要 token（若配置）。
    const routeHandler = buildHandler(false)
    const handler = buildHandler(true)
    const off = sub.webServer.register({ kind: 'prefix', path: '/dsh-mesh', handler: routeHandler })
    let server = null
    try {
      server = http.createServer(handler)
      server.on('error', (error) => {
        listening = false
        console.warn(`[dsh-mesh] dashboard port ${settings.dashboardPort} failed: ${error?.message || error}`)
      })
      server.listen(settings.dashboardPort, '127.0.0.1', () => {
        listening = true
        console.info(`[dsh-mesh] dashboard at http://127.0.0.1:${settings.dashboardPort}/`)
      })
    } catch (error) {
      console.warn(`[dsh-mesh] dashboard server failed: ${error?.message || error}`)
    }
    dispose = () => {
      try {
        off()
      } catch {}
      try {
        server?.close()
      } catch {}
    }
    console.info(`[dsh-mesh] dashboard route at http://127.0.0.1:${sub.webServer.port ?? '?'}/dsh-mesh/`)
    return dispose
  })
  return () => dispose()
}
