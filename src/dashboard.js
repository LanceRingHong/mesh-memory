import http from 'node:http'
import { ensureLayout, counts, searchMemory, readMemory, recentFiles, treeMemory } from './store.js'

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
  </div>
</div>
</div>
<script>
const $=(s)=>document.querySelector(s);
const esc=(s)=>String(s??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(p){const r=await fetch(p,{cache:'no-store'});const j=await r.json();if(!j.ok)throw new Error(j.error||'request failed');return j;}
function item(row,kind){const d=document.createElement('div');d.className='item';d.dataset.path=row.path;d.innerHTML='<div class="t">'+esc(row.title||row.path)+'</div><div class="p">'+esc(kind?kind+' · ':'')+esc(row.path)+'</div>';d.onclick=()=>openFile(row.path);return d;}
async function openFile(p){try{const j=await api('/dsh-mesh/api/file?path='+encodeURIComponent(p));$('#view').textContent=j.text;$('#viewPath').textContent=p;}catch(e){$('#view').textContent='读取失败：'+e.message;}}
async function load(){
  try{
    const j=await api('/dsh-mesh/api/status');
    $('#sub').textContent=j.device+' · '+j.memoryDir+(j.loopbackOnly?' · 仅本机':'');
    const c=j.counts||{};
    const cards=[['事实',c.facts],['决策',c.decisions],['项目',c.projects],['笔记',c.notes],['会话摘要',c.sessions]];
    $('#cards').innerHTML=cards.map(([l,n])=>'<div class="card"><div class="n">'+(n??0)+'</div><div class="l">'+l+'</div></div>').join('');
    $('#recent').innerHTML='';
    const rows=[...(j.recentFacts||[]),...(j.recentSessions||[])];
    if(!rows.length)$('#recent').innerHTML='<div class="empty">还没有记忆条目。</div>';
    rows.forEach((r)=>$('#recent').appendChild(item(r)));
    $('#devices').innerHTML=(j.devices||[]).length?(j.devices.map((d)=>'<span class="pill">'+esc(d.name||d.deviceSlug||d.deviceId||'device')+'</span>').join('')):'<div class="empty">index/devices.json 为空；配对设备后由插件维护。</div>';
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

function loopbackFence(req) {
  const host = req.headers.host
  if (typeof host !== 'string') return false
  const name = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]
  return name === '127.0.0.1' || name === 'localhost' || name === '::1'
}

async function readDevices(settings) {
  try {
    const raw = await readMemory(settings, 'index/devices.json')
    const data = JSON.parse(raw)
    return Array.isArray(data.devices) ? data.devices : []
  } catch {
    return []
  }
}

export function registerDashboard(ctx, settings) {
  let dispose = () => {}
  ctx.inject(['webServer'], (sub) => {
    const handler = async (req, res) => {
      if (!loopbackFence(req)) {
        writeJson(res, 403, { ok: false, error: 'non-loopback Host header' })
        return
      }
      if (req.method !== 'GET') {
        writeJson(res, 405, { ok: false, error: 'GET only' })
        return
      }
      const url = new URL(req.url || '/', 'http://dsh.internal')
      const pathname = url.pathname
      try {
        if (pathname === '/' || pathname === '/dsh-mesh' || pathname === '/dsh-mesh/') {
          writeText(res, 200, 'text/html', HTML)
          return
        }
        if (pathname === '/dsh-mesh/api/status') {
          await ensureLayout(settings)
          const [c, devices] = await Promise.all([counts(settings), readDevices(settings)])
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
            counts: c,
            devices: devices.length ? devices : [{ name: settings.deviceName, deviceSlug: settings.deviceSlug }],
            recentFacts,
            recentSessions,
            loopbackOnly: true,
          })
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
    const off = sub.webServer.register({ kind: 'prefix', path: '/dsh-mesh', handler })
    let server = null
    try {
      server = http.createServer(handler)
      server.on('error', (error) => {
        console.warn(`[dsh-mesh] dashboard port ${settings.dashboardPort} failed: ${error?.message || error}`)
      })
      server.listen(settings.dashboardPort, '127.0.0.1', () => {
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
