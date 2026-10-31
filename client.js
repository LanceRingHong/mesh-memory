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
      '.dsh-mesh-explorer{position:relative;display:flex;flex-direction:column;min-height:0;height:100%;color:var(--dsw-alias-label-primary,#e7eaf0);font-size:13px;line-height:1.55}',
      '.dsh-mesh-head{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;justify-content:space-between;padding:4px 2px 10px;flex:none}',
      '.dsh-mesh-title{font-size:18px;font-weight:700;margin:0}',
      '.dsh-mesh-sub{opacity:.62;font-size:11px;margin-top:3px;word-break:break-all}',
      '.dsh-mesh-btn{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:8px;padding:6px 10px;cursor:pointer;font:inherit}',
      '.dsh-mesh-btn:hover{border-color:var(--dsw-alias-brand-primary,#6ee7b7)}',
      '.dsh-mesh-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px;padding-bottom:10px;flex:none}',
      '.dsh-mesh-card{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));border-radius:10px;padding:8px 10px}',
      '.dsh-mesh-n{font-size:20px;font-weight:700;color:var(--dsw-alias-state-success-primary,#34d399)}',
      '.dsh-mesh-l{font-size:10px;opacity:.6;margin-top:1px}',
      '.dsh-mesh-toolbar{display:flex;gap:6px;padding-bottom:10px;flex:none}',
      '.dsh-mesh-input{flex:1;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:8px;padding:7px 9px;color:inherit;font:inherit;outline:none;min-width:0}',
      '.dsh-mesh-input:focus{border-color:var(--dsw-alias-brand-primary,#93c5fd)}',
      '.dsh-mesh-main{display:grid;grid-template-columns:minmax(220px,34%) 1fr;gap:10px;min-height:0;flex:1;overflow:hidden}',
      '@media(max-width:720px){.dsh-mesh-main{grid-template-columns:1fr;overflow:auto}.dsh-mesh-tree{max-height:40vh}.dsh-mesh-content{min-height:40vh}}',
      '.dsh-mesh-box{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:10px;padding:8px;min-height:0;overflow:auto}',
      '.dsh-mesh-tree{font-size:12px}',
      '.dsh-mesh-row{display:flex;align-items:center;gap:5px;padding:4px 6px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dsh-mesh-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.dsh-mesh-row.sel{background:var(--dsw-alias-interactive-bg-active,rgba(147,197,253,.18))}',
      '.dsh-mesh-row .caret{width:12px;flex:none;opacity:.65;font-size:10px}',
      '.dsh-mesh-row .nm{overflow:hidden;text-overflow:ellipsis}',
      '.dsh-mesh-row .sz{margin-left:auto;opacity:.45;font-size:10px;flex:none}',
      '.dsh-mesh-dir{font-weight:600}',
      '.dsh-mesh-empty{opacity:.55;font-size:11px;padding:8px 4px}',
      '.dsh-mesh-results{margin-top:8px;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));padding-top:8px}',
      '.dsh-mesh-result{padding:6px;border-radius:6px;cursor:pointer}',
      '.dsh-mesh-result:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.dsh-mesh-result .t{font-size:12px;font-weight:600}',
      '.dsh-mesh-result .p{font-size:10px;opacity:.55;word-break:break-all}',
      '.dsh-mesh-content{display:flex;flex-direction:column;min-height:0}',
      '.dsh-mesh-content-head{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:0 2px 6px;flex:none}',
      '.dsh-mesh-content-path{font-size:10px;opacity:.55;word-break:break-all}',
      '.dsh-mesh-pre{margin:0;background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.18));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:8px;padding:10px;white-space:pre-wrap;word-break:break-word;overflow:auto;flex:1;font:11px/1.5 ui-monospace,Consolas,monospace}',
      '.dsh-mesh-md{flex:1;overflow:auto;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:8px;padding:14px 18px;background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.18));line-height:1.7;font-size:13px;word-break:break-word}',
      '.dsh-mesh-md h1,.dsh-mesh-md h2,.dsh-mesh-md h3,.dsh-mesh-md h4,.dsh-mesh-md h5,.dsh-mesh-md h6{margin:1.1em 0 .45em;line-height:1.35}',
      '.dsh-mesh-md h1{font-size:22px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));padding-bottom:6px}',
      '.dsh-mesh-md h2{font-size:18px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16));padding-bottom:4px}',
      '.dsh-mesh-md h3{font-size:15px}.dsh-mesh-md h4{font-size:14px}',
      '.dsh-mesh-md p{margin:.45em 0}.dsh-mesh-md ul,.dsh-mesh-md ol{margin:.45em 0;padding-left:1.5em}',
      '.dsh-mesh-md li{margin:.18em 0}.dsh-mesh-md blockquote{margin:.6em 0;padding:.35em .9em;border-left:3px solid var(--dsw-alias-brand-primary,#6ee7b7);background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));border-radius:0 6px 6px 0;opacity:.9}',
      '.dsh-mesh-md code{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.15));border-radius:4px;padding:1px 5px;font:11px/1.5 ui-monospace,Consolas,monospace}',
      '.dsh-mesh-md pre{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.25));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:8px;padding:10px;overflow:auto}',
      '.dsh-mesh-md pre code{background:transparent;padding:0}',
      '.dsh-mesh-md a{color:var(--dsw-alias-brand-primary,#93c5fd);text-decoration:none}.dsh-mesh-md a:hover{text-decoration:underline}',
      '.dsh-mesh-md table{border-collapse:collapse;margin:.7em 0;font-size:12px;width:100%}',
      '.dsh-mesh-md th,.dsh-mesh-md td{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));padding:5px 8px;text-align:left;vertical-align:top}',
      '.dsh-mesh-md th{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1))}',
      '.dsh-mesh-md hr{border:0;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));margin:1em 0}',
      '.dsh-mesh-md del{opacity:.6}',
      '.dsh-mesh-err{color:var(--dsw-alias-state-error-primary,#fbbf24);font-size:11px;padding:4px 2px}',
      '.dsh-mesh-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:18px;box-sizing:border-box}',
      '.dsh-mesh-dialog{position:relative;width:min(1100px,96vw);height:min(760px,92vh);background:var(--dsw-alias-bg-layer-1,#171a21);border:1px solid var(--dsw-alias-border-l2,#2a303c);border-radius:16px;padding:16px;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden}',
      '.dsh-mesh-close{position:absolute;right:10px;top:8px;border:0;background:transparent;color:inherit;font-size:20px;cursor:pointer;opacity:.6;z-index:2}',
      '.dsh-mesh-close:hover{opacity:1}',
      '.dsh-mesh-entry{border:1px solid transparent;background:transparent;color:inherit;cursor:pointer;font:inherit;border-radius:8px;padding:5px 8px;display:inline-flex;align-items:center;gap:5px;min-width:0}',
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

      const openFile = async (p) => {
        // 只负责取内容；选中状态由 selectFile 管，避免 setSelected 触发的重复请求与竞态。
        const seq = requestSeq.current + 1
        requestSeq.current = seq
        setBusy(true)
        setError('')
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
        openFile(p)
      }

      const load = async () => {
        setBusy(true)
        setError('')
        try {
          const [s, t] = await Promise.all([api('/status'), api('/tree')])
          setStatus(s)
          setTree(t.root || [])
          setExpanded(new Set(['memory', 'memory/facts', 'memory/decisions', 'memory/projects', 'sessions', 'skills', 'index', '.mesh']))
        } catch (e) {
          setError(String(e?.message || e))
        } finally {
          setBusy(false)
        }
      }

      const requestSeq = useRef(0)

      useEffect(() => {
        ensureStyle()
        load()
        openFile('AGENTS.shared.md')
      }, [])

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

      const counts = status?.counts || {}
      const isMarkdown = /\.(md|markdown)$/i.test(selected)
      const previewHtml = useMemo(
        () => (isMarkdown && viewMode === 'preview' ? sanitizeHtml(renderMarkdown(content.slice(0, 100000))) : ''),
        [content, isMarkdown, viewMode],
      )

      return h('div', { className: 'dsh-mesh-explorer' }, [
        h('div', { className: 'dsh-mesh-head', key: 'head' }, [
          h('div', { key: 'title' }, [
            h('h2', { className: 'dsh-mesh-title', key: 't' }, 'DSH Mesh 记忆'),
            h(
              'div',
              { className: 'dsh-mesh-sub', key: 's' },
              status ? `${status.device || 'device'} · ${status.memoryDir || ''}` : '加载中…',
            ),
          ]),
          h(
            'div',
            { key: 'actions' },
            [h('button', { className: 'dsh-mesh-btn', key: 'r', onClick: load, disabled: busy }, busy ? '刷新中…' : '刷新')],
          ),
        ]),

        error ? h('div', { className: 'dsh-mesh-err', key: 'e' }, error) : null,

        h('div', { className: 'dsh-mesh-cards', key: 'cards' }, [
          Card('事实', counts.facts),
          Card('决策', counts.decisions),
          Card('项目', counts.projects),
          Card('笔记', counts.notes),
          Card('会话摘要', counts.sessions),
          Card('冲突', counts.conflicts),
        ]),

        h('div', { className: 'dsh-mesh-toolbar', key: 'toolbar' }, [
          h('input', {
            key: 'q',
            className: 'dsh-mesh-input',
            value: query,
            placeholder: '搜索全部共享记忆…',
            onChange: (e) => setQuery(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter') search()
            },
          }),
          h('button', { className: 'dsh-mesh-btn', key: 'go', onClick: search }, '搜索'),
        ]),

        h('div', { className: 'dsh-mesh-main', key: 'main' }, [
          h('div', { className: 'dsh-mesh-box dsh-mesh-tree', key: 'tree' }, [
            tree.length
              ? tree.map((node) =>
                  h(TreeNode, { key: node.path, node, depth: 0, expanded, toggle, open: selectFile, selected }),
                )
              : h('div', { className: 'dsh-mesh-empty' }, '正在读取共享目录…'),
            results
              ? h('div', { className: 'dsh-mesh-results', key: 'results' }, [
                  h('div', { className: 'dsh-mesh-l', key: 'h' }, `搜索结果 ${results.length} 条`),
                  ...results.map((row) =>
                    h(
                      'div',
                      { className: 'dsh-mesh-result', key: row.path, onClick: () => selectFile(row.path) },
                      [h('div', { className: 't', key: 't' }, row.path), h('div', { className: 'p', key: 'p' }, row.snippet)],
                    ),
                  ),
                ])
              : null,
          ]),
          h('div', { className: 'dsh-mesh-content', key: 'content' }, [
            h('div', { className: 'dsh-mesh-content-head', key: 'ch' }, [
              h('div', { className: 'dsh-mesh-content-path', key: 'p' }, selected || '选择左侧文件查看内容'),
              h('div', { className: 'dsh-mesh-l', key: 'f' }, busy ? '读取中…' : ''),
              isMarkdown
                ? h(
                    'button',
                    {
                      className: 'dsh-mesh-btn',
                      key: 'mode',
                      onClick: () => setViewMode((m) => (m === 'preview' ? 'raw' : 'preview')),
                    },
                    viewMode === 'preview' ? '源码' : '预览',
                  )
                : null,
            ]),
            isMarkdown && viewMode === 'preview'
              ? h('div', {
                  className: 'dsh-mesh-md',
                  key: 'md',
                  dangerouslySetInnerHTML: { __html: previewHtml || '<p>（空文件）</p>' },
                })
              : h('pre', { className: 'dsh-mesh-pre', key: 'pre' }, content || '选择左侧文件查看内容。'),
          ]),
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
