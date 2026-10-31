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
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>dsh-mesh 记忆</title>
<style>
  :root{--bg:#12151c;--panel:#191d26;--panel2:#1f2430;--line:#2b3240;--fg:#e8ebf2;--muted:#98a2b3;--accent:#6ee7b7;--danger:#f87171}
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;display:flex;flex-direction:column;padding:calc(10px + env(safe-area-inset-top)) 14px calc(10px + env(safe-area-inset-bottom))}
  header{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;padding:2px 0 12px}
  h1{font-size:24px;margin:0;letter-spacing:.3px}
  .sub{color:var(--muted);font-size:12px;margin-top:4px;flex:1;min-width:0}
  button{font:inherit;color:inherit;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:8px 13px;cursor:pointer}
  button:hover{border-color:var(--accent)}
  button.primary{background:var(--accent);border-color:var(--accent);color:#08110c;font-weight:600}
  button.sm{padding:5px 10px;font-size:13px;border-radius:9px}
  button.danger{color:var(--danger);border-color:#5b2b31}
  button:disabled{opacity:.45}
  .tabs{display:flex;gap:8px;padding:0 0 12px;flex-wrap:wrap}
  .tab{padding:8px 16px;border-radius:999px;background:transparent;border:1px solid var(--line);font-size:14px}
  .tab.on{background:var(--accent);border-color:var(--accent);color:#08110c;font-weight:600}
  .tab .n{opacity:.7;margin-left:5px;font-size:12px}
  main{flex:1;min-height:0;display:flex;flex-direction:column}
  .pane{display:none;flex:1;min-height:0;flex-direction:column;gap:10px}
  .pane.on{display:flex}
  .split{display:flex;gap:12px;flex:1;min-height:0}
  .list{flex:0 0 38%;min-width:0;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px}
  .detail{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px 14px;min-height:0}
  .group{font-size:12px;color:var(--muted);padding:10px 6px 6px;letter-spacing:.4px}
  .item{border:1px solid var(--line);background:var(--panel2);border-radius:11px;padding:10px 12px;margin-bottom:7px;cursor:pointer}
  .item:hover{border-color:var(--accent)}
  .item.sel{border-color:var(--accent);box-shadow:inset 3px 0 0 var(--accent)}
  .item .t{font-size:14px;font-weight:600;word-break:break-word}
  .item .m{font-size:11.5px;color:var(--muted);margin-top:3px;word-break:break-all}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .head{display:flex;gap:8px;align-items:center;justify-content:space-between;padding-bottom:10px;border-bottom:1px solid var(--line);margin-bottom:10px;flex:none}
  .path{font:12px/1.5 ui-monospace,Consolas,monospace;color:var(--muted);word-break:break-all;flex:1;min-width:0}
  .md{flex:1;min-height:0;overflow:auto;font-size:15px;line-height:1.75;word-break:break-word}
  .md h1{font-size:23px;margin:.6em 0 .4em;padding-bottom:6px;border-bottom:1px solid var(--line)}
  .md h2{font-size:19px;margin:1em 0 .4em;padding-bottom:4px;border-bottom:1px solid var(--line)}
  .md h3{font-size:17px;margin:.9em 0 .3em}
  .md p{margin:.5em 0}.md ul,.md ol{margin:.4em 0;padding-left:1.4em}
  .md code{background:#252b37;border-radius:5px;padding:1px 5px;font:13px ui-monospace,Consolas,monospace}
  .md pre{background:#0f1319;border:1px solid var(--line);border-radius:10px;padding:11px;overflow:auto}
  .md pre code{background:transparent;padding:0}
  .md blockquote{margin:.6em 0;padding:.3em .9em;border-left:3px solid var(--accent);background:var(--panel2);border-radius:0 8px 8px 0;color:var(--muted)}
  .md a{color:#93c5fd}.md hr{border:0;border-top:1px solid var(--line);margin:1em 0}
  .empty{color:var(--muted);text-align:center;padding:26px 10px;font-size:13px}
  textarea,input,select{font:inherit;color:inherit;background:#10141a;border:1px solid var(--line);border-radius:10px;padding:10px;outline:none;width:100%}
  textarea{min-height:170px;resize:vertical;font:13.5px/1.6 ui-monospace,Consolas,monospace}
  input:focus,textarea:focus,select:focus{border-color:var(--accent)}
  .form{display:flex;flex-direction:column;gap:9px}
  .toast{position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom));transform:translateX(-50%);background:#202636;border:1px solid var(--accent);border-radius:10px;padding:9px 15px;font-size:13.5px;box-shadow:0 10px 30px rgba(0,0,0,.45);display:none;z-index:20;max-width:90vw}
  .toast.on{display:block}
  .back{display:none}
  @media(max-width:760px){
    body{padding-left:10px;padding-right:10px}
    h1{font-size:21px}
    .split{display:block;position:relative}
    .list{height:100%;flex:none}
    .detail{display:none;position:absolute;inset:0;z-index:5}
    .detail.show{display:flex}
    .back{display:inline-block}
  }
</style>
</head>
<body>
<header>
  <div style="flex:1;min-width:0">
    <h1>记忆</h1>
    <div class="sub" id="sub">加载中…</div>
  </div>
  <button id="refresh" class="sm">刷新</button>
</header>

<div class="tabs" id="tabs">
  <button class="tab on" data-tab="inbox">待确认<span class="n" id="n-inbox"></span></button>
  <button class="tab" data-tab="memory">记忆</button>
  <button class="tab" data-tab="backup">备份</button>
</div>

<main>
  <section class="pane on" id="pane-inbox">
    <div class="split">
      <div class="list" id="inboxList"></div>
      <div class="detail" id="inboxDetail">
        <div class="head">
          <button class="sm back" data-back="inbox">‹ 返回</button>
          <div class="path" id="inboxPath">选择左侧条目</div>
          <div class="row" id="inboxActions" style="display:none">
            <select id="acceptKind" style="width:auto">
              <option value="notes">笔记</option>
              <option value="facts">事实</option>
              <option value="decisions">决策</option>
              <option value="projects">项目</option>
            </select>
            <button class="sm primary" id="acceptBtn">接受</button>
            <button class="sm" id="rejectBtn">忽略</button>
          </div>
        </div>
        <div class="md" id="inboxMd"><div class="empty">待确认列表为空时，这里会显示摘要。</div></div>
      </div>
    </div>
  </section>

  <section class="pane" id="pane-memory">
    <div class="row" style="flex:none">
      <input id="search" placeholder="搜索共享记忆…" style="flex:1;min-width:120px">
      <button class="sm" id="searchBtn">搜索</button>
      <button class="sm primary" id="newBtn">新建</button>
    </div>
    <div class="split">
      <div class="list" id="memList"></div>
      <div class="detail" id="memDetail">
        <div class="head">
          <button class="sm back" data-back="memory">‹ 返回</button>
          <div class="path" id="memPath">选择文件</div>
          <div class="row" id="memActions"></div>
        </div>
        <div class="md" id="memMd"><div class="empty">从左侧选择一条记忆查看内容。</div></div>
      </div>
    </div>
  </section>

  <section class="pane" id="pane-backup">
    <div class="row" style="flex:none">
      <button class="sm primary" id="snapBtn">立即快照</button>
      <span class="sub" style="margin:0">git 目录在 $DSH_HOME，不参与同步</span>
    </div>
    <div class="list" id="backupList" style="flex:1"></div>
  </section>
</main>

<div class="toast" id="toast"></div>

<script>
var TOKEN = new URLSearchParams(location.search).get('token') || localStorage.getItem('dshMeshToken') || ''
if (new URLSearchParams(location.search).get('token')) localStorage.setItem('dshMeshToken', TOKEN)
var state = { status: null, inbox: [], files: [], backups: [], tab: 'inbox', draft: '', draftPath: '', file: '', fileText: '', groups: {}, editing: false, creating: false, backupError: '' }

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] }) }
function toast(msg) { var el = document.getElementById('toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(function () { el.classList.remove('on') }, 2600) }
function $(id) { return document.getElementById(id) }

function inline(s) {
  return esc(s)
    .replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}
function md(text) {
  var lines = String(text || '').split('\n'), html = '', inCode = false, inList = false
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    if (/^\s*\x60\x60\x60/.test(line)) { html += inCode ? '</code></pre>' : '<pre><code>'; inCode = !inCode; continue }
    if (inCode) { html += esc(line) + '\n'; continue }
    var h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) { var n = h[1].length; html += '<h' + n + '>' + inline(h[2]) + '</h' + n + '>'; continue }
    if (/^\s*[-*]\s+/.test(line)) { if (!inList) { html += '<ul>'; inList = true } html += '<li>' + inline(line.replace(/^\s*[-*]\s+/, '')) + '</li>'; continue }
    if (inList) { html += '</ul>'; inList = false }
    if (/^>\s?/.test(line)) { html += '<blockquote>' + inline(line.replace(/^>\s?/, '')) + '</blockquote>'; continue }
    if (/^---+$/.test(line.trim())) { html += '<hr>'; continue }
    if (line.trim()) html += '<p>' + inline(line) + '</p>'
  }
  if (inList) html += '</ul>'
  if (inCode) html += '</code></pre>'
  return html || '<div class="empty">（空）</div>'
}

function api(path, opts) {
  opts = opts || {}
  var headers = Object.assign({}, opts.headers || {})
  if (TOKEN) headers['x-dsh-mesh-token'] = TOKEN
  return fetch('/dsh-mesh/api' + path, Object.assign({ cache: 'no-store' }, opts, { headers: headers })).then(function (res) {
    return res.json().then(function (json) { if (!json.ok) throw new Error(json.error || ('HTTP ' + res.status)); return json })
  })
}
function post(path, body) {
  return api(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh-mesh-action': '1' }, body: JSON.stringify(body || {}) })
}

function flatten(nodes, prefix) {
  var out = []
  ;(nodes || []).forEach(function (node) {
    var p = prefix ? prefix + '/' + node.name : node.name
    if (node.type === 'dir') out = out.concat(flatten(node.children || [], p))
    else out.push(p)
  })
  return out
}
function titleOf(p) {
  var base = p.split('/').pop().replace(/\.md$/i, '')
  var cut = base.replace(/^\d{8}-\d{6}(-[0-9a-f]{6})?-/, '')
  return cut || base
}
function groupOf(p) {
  if (p === 'AGENTS.shared.md') return '共享规则'
  if (p.indexOf('skills/') === 0) return '技能'
  if (p.indexOf('memory/facts') === 0) return '事实'
  if (p.indexOf('memory/decisions') === 0) return '决策'
  if (p.indexOf('memory/projects') === 0) return '项目'
  if (p.indexOf('memory/notes') === 0) return '笔记'
  if (p.indexOf('sessions/') === 0) return '会话摘要'
  return '其他'
}
var GROUP_ORDER = ['共享规则', '技能', '事实', '决策', '项目', '笔记', '会话摘要', '其他']

function setTab(tab) {
  state.tab = tab
  var tabs = document.querySelectorAll('.tab')
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].getAttribute('data-tab') === tab)
  var panes = document.querySelectorAll('.pane')
  for (var j = 0; j < panes.length; j++) panes[j].classList.toggle('on', panes[j].id === 'pane-' + tab)
}
function openDetail(which) { var el = $(which === 'inbox' ? 'inboxDetail' : 'memDetail'); if (el) el.classList.add('show') }
function closeDetail(which) { var el = $(which === 'inbox' ? 'inboxDetail' : 'memDetail'); if (el) el.classList.remove('show') }

function safe(p) {
  return p.then(function (v) { return { ok: true, v: v } }, function (e) { return { ok: false, e: e && e.message ? e.message : String(e) } })
}
function load() {
  return Promise.all([safe(api('/status')), safe(api('/tree')), safe(api('/inbox')), safe(api('/backup'))]).then(function (out) {
    if (!out[0].ok) { $('sub').textContent = '加载失败：' + out[0].e; toast(out[0].e); return }
    state.status = out[0].v
    if (out[1].ok) state.files = flatten(out[1].v.root || [], '')
    state.inbox = out[2].ok ? (out[2].v.items || []) : []
    state.backups = out[3].ok ? (out[3].v.items || []) : []
    state.backupError = out[3].ok ? (out[3].v.available === false ? (out[3].v.reason || '备份不可用') : '') : out[3].e
    var c = state.status.counts || {}
    $('sub').textContent = (state.status.device || 'device') + ' · ' + (c.facts || 0) + ' 事实 · ' + (c.notes || 0) + ' 笔记 · ' + (c.sessions || 0) + ' 摘要'
    $('n-inbox').textContent = state.inbox.length ? ' ' + state.inbox.length : ''
    renderInbox(); renderMemory(); renderBackup()
  }).catch(function (e) { $('sub').textContent = '加载失败：' + (e && e.message ? e.message : e) })
}

function renderInbox() {
  var box = $('inboxList')
  if (!state.inbox.length) { box.innerHTML = '<div class="empty">还没有待确认的会话。结束一个会话或空闲 5 分钟后自动出现。</div>'; return }
  box.innerHTML = ''
  state.inbox.forEach(function (item) {
    var el = document.createElement('div')
    el.className = 'item' + (state.draftPath === item.path ? ' sel' : '')
    el.innerHTML = '<div class="t">' + esc(item.title) + '</div><div class="m">' + esc(item.turns) + ' 轮 · ' + esc((item.updatedAt || '').slice(0, 16).replace('T', ' ')) + '</div>'
    el.onclick = function () { openDraft(item.path) }
    box.appendChild(el)
  })
}
function openDraft(path) {
  state.draftPath = path
  api('/inbox/file?path=' + encodeURIComponent(path)).then(function (out) {
    state.draft = out.text || ''
    $('inboxPath').textContent = path
    $('inboxActions').style.display = 'flex'
    $('inboxMd').innerHTML = md(out.text || '')
    renderInbox()
    openDetail('inbox')
  }).catch(function (e) { toast(e.message) })
}
function accept() {
  if (!state.draftPath) return
  post('/inbox/accept', { path: state.draftPath, kind: $('acceptKind').value }).then(function (out) {
    toast('已接受 → ' + out.memory); state.draftPath = ''; $('inboxActions').style.display = 'none'; $('inboxMd').innerHTML = '<div class="empty">已接受。</div>'; $('inboxPath').textContent = '选择左侧条目'; closeDetail('inbox'); return load()
  }).catch(function (e) { toast(e.message) })
}
function reject() {
  if (!state.draftPath) return
  post('/inbox/reject', { path: state.draftPath }).then(function () {
    toast('已忽略'); state.draftPath = ''; $('inboxActions').style.display = 'none'; $('inboxMd').innerHTML = '<div class="empty">已忽略。</div>'; $('inboxPath').textContent = '选择左侧条目'; closeDetail('inbox'); return load()
  }).catch(function (e) { toast(e.message) })
}
function flushInbox() {
  post('/inbox/flush', {}).then(function (out) { toast('已整理 ' + out.flushed + ' 条'); return load() }).catch(function (e) { toast(e.message) })
}

function renderMemory(filter) {
  var box = $('memList')
  var groups = {}
  state.files.forEach(function (p) { var g = groupOf(p); (groups[g] = groups[g] || []).push(p) })
  state.groups = groups
  var html = ''
  GROUP_ORDER.forEach(function (g) {
    var items = (groups[g] || []).filter(function (p) { return !filter || p.toLowerCase().indexOf(filter) >= 0 })
    if (!items.length) return
    html += '<div class="group">' + esc(g) + ' · ' + items.length + '</div>'
    items.forEach(function (p) {
      html += '<div class="item' + (state.file === p ? ' sel' : '') + '" data-path="' + esc(p) + '"><div class="t">' + esc(titleOf(p)) + '</div><div class="m">' + esc(p) + '</div></div>'
    })
  })
  box.innerHTML = html || '<div class="empty">没有匹配的记忆。</div>'
  var items = box.querySelectorAll('.item')
  for (var i = 0; i < items.length; i++) items[i].onclick = function () { openFile(this.getAttribute('data-path')) }
}
function openFile(path) {
  state.file = path; state.editing = false
  api('/file?path=' + encodeURIComponent(path)).then(function (out) {
    state.fileText = out.text || ''
    $('memPath').textContent = path
    $('memMd').innerHTML = md(state.fileText)
    renderMemActions()
    renderMemory()
    openDetail('memory')
  }).catch(function (e) { toast(e.message) })
}
function renderMemActions() {
  var box = $('memActions'), path = state.file
  if (!path) { box.innerHTML = ''; return }
  var editable = path.indexOf('memory/') === 0
  var html = ''
  if (editable && !state.editing) html += '<button class="sm" id="editBtn">编辑</button><button class="sm danger" id="delBtn">删除</button>'
  if (state.editing) html += '<button class="sm primary" id="saveBtn">保存</button><button class="sm" id="cancelBtn">取消</button>'
  box.innerHTML = html
  if ($('editBtn')) $('editBtn').onclick = function () { state.editing = true; $('memMd').innerHTML = '<textarea id="editArea">' + esc(state.fileText) + '</textarea>'; renderMemActions() }
  if ($('cancelBtn')) $('cancelBtn').onclick = function () { state.editing = false; $('memMd').innerHTML = md(state.fileText); renderMemActions() }
  if ($('saveBtn')) $('saveBtn').onclick = function () {
    var text = $('editArea').value
    post('/memory/update', { path: path, content: text }).then(function () { state.editing = false; state.fileText = text; $('memMd').innerHTML = md(text); renderMemActions(); toast('已保存'); return load() }).catch(function (e) { toast(e.message) })
  }
  if ($('delBtn')) $('delBtn').onclick = function () {
    if (!confirm('把 ' + path + ' 移入回收站？')) return
    post('/memory/delete', { path: path }).then(function () { toast('已移入回收站'); state.file = ''; $('memPath').textContent = '选择文件'; $('memMd').innerHTML = '<div class="empty">已删除。</div>'; $('memActions').innerHTML = ''; closeDetail('memory'); return load() }).catch(function (e) { toast(e.message) })
  }
}
function newMemory() {
  state.file = ''; state.editing = false
  $('memPath').textContent = '新建记忆'
  $('memActions').innerHTML = ''
  $('memMd').innerHTML = '<div class="form">'
    + '<div class="row"><select id="newKind" style="width:auto"><option value="notes">笔记</option><option value="facts">事实</option><option value="decisions">决策</option><option value="projects">项目</option></select>'
    + '<input id="newTitle" placeholder="标题" style="flex:1"></div>'
    + '<textarea id="newContent" placeholder="正文（Markdown）"></textarea>'
    + '<div class="row"><button class="sm primary" id="createBtn">保存</button><button class="sm" id="cancelNew">取消</button></div>'
    + '</div>'
  openDetail('memory')
  $('createBtn').onclick = function () {
    var title = $('newTitle').value.trim(), content = $('newContent').value
    if (!title || !content.trim()) { toast('标题和内容都要填'); return }
    post('/memory/write', { kind: $('newKind').value, title: title, content: content }).then(function (out) { toast('已写入 ' + out.path); return load().then(function () { openFile(out.path) }) }).catch(function (e) { toast(e.message) })
  }
  $('cancelNew').onclick = function () { $('memMd').innerHTML = '<div class="empty">从左侧选择一条记忆查看内容。</div>'; $('memPath').textContent = '选择文件' }
}
function renderBackup() {
  var box = $('backupList')
  if (state.backupError) { box.innerHTML = '<div class="empty">备份不可用：' + esc(state.backupError) + '</div>'; return }
  if (!state.backups.length) { box.innerHTML = '<div class="empty">还没有快照。</div>'; return }
  box.innerHTML = ''
  state.backups.forEach(function (row) {
    var el = document.createElement('div')
    el.className = 'item'
    el.innerHTML = '<div class="t">' + esc(row.message) + '</div><div class="m">' + esc(row.commit) + ' · ' + esc(row.date) + '</div>'
    var btn = document.createElement('button'); btn.className = 'sm'; btn.textContent = '恢复'; btn.style.marginTop = '6px'
    btn.onclick = function (e) { e.stopPropagation(); restore(row.commit) }
    el.appendChild(btn)
    box.appendChild(el)
  })
}
function snapshot() { post('/backup/snapshot', {}).then(function (out) { toast(out.changed ? '已快照 ' + out.commit : '没有变化'); return load() }).catch(function (e) { toast(e.message) }) }
function restore(commit) {
  if (!confirm('恢复到 ' + commit + '？当前状态会先自动快照。')) return
  post('/backup/restore', { commit: commit, confirm: true }).then(function () { toast('已恢复 ' + commit); return load() }).catch(function (e) { toast(e.message) })
}

document.getElementById('tabs').addEventListener('click', function (e) {
  var tab = e.target.closest ? e.target.closest('.tab') : null
  if (tab) setTab(tab.getAttribute('data-tab'))
})
$('refresh').onclick = function () { load().then(function () { toast('已刷新') }) }
$('acceptBtn').onclick = accept
$('rejectBtn').onclick = reject
$('searchBtn').onclick = function () { renderMemory($('search').value.trim().toLowerCase()) }
$('search').addEventListener('keydown', function (e) { if (e.key === 'Enter') renderMemory($('search').value.trim().toLowerCase()) })
$('newBtn').onclick = newMemory
$('snapBtn').onclick = snapshot
var backs = document.querySelectorAll('[data-back]')
for (var i = 0; i < backs.length; i++) backs[i].onclick = function () { closeDetail(this.getAttribute('data-back')) }
load()
</script>
</body>
</html>
`

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
          try {
            const items = await listSnapshots(settings)
            writeJson(res, 200, { ok: true, count: items.length, items, available: true })
          } catch (error) {
            writeJson(res, 200, { ok: true, count: 0, items: [], available: false, reason: String(error?.message || error) })
          }
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
