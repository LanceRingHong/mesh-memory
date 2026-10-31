/**
 * dsh-mesh — Client half.
 *
 * Loaded by the DSH web shell (desktop and DSH Go's WebView) through
 * window.__ModuleLoader__.load. Registers:
 *   - conversation.view: full "记忆" explorer
 *   - sidebar.footer.action: sidebar entry that opens the explorer overlay
 *   - conversation.session.header.utilities: header button for the same overlay
 *
 * Host API: GET /dsh-mesh/api/{status,tree,search,file}
 */
window.__ModuleLoader__.load({
  id: 'dsh-mesh',

  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useMemo, useRef, useState } = React

    let ReactDOM = null
    try {
      ReactDOM = require('react-dom')
    } catch {
      ReactDOM = null
    }

    const createPortal =
      typeof ReactDOM?.createPortal === 'function'
        ? ReactDOM.createPortal
        : (node) => node

    const API = '/dsh-mesh/api'
    const STYLE_ID = 'dsh-mesh/client-styles'

    const CSS = [
      // 容器
      '.dsh-mesh-explorer{position:relative;display:flex;flex-direction:column;min-height:0;height:100%;color:var(--dsw-alias-label-primary,#e7eaf0);font-size:13.5px;line-height:1.6;padding:2px 2px 8px}',
      // 顶部
      '.dsh-mesh-head{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;justify-content:space-between;padding:4px 2px 16px;flex:none}',
      '.dsh-mesh-title{font-size:22px;font-weight:700;margin:0;letter-spacing:.2px}',
      '.dsh-mesh-sub{opacity:.62;font-size:12px;margin-top:5px;word-break:break-all}',
      // 按钮
      '.dsh-mesh-btn{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.26));border-radius:9px;padding:7px 13px;cursor:pointer;font:inherit;font-size:13px;transition:border-color .15s,background .15s}',
      '.dsh-mesh-btn:hover{border-color:var(--dsw-alias-brand-primary,#6ee7b7)}',
      '.dsh-mesh-btn:disabled{opacity:.5;cursor:default}',
      '.dsh-mesh-btn.sm{padding:5px 10px;font-size:12px;border-radius:8px}',
      '.dsh-mesh-btn.primary{background:var(--dsw-alias-brand-primary,#6ee7b7);border-color:var(--dsw-alias-brand-primary,#6ee7b7);color:#07110c;font-weight:600}',
      '.dsh-mesh-btn.danger{color:#f87171;border-color:rgba(248,113,113,.45)}',
      '.dsh-mesh-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      // 标签页
      '.dsh-mesh-tabs{display:flex;gap:8px;padding:0 0 14px;flex:none}',
      '.dsh-mesh-tab{padding:8px 16px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24));background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:13px;transition:all .15s}',
      '.dsh-mesh-tab:hover{border-color:var(--dsw-alias-brand-primary,#6ee7b7)}',
      '.dsh-mesh-tab.on{background:var(--dsw-alias-brand-primary,#6ee7b7);border-color:var(--dsw-alias-brand-primary,#6ee7b7);color:#07110c;font-weight:600}',
      // 主体与两栏
      '.dsh-mesh-body{display:flex;flex-direction:column;flex:1;min-height:0;gap:12px}',
      '.dsh-mesh-tabpane{display:flex;flex-direction:column;flex:1;min-height:0;gap:12px}',
      '.dsh-mesh-split{display:flex;gap:12px;min-height:0;flex:1;align-items:stretch}',
      '.dsh-mesh-split>.dsh-mesh-box{flex:0 0 clamp(180px,30%,330px);min-width:0}',
      '.dsh-mesh-split>.dsh-mesh-content{flex:1;min-width:0}',
      // 面板
      '.dsh-mesh-box{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.05));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:14px;padding:10px;min-height:0;overflow:auto}',
      '.dsh-mesh-box-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:2px 4px 10px;font-size:12px;opacity:.85}',
      '.dsh-mesh-content{display:flex;flex-direction:column;min-height:0;padding:12px 14px 14px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.05));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:14px}',
      '.dsh-mesh-content-head{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:0 2px 10px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.14));margin-bottom:12px}',
      '.dsh-mesh-content-path{font:11.5px/1.5 ui-monospace,Consolas,monospace;opacity:.6;word-break:break-all}',
      // 树
      '.dsh-mesh-tree{font-size:12.5px}',
      '.dsh-mesh-row{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:8px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .12s}',
      '.dsh-mesh-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.dsh-mesh-row.sel{background:var(--dsw-alias-interactive-bg-active,rgba(110,231,183,.14));box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary,#6ee7b7)}',
      '.dsh-mesh-row .caret{width:12px;flex:none;opacity:.6;font-size:10px}',
      '.dsh-mesh-row .nm{overflow:hidden;text-overflow:ellipsis}',
      '.dsh-mesh-row .sz{margin-left:auto;opacity:.4;font-size:10.5px;flex:none}',
      '.dsh-mesh-dir{font-weight:600}',
      '.dsh-mesh-empty{opacity:.5;font-size:12px;padding:14px 8px;text-align:center}',
      '.dsh-mesh-results{margin-top:12px;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16));padding-top:10px}',
      '.dsh-mesh-result{padding:8px 9px;border-radius:8px;cursor:pointer}',
      '.dsh-mesh-result:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.dsh-mesh-result .t{font-size:12.5px;font-weight:600;word-break:break-all}',
      '.dsh-mesh-result .p{font-size:11px;opacity:.5;margin-top:3px;word-break:break-all}',
      // 待确认列表
      '.dsh-mesh-item{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:11px;padding:11px 12px;margin-bottom:8px;cursor:pointer;background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.12));transition:border-color .15s,background .15s}',
      '.dsh-mesh-item:hover{border-color:var(--dsw-alias-brand-primary,#6ee7b7)}',
      '.dsh-mesh-item.sel{border-color:var(--dsw-alias-brand-primary,#6ee7b7);background:var(--dsw-alias-interactive-bg-active,rgba(110,231,183,.12))}',
      '.dsh-mesh-item.static{cursor:default}',
      '.dsh-mesh-item .t{font-size:13px;font-weight:600;line-height:1.5;word-break:break-word}',
      '.dsh-mesh-item .m{font-size:11px;opacity:.5;margin-top:4px;word-break:break-all}',
      // 表单
      '.dsh-mesh-toolbar{display:flex;gap:8px;padding-bottom:12px;flex:none;align-items:center}',
      '.dsh-mesh-input{flex:1;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));border-radius:9px;padding:9px 11px;color:inherit;font:inherit;font-size:13px;outline:none;min-width:0}',
      '.dsh-mesh-input:focus{border-color:var(--dsw-alias-brand-primary,#6ee7b7)}',
      '.dsh-mesh-select{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));border-radius:8px;padding:6px 8px;color:inherit;font:inherit;font-size:12px}',
      '.dsh-mesh-form{display:flex;flex-direction:column;gap:10px;padding:12px;margin-bottom:4px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.05));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:14px;flex:none}',
      '.dsh-mesh-form .row{display:flex;gap:10px;align-items:center}',
      '.dsh-mesh-form input{flex:1}',
      '.dsh-mesh-textarea{width:100%;min-height:170px;flex:none;background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.16));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:10px;padding:12px;color:inherit;font:12.5px/1.65 ui-monospace,Consolas,monospace;resize:vertical;outline:none}',
      '.dsh-mesh-textarea.fill{flex:1;min-height:0;resize:none}',
      '.dsh-mesh-textarea:focus{border-color:var(--dsw-alias-brand-primary,#6ee7b7)}',
      // Markdown
      '.dsh-mesh-md{flex:1;min-height:0;overflow:auto;padding:4px 6px 4px 2px;font-size:13.5px;line-height:1.75;word-break:break-word}',
      '.dsh-mesh-md h1,.dsh-mesh-md h2,.dsh-mesh-md h3,.dsh-mesh-md h4,.dsh-mesh-md h5,.dsh-mesh-md h6{margin:1.2em 0 .5em;line-height:1.35}',
      '.dsh-mesh-md h1{font-size:23px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));padding-bottom:8px}',
      '.dsh-mesh-md h2{font-size:19px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.14));padding-bottom:5px}',
      '.dsh-mesh-md h3{font-size:16px}.dsh-mesh-md h4{font-size:14.5px}',
      '.dsh-mesh-md p{margin:.55em 0}.dsh-mesh-md ul,.dsh-mesh-md ol{margin:.5em 0;padding-left:1.6em}',
      '.dsh-mesh-md li{margin:.25em 0}.dsh-mesh-md blockquote{margin:.7em 0;padding:.4em 1em;border-left:3px solid var(--dsw-alias-brand-primary,#6ee7b7);background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));border-radius:0 8px 8px 0;opacity:.9}',
      '.dsh-mesh-md code{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.15));border-radius:5px;padding:1px 6px;font:11.5px/1.5 ui-monospace,Consolas,monospace}',
      '.dsh-mesh-md pre{background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.22));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));border-radius:10px;padding:12px;overflow:auto;margin:.8em 0}',
      '.dsh-mesh-md pre code{background:transparent;padding:0}',
      '.dsh-mesh-md a{color:var(--dsw-alias-brand-primary,#93c5fd);text-decoration:none}.dsh-mesh-md a:hover{text-decoration:underline}',
      '.dsh-mesh-md table{border-collapse:collapse;margin:.8em 0;font-size:13px;width:100%}',
      '.dsh-mesh-md th,.dsh-mesh-md td{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));padding:7px 10px;text-align:left;vertical-align:top}',
      '.dsh-mesh-md th{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1))}',
      '.dsh-mesh-md hr{border:0;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));margin:1.2em 0}',
      '.dsh-mesh-md del{opacity:.6}',
      '.dsh-mesh-pre{margin:0;padding:12px;background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.18));border-radius:10px;overflow:auto;min-height:0;flex:1;font:12.5px/1.65 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word}',
      // 杂项
      '.dsh-mesh-err{color:var(--dsw-alias-state-error-primary,#fbbf24);font-size:12px;padding:6px 2px}',
      '.dsh-mesh-hint{font-size:12px;opacity:.5}',
      '.dsh-mesh-l{font-size:11px;opacity:.6;margin-top:2px}',
      '.dsh-mesh-toast{position:absolute;right:16px;bottom:16px;background:var(--dsw-alias-bg-layer-3,rgba(30,34,43,.97));border:1px solid var(--dsw-alias-brand-primary,#6ee7b7);border-radius:10px;padding:10px 14px;font-size:13px;z-index:5;max-width:70%;box-shadow:0 8px 24px rgba(0,0,0,.35)}',
      // 入口与弹层
      '.dsh-mesh-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}',
      '.dsh-mesh-dialog{position:relative;width:min(1180px,96vw);height:min(820px,92vh);background:var(--dsw-alias-bg-layer-1,#171a21);border:1px solid var(--dsw-alias-border-l2,#2a303c);border-radius:18px;padding:20px;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden}',
      '.dsh-mesh-close{position:absolute;right:12px;top:10px;border:0;background:transparent;color:inherit;font-size:22px;cursor:pointer;opacity:.55;z-index:2}',
      '.dsh-mesh-close:hover{opacity:1}',
      '.dsh-mesh-entry{border:1px solid transparent;background:transparent;color:inherit;cursor:pointer;font:inherit;border-radius:9px;padding:6px 9px;display:inline-flex;align-items:center;gap:6px;min-width:0}',
      '.dsh-mesh-entry:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.dsh-mesh-entry .dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#34d399);flex:none}',
    ].join('')

    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID)) return
      const tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    async function api(path) {
      // 超时/取消：避免网络挂起时 UI 永久“读取中”（P2-8）。
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timer = controller ? setTimeout(() => controller.abort(), 15000) : null
      try {
        const res = await fetch(API + path, { cache: 'no-store', signal: controller?.signal })
        const json = await res.json()
        if (!json.ok) throw new Error(json.error || 'request failed')
        return json
      } finally {
        if (timer) clearTimeout(timer)
      }
    }

    function fmtSize(n) {
      if (!Number.isFinite(n)) return ''
      if (n < 1024) return `${n} B`
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
      return `${(n / 1024 / 1024).toFixed(1)} MB`
    }

    const ZH = {
      'AGENTS.shared.md': '共享规则',
      skills: '技能',
      'skills/mesh-memory': 'mesh-memory 技能',
      'SKILL.md': '技能说明',
      memory: '记忆库',
      'memory/facts': '事实',
      'memory/decisions': '决策',
      'memory/projects': '项目',
      sessions: '会话摘要',
      index: '索引',
      '.mesh': '同步元数据',
      '.stversions': '版本历史',
      'index/devices.json': '设备列表',
      'index/sessions.jsonl': '会话索引',
      'index/files.jsonl': '文件索引',
      'skills.json': '技能清单',
    }

    function labelFor(node) {
      const mapped = ZH[node.path] || ZH[node.name]
      if (mapped) return mapped
      if (node.type === 'file' && node.title) return node.title
      return node.name
    }

    function escHtml(s) {
      return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    }

    function inlineMd(s) {
      return escHtml(s)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/~~([^~]+)~~/g, '<del>$1</del>')
        .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    }

    /**
     * 客户端 Markdown 只支持很小的子集，且所有文本先经过 escHtml；
     * 这里再做一次白名单式清理，避免后续改动引入 XSS（P2-9）。
     */
    function sanitizeHtml(html) {
      return String(html || '')
        .replace(/<\s*(script|iframe|object|embed|style|link|meta|form)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
        .replace(/<\s*(script|iframe|object|embed|style|link|meta|form)[^>]*\/?>/gi, '')
        .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/\s(href|src)\s*=\s*(["'])\s*(javascript|data):[^"']*\2/gi, ' $1="#"')
    }

    function renderMarkdown(text) {
      const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
      const out = []
      let code = false
      let codeLines = []
      let list = null
      let table = []
      const closeList = () => {
        if (list) {
          out.push(`</${list}>`)
          list = null
        }
      }
      const flushTable = () => {
        if (!table.length) return
        const rows = table
          .filter((r) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(r))
          .map((r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()))
        if (rows.length) {
          out.push('<table><thead><tr>' + rows[0].map((c) => `<th>${inlineMd(c)}</th>`).join('') + '</tr></thead><tbody>')
          for (const row of rows.slice(1)) {
            out.push('<tr>' + row.map((c) => `<td>${inlineMd(c)}</td>`).join('') + '</tr>')
          }
          out.push('</tbody></table>')
        }
        table = []
      }
      for (const line of lines) {
        if (/^```/.test(line)) {
          closeList()
          flushTable()
          if (code) {
            out.push(`<pre><code>${escHtml(codeLines.join('\n'))}</code></pre>`)
            code = false
            codeLines = []
          } else {
            code = true
          }
          continue
        }
        if (code) {
          codeLines.push(line)
          continue
        }
        if (/^\s*\|.*\|\s*$/.test(line)) {
          closeList()
          table.push(line)
          continue
        }
        flushTable()
        if (/^\s*$/.test(line)) {
          closeList()
          continue
        }
        const heading = line.match(/^(#{1,6})\s+(.*)$/)
        if (heading) {
          closeList()
          const level = heading[1].length
          out.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`)
          continue
        }
        if (/^\s*---+\s*$/.test(line)) {
          closeList()
          out.push('<hr>')
          continue
        }
        const quote = line.match(/^\s*>\s?(.*)$/)
        if (quote) {
          closeList()
          out.push(`<blockquote>${inlineMd(quote[1])}</blockquote>`)
          continue
        }
        const item = line.match(/^\s*([-*]|\d+\.)\s+(.*)$/)
        if (item) {
          const tag = /^\d+\.$/.test(item[1]) ? 'ol' : 'ul'
          if (list !== tag) {
            closeList()
            out.push(`<${tag}>`)
            list = tag
          }
          out.push(`<li>${inlineMd(item[2])}</li>`)
          continue
        }
        closeList()
        out.push(`<p>${inlineMd(line)}</p>`)
      }
      closeList()
      flushTable()
      if (code) out.push(`<pre><code>${escHtml(codeLines.join('\n'))}</code></pre>`)
      return out.join('')
    }

    function Card(label, value) {
      return h('div', { className: 'dsh-mesh-card', key: label }, [
        h('div', { className: 'dsh-mesh-n', key: 'n' }, value ?? 0),
        h('div', { className: 'dsh-mesh-l', key: 'l' }, label),
      ])
    }

    function TreeNode({ node, depth, expanded, toggle, open, selected }) {
      const pad = { paddingLeft: `${4 + depth * 14}px` }
      if (node.type === 'dir') {
        const isOpen = expanded.has(node.path)
        return h('div', { key: node.path }, [
          h(
            'div',
            {
              className: 'dsh-mesh-row dsh-mesh-dir',
              style: pad,
              onClick: () => toggle(node.path),
              title: node.path,
            },
            [
              h('span', { className: 'caret', key: 'c' }, isOpen ? '▾' : '▸'),
              h('span', { className: 'nm', key: 'n' }, labelFor(node)),
              h('span', { className: 'sz', key: 's' }, `${node.children?.length ?? 0}`),
            ],
          ),
          isOpen
            ? h(
                'div',
                { key: 'children' },
                (node.children || []).map((child) =>
                  h(TreeNode, { key: child.path, node: child, depth: depth + 1, expanded, toggle, open, selected }),
                ),
              )
            : null,
        ])
      }
      return h(
        'div',
        {
          key: node.path,
          className: `dsh-mesh-row${selected === node.path ? ' sel' : ''}`,
          style: pad,
          onClick: () => open(node.path),
          title: node.path,
        },
        [
          h('span', { className: 'caret', key: 'c' }, '·'),
          h('span', { className: 'nm', key: 'n' }, labelFor(node)),
          h('span', { className: 'sz', key: 's' }, node.conflict ? `⚠ 冲突 · ${fmtSize(node.size)}` : fmtSize(node.size)),
        ],
      )
    }

    const KIND_OPTIONS = [
      ['notes', '笔记'],
      ['facts', '事实'],
      ['decisions', '决策'],
      ['projects', '项目'],
    ]

    function fmtWhen(value) {
      if (!value) return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return String(value)
      const pad = (n) => String(n).padStart(2, '0')
      return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    function Explorer({ onClose }) {
      const [status, setStatus] = useState(null)
      const [tree, setTree] = useState([])
      const [expanded, setExpanded] = useState(() => new Set())
      const [selected, setSelected] = useState('AGENTS.shared.md')
      const [content, setContent] = useState('')
      const [query, setQuery] = useState('')
      const [results, setResults] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [viewMode, setViewMode] = useState('preview')
      const [tab, setTab] = useState('inbox')
      const [inbox, setInbox] = useState([])
      const [draftPath, setDraftPath] = useState('')
      const [draftText, setDraftText] = useState('')
      const [draftKind, setDraftKind] = useState('notes')
      const [backups, setBackups] = useState([])
      const [backupIssue, setBackupIssue] = useState('')
      const [editing, setEditing] = useState(false)
      const [editText, setEditText] = useState('')
      const [creating, setCreating] = useState(false)
      const [newTitle, setNewTitle] = useState('')
      const [newKind, setNewKind] = useState('notes')
      const [newContent, setNewContent] = useState('')
      const [toast, setToast] = useState('')
      const requestSeq = useRef(0)

      const flash = (text) => {
        setToast(text)
        setTimeout(() => setToast(''), 2600)
      }

      async function load() {
        setBusy(true)
        setError('')
        try {
          const [s, t, ib, bk] = await Promise.all([
            api('/status'),
            api('/tree'),
            api('/inbox'),
            api('/backup').catch((error) => ({ items: [], available: false, reason: String(error?.message || error) })),
          ])
          setStatus(s)
          setTree(t.root || [])
          setInbox(ib.items || [])
          setBackups(bk.items || [])
          setBackupIssue(bk.available === false ? bk.reason || '备份不可用' : '')
          setExpanded(new Set(['memory', 'memory/facts', 'memory/decisions', 'memory/projects', 'memory/notes', 'sessions', 'skills', 'index', '.mesh']))
        } catch (e) {
          setError(String(e?.message || e))
        } finally {
          setBusy(false)
        }
      }

      async function post(p, body) {
        const res = await fetch(API + p, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dsh-mesh-action': '1' },
          body: JSON.stringify(body || {}),
        })
        const json = await res.json()
        if (!json.ok) throw new Error(json.error || '操作失败')
        return json
      }

      useEffect(() => {
        ensureStyle()
        load()
        openFile('AGENTS.shared.md')
      }, [])

      const openFile = async (p) => {
        const seq = requestSeq.current + 1
        requestSeq.current = seq
        setBusy(true)
        setError('')
        setEditing(false)
        try {
          const out = await api('/file?path=' + encodeURIComponent(p))
          if (seq !== requestSeq.current) return
          setContent(out.text || '')
        } catch (e) {
          if (seq !== requestSeq.current) return
          setContent('')
          setError(String(e?.message || e))
        } finally {
          if (seq === requestSeq.current) setBusy(false)
        }
      }

      const selectFile = (p) => {
        setSelected(p)
        setViewMode('preview')
        setCreating(false)
        openFile(p)
      }

      const toggle = (p) => {
        setExpanded((prev) => {
          const next = new Set(prev)
          if (next.has(p)) next.delete(p)
          else next.add(p)
          return next
        })
      }

      const search = async () => {
        const q = query.trim()
        if (!q) {
          setResults(null)
          return
        }
        setBusy(true)
        setError('')
        try {
          const out = await api('/search?q=' + encodeURIComponent(q))
          setResults(out.results || [])
        } catch (e) {
          setError(String(e?.message || e))
        } finally {
          setBusy(false)
        }
      }

      const openDraft = async (p) => {
        setDraftPath(p)
        setDraftText('')
        try {
          const out = await api('/inbox/file?path=' + encodeURIComponent(p))
          setDraftText(out.text || '')
        } catch (e) {
          flash(String(e?.message || e))
        }
      }

      const acceptDraft = async () => {
        if (!draftPath) return
        try {
          const out = await post('/inbox/accept', { path: draftPath, kind: draftKind })
          flash(`已接受 → ${out.memory}`)
          setDraftPath('')
          setDraftText('')
          await load()
        } catch (e) {
          flash(String(e?.message || e))
        }
      }

      const rejectDraft = async () => {
        if (!draftPath) return
        try {
          await post('/inbox/reject', { path: draftPath })
          flash('已忽略')
          setDraftPath('')
          setDraftText('')
          await load()
        } catch (e) {
          flash(String(e?.message || e))
        }
      }

      const flushInbox = async () => {
        try {
          const out = await post('/inbox/flush', {})
          flash(`已整理 ${out.flushed} 条`)
          await load()
        } catch (e) {
          flash(String(e?.message || e))
        }
      }

      const saveEdit = async () => {
        if (!selected) return
        try {
          await post('/memory/update', { path: selected, content: editText })
          setEditing(false)
          flash('已保存')
          await openFile(selected)
          await load()
        } catch (e) {
          flash(String(e?.message || e))
        }
      }

      const removeFile = async () => {
        if (!selected) return
        if (typeof window !== 'undefined' && !window.confirm(`把 ${selected} 移入回收站？`)) return
        try {
          await post('/memory/delete', { path: selected })
          flash('已移入回收站')
          setSelected('')
          setContent('')
          await load()
        } catch (e) {
          flash(String(e?.message || e))
        }
      }

      const createMemory = async () => {
        if (!newTitle.trim() || !newContent.trim()) {
          flash('标题和内容都要填')
          return
        }
        try {
          const out = await post('/memory/write', { kind: newKind, title: newTitle.trim(), content: newContent })
          setCreating(false)
          setNewTitle('')
          setNewContent('')
          flash('已写入')
          await load()
          selectFile(out.path)
          setTab('memory')
        } catch (e) {
          flash(String(e?.message || e))
        }
      }

      const snapshotNow = async () => {
        try {
          const out = await post('/backup/snapshot', {})
          flash(out.changed ? `已快照 ${out.commit}` : '没有变化，无需快照')
          await load()
        } catch (e) {
          flash(String(e?.message || e))
        }
      }

      const restoreCommit = async (commit) => {
        if (typeof window !== 'undefined' && !window.confirm(`恢复到 ${commit}？当前状态会先自动快照。`)) return
        try {
          await post('/backup/restore', { commit, confirm: true })
          flash(`已恢复 ${commit}`)
          await load()
          if (selected) openFile(selected)
        } catch (e) {
          flash(String(e?.message || e))
        }
      }

      const counts = status?.counts || {}
      const isMarkdown = /\.(md|markdown)$/i.test(selected)
      const editable = /^memory\//.test(selected)
      const previewHtml = useMemo(
        () => (isMarkdown && viewMode === 'preview' ? sanitizeHtml(renderMarkdown(content.slice(0, 100000))) : ''),
        [content, isMarkdown, viewMode],
      )
      const draftHtml = useMemo(() => sanitizeHtml(renderMarkdown(draftText.slice(0, 100000))), [draftText])

      const head = h('div', { className: 'dsh-mesh-head', key: 'head' }, [
        h('div', { key: 'title' }, [
          h('h2', { className: 'dsh-mesh-title', key: 't' }, '记忆'),
          h(
            'div',
            { className: 'dsh-mesh-sub', key: 's' },
            status
              ? `${status.device || 'device'} · ${counts.facts || 0} 事实 · ${counts.notes || 0} 笔记 · ${counts.sessions || 0} 摘要`
              : '加载中…',
          ),
        ]),
        h('div', { className: 'dsh-mesh-actions', key: 'a' }, [
          h('button', { className: 'dsh-mesh-btn', key: 'r', onClick: load, disabled: busy }, busy ? '刷新中…' : '刷新'),
        ]),
      ])

      const tabs = [
        ['inbox', counts.inbox ? `待确认 · ${counts.inbox}` : '待确认'],
        ['memory', '记忆'],
        ['backup', '备份'],
      ]

      const inboxTab = h('div', { className: 'dsh-mesh-split', key: 'inbox' }, [
        h('div', { className: 'dsh-mesh-box', key: 'list' }, [
          h('div', { className: 'dsh-mesh-box-head', key: 'h' }, [
            h('span', { key: 't' }, `${inbox.length} 条待确认`),
            h('button', { className: 'dsh-mesh-btn sm', key: 'f', onClick: flushInbox }, '立即整理'),
          ]),
          inbox.length
            ? inbox.map((row) =>
                h(
                  'div',
                  {
                    key: row.path,
                    className: `dsh-mesh-item${draftPath === row.path ? ' sel' : ''}`,
                    onClick: () => openDraft(row.path),
                  },
                  [
                    h('div', { className: 't', key: 't' }, row.title),
                    h('div', { className: 'm', key: 'm' }, `${row.turns} 轮 · ${fmtWhen(row.updatedAt || row.createdAt)}`),
                  ],
                ),
              )
            : h('div', { className: 'dsh-mesh-empty' }, '还没有待确认的会话。结束一个会话或空闲 5 分钟后自动出现。'),
        ]),
        h('div', { className: 'dsh-mesh-content', key: 'detail' }, [
          h('div', { className: 'dsh-mesh-content-head', key: 'h' }, [
            h('div', { className: 'dsh-mesh-content-path', key: 'p' }, draftPath || '选择左侧条目查看摘要'),
            draftPath
              ? h('div', { className: 'dsh-mesh-actions', key: 'a' }, [
                  h(
                    'select',
                    {
                      key: 'k',
                      className: 'dsh-mesh-select',
                      value: draftKind,
                      onChange: (e) => setDraftKind(e.target.value),
                    },
                    KIND_OPTIONS.map(([value, label]) => h('option', { key: value, value }, label)),
                  ),
                  h('button', { className: 'dsh-mesh-btn sm primary', key: 'ok', onClick: acceptDraft }, '接受'),
                  h('button', { className: 'dsh-mesh-btn sm', key: 'no', onClick: rejectDraft }, '忽略'),
                ])
              : null,
          ]),
          h('div', {
            className: 'dsh-mesh-md',
            key: 'md',
            dangerouslySetInnerHTML: { __html: draftHtml || '<p>（选择一条待确认记录）</p>' },
          }),
        ]),
      ])

      const treeBox = h('div', { className: 'dsh-mesh-box dsh-mesh-tree', key: 'tree' }, [
        tree.length
          ? tree.map((node) => h(TreeNode, { key: node.path, node, depth: 0, expanded, toggle, open: selectFile, selected }))
          : h('div', { className: 'dsh-mesh-empty' }, '正在读取共享目录…'),
        results
          ? h('div', { className: 'dsh-mesh-results', key: 'results' }, [
              h('div', { className: 'dsh-mesh-l', key: 'h' }, `搜索结果 ${results.length} 条`),
              ...results.map((row) =>
                h('div', { className: 'dsh-mesh-result', key: row.path, onClick: () => selectFile(row.path) }, [
                  h('div', { className: 't', key: 't' }, row.path),
                  h('div', { className: 'p', key: 'p' }, row.snippet),
                ]),
              ),
            ])
          : null,
      ])

      const contentBox = h('div', { className: 'dsh-mesh-content', key: 'content' }, [
        h('div', { className: 'dsh-mesh-content-head', key: 'h' }, [
          h('div', { className: 'dsh-mesh-content-path', key: 'p' }, selected || '选择左侧文件查看内容'),
          h('div', { className: 'dsh-mesh-actions', key: 'a' }, [
            isMarkdown
              ? h(
                  'button',
                  {
                    className: 'dsh-mesh-btn sm',
                    key: 'mode',
                    onClick: () => setViewMode((m) => (m === 'preview' ? 'raw' : 'preview')),
                  },
                  viewMode === 'preview' ? '源码' : '预览',
                )
              : null,
            editable && !editing
              ? h(
                  'button',
                  {
                    className: 'dsh-mesh-btn sm',
                    key: 'edit',
                    onClick: () => {
                      setEditText(content)
                      setEditing(true)
                    },
                  },
                  '编辑',
                )
              : null,
            editable && !editing
              ? h('button', { className: 'dsh-mesh-btn sm danger', key: 'del', onClick: removeFile }, '删除')
              : null,
            editing ? h('button', { className: 'dsh-mesh-btn sm primary', key: 'save', onClick: saveEdit }, '保存') : null,
            editing ? h('button', { className: 'dsh-mesh-btn sm', key: 'cancel', onClick: () => setEditing(false) }, '取消') : null,
          ]),
        ]),
        editing
          ? h('textarea', {
              className: 'dsh-mesh-textarea fill',
              key: 'edit',
              value: editText,
              onChange: (e) => setEditText(e.target.value),
            })
          : isMarkdown && viewMode === 'preview'
            ? h('div', {
                className: 'dsh-mesh-md',
                key: 'md',
                dangerouslySetInnerHTML: { __html: previewHtml || '<p>（空文件）</p>' },
              })
            : h('pre', { className: 'dsh-mesh-pre', key: 'pre' }, content || '选择左侧文件查看内容。'),
      ])

      const memoryTab = h('div', { className: 'dsh-mesh-tabpane', key: 'memory' }, [
        h('div', { className: 'dsh-mesh-toolbar', key: 'tb' }, [
          h('input', {
            key: 'q',
            className: 'dsh-mesh-input',
            value: query,
            placeholder: '搜索共享记忆…',
            onChange: (e) => setQuery(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter') search()
            },
          }),
          h('button', { className: 'dsh-mesh-btn', key: 'go', onClick: search }, '搜索'),
          h(
            'button',
            {
              className: 'dsh-mesh-btn primary',
              key: 'new',
              onClick: () => {
                setCreating(true)
                setEditing(false)
              },
            },
            '新建',
          ),
        ]),
        creating
          ? h('div', { className: 'dsh-mesh-form', key: 'form' }, [
              h('div', { className: 'row', key: 'r' }, [
                h(
                  'select',
                  { key: 'k', className: 'dsh-mesh-select', value: newKind, onChange: (e) => setNewKind(e.target.value) },
                  KIND_OPTIONS.map(([value, label]) => h('option', { key: value, value }, label)),
                ),
                h('input', {
                  key: 't',
                  className: 'dsh-mesh-input',
                  placeholder: '标题',
                  value: newTitle,
                  onChange: (e) => setNewTitle(e.target.value),
                }),
              ]),
              h('textarea', {
                key: 'c',
                className: 'dsh-mesh-textarea',
                placeholder: '正文（Markdown）',
                value: newContent,
                onChange: (e) => setNewContent(e.target.value),
              }),
              h('div', { className: 'row', key: 'a' }, [
                h('button', { className: 'dsh-mesh-btn sm primary', key: 's', onClick: createMemory }, '保存'),
                h('button', { className: 'dsh-mesh-btn sm', key: 'x', onClick: () => setCreating(false) }, '取消'),
              ]),
            ])
          : null,
        h('div', { className: 'dsh-mesh-split', key: 'split' }, [treeBox, contentBox]),
      ])

      const backupTab = h('div', { className: 'dsh-mesh-tabpane', key: 'backup' }, [
        h('div', { className: 'dsh-mesh-toolbar', key: 'tb' }, [
          h('button', { className: 'dsh-mesh-btn primary', key: 's', onClick: snapshotNow }, '立即快照'),
          h('span', { className: 'dsh-mesh-hint', key: 'h' }, 'git 目录在 $DSH_HOME，不参与同步'),
        ]),
        backups.length
          ? backups.map((row) =>
              h('div', { className: 'dsh-mesh-item static', key: row.commit }, [
                h('div', { className: 't', key: 't' }, row.message),
                h('div', { className: 'm', key: 'm' }, `${row.commit} · ${row.date}`),
                h(
                  'div',
                  { className: 'dsh-mesh-actions', key: 'a', style: { marginTop: '6px' } },
                  [h('button', { className: 'dsh-mesh-btn sm', key: 'r', onClick: () => restoreCommit(row.commit) }, '恢复')],
                ),
              ]),
            )
          : h('div', { className: 'dsh-mesh-empty' }, backupIssue ? `备份不可用：${backupIssue}` : '还没有快照。'),
      ])

      return h('div', { className: 'dsh-mesh-explorer' }, [
        head,
        toast ? h('div', { className: 'dsh-mesh-toast', key: 'toast' }, toast) : null,
        error ? h('div', { className: 'dsh-mesh-err', key: 'e' }, error) : null,
        h(
          'div',
          { className: 'dsh-mesh-tabs', key: 'tabs' },
          tabs.map(([id, label]) =>
            h(
              'button',
              {
                key: id,
                className: `dsh-mesh-tab${tab === id ? ' on' : ''}`,
                onClick: () => setTab(id),
              },
              label,
            ),
          ),
        ),
        h('div', { className: 'dsh-mesh-body', key: 'body' }, [
          tab === 'inbox' ? inboxTab : null,
          tab === 'memory' ? memoryTab : null,
          tab === 'backup' ? backupTab : null,
        ]),
      ])
    }

    function Overlay({ onClose }) {
      useEffect(() => {
        const onKey = (e) => {
          if (e.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [onClose])
      return createPortal(
        h(
          'div',
          {
            className: 'dsh-mesh-overlay',
            onMouseDown: (e) => {
              if (e.target === e.currentTarget) onClose()
            },
          },
          h('div', { className: 'dsh-mesh-dialog' }, [
            h('button', { className: 'dsh-mesh-close', key: 'x', onClick: onClose, title: '关闭' }, '×'),
            h(Explorer, { key: 'explorer', onClose }),
          ]),
        ),
        document.body,
      )
    }

    function SidebarEntry() {
      const [open, setOpen] = useState(false)
      return h(React.Fragment, null, [
        h(
          'button',
          {
            key: 'btn',
            className: 'dsh-mesh-entry',
            title: 'DSH Mesh 记忆',
            onClick: () => setOpen(true),
          },
          [h('span', { className: 'dot', key: 'd' }), h('span', { key: 't' }, '记忆')],
        ),
        open ? h(Overlay, { key: 'overlay', onClose: () => setOpen(false) }) : null,
      ])
    }

    function HeaderEntry() {
      const [open, setOpen] = useState(false)
      return h(React.Fragment, null, [
        h(
          'button',
          {
            key: 'btn',
            className: 'dsh-mesh-entry',
            title: 'DSH Mesh 记忆',
            onClick: () => setOpen(true),
          },
          [h('span', { className: 'dot', key: 'd' }), h('span', { key: 't' }, '记忆')],
        ),
        open ? h(Overlay, { key: 'overlay', onClose: () => setOpen(false) }) : null,
      ])
    }

    function ConversationView() {
      return h(Explorer, null)
    }

    function apply(ctx) {
      ensureStyle()
      const disposers = []
      disposers.push(
        ctx.slots.inject('conversation.view', () =>
          ctx.slots.register(
            { name: 'conversation.view', id: 'dsh-mesh-memory', order: 35, label: () => '记忆' },
            ConversationView,
          ),
        ),
      )
      disposers.push(
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register({ name: 'sidebar.footer.action', id: 'dsh-mesh-memory' }, SidebarEntry),
        ),
      )
      disposers.push(
        ctx.slots.inject('conversation.session.header.utilities', () =>
          ctx.slots.register(
            { name: 'conversation.session.header.utilities', id: 'dsh-mesh-memory-header' },
            HeaderEntry,
          ),
        ),
      )
      return () => {
        for (const dispose of disposers.reverse()) {
          try {
            dispose?.()
          } catch {}
        }
      }
    }

    return { apply, inject: ['slots'] }
  },
})
