/**
 * dsh-mesh — Client half（0.24.0）
 *
 * 入口只维护**一份前端**：`/dsh-mesh/app/`（Web 客户端，由 mm-serve 托管，插件加载时自动拉起）。
 * - `conversation.view`：整页内嵌 iframe（桌面与 DSH Go 里都是同一个页面）
 * - `sidebar.footer.action`：侧栏按钮，浮层里打开同一页面
 *
 * 旧的三页签 explorer（会话/记忆/备份）已在 0.24.0 删除：它和新客户端是两套 UI，
 * 数据与交互都不一致，属于"做好了但用不上"的重复实现。
 *
 * 宿主 API（同源，由 src/dashboard.js 反代到 mm-serve）：
 *   GET /dsh-mesh/api/health、/dsh-mesh/app/、其余 REST 由客户端自己发。
 */
window.__ModuleLoader__.load({
  id: 'dsh-mesh',

  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    let ReactDOM = null
    try {
      ReactDOM = require('react-dom')
    } catch {
      ReactDOM = null
    }
    const createPortal = typeof ReactDOM?.createPortal === 'function' ? ReactDOM.createPortal : (node) => node

    const STYLE_ID = 'dsh-mesh/client-styles'
    const APP_PATH = '/dsh-mesh/app/'
    const HEALTH_PATH = '/dsh-mesh/api/health'

    const CSS = [
      // conversation.view：撑满可用高度
      '.dsh-mesh-view{display:flex;flex-direction:column;min-height:0;height:100%;gap:0}',
      '.dsh-mesh-frame{flex:1;min-height:360px;width:100%;border:0;border-radius:12px;background:transparent;color-scheme:light dark}',
      // 连接中 / 离线兜底
      '.dsh-mesh-frame-loading,.dsh-mesh-frame-down{flex:1;min-height:320px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:24px;border:1px dashed var(--dsw-alias-border-secondary,#2b3850);border-radius:12px;color:var(--dsw-alias-label-secondary,#9aa6bd);font-size:13px;line-height:1.7}',
      '.dsh-mesh-frame-down strong{color:var(--dsw-alias-label-primary,#e7eaf0);font-size:14px}',
      '.dsh-mesh-frame-down code{font-size:12px;opacity:.85}',
      '.dsh-mesh-frame-actions{display:flex;gap:8px;margin-top:6px}',
      // 侧栏按钮
      '.dsh-mesh-entry{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-secondary,#2b3850);border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:12.5px;cursor:pointer;transition:background .15s ease,border-color .15s ease}',
      '.dsh-mesh-entry:hover{background:var(--dsw-alias-fill-secondary,rgba(255,255,255,.06));border-color:var(--dsw-alias-border-primary,#3d4e6c)}',
      '.dsh-mesh-entry .dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-accent-primary,#7c9cff)}',
      // 浮层
      '.dsh-mesh-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;background:rgba(0,0,0,.45);backdrop-filter:blur(2px)}',
      '.dsh-mesh-dialog{position:relative;display:flex;flex-direction:column;width:min(1180px,100%);height:min(86vh,920px);border:1px solid var(--dsw-alias-border-secondary,#1e2637);border-radius:14px;background:var(--dsw-alias-bg-primary,#0f1420);box-shadow:0 24px 70px rgba(0,0,0,.5);overflow:hidden}',
      '.dsh-mesh-dialog .dsh-mesh-frame{border-radius:0}',
      '.dsh-mesh-close{position:absolute;top:8px;right:10px;z-index:2;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-secondary,#2b3850);border-radius:8px;background:var(--dsw-alias-bg-primary,#0f1420);color:inherit;font-size:16px;line-height:1;cursor:pointer;opacity:.85}',
      '.dsh-mesh-close:hover{opacity:1}',
    ].join('\n')

    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }

    /**
     * 探测 serve 是否可用（同源 /dsh-mesh/api/health，由插件反代到 8767）。
     * 只用来决定显示 iframe 还是离线提示，不做重试循环里的错误提示。
     */
    function useServeState() {
      const [state, setState] = useState('checking')
      const [nonce, setNonce] = useState(0)
      const recheck = () => setNonce((value) => value + 1)

      useEffect(() => {
        let alive = true
        const check = () => {
          fetch(HEALTH_PATH, { cache: 'no-store' })
            .then((res) => {
              if (alive) setState(res.ok ? 'up' : 'down')
            })
            .catch(() => {
              if (alive) setState('down')
            })
        }
        check()
        const timer = setInterval(check, 20_000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [nonce])

      return [state, recheck]
    }

    function MemoryFrame() {
      const [state, recheck] = useServeState()
      const [frameKey, setFrameKey] = useState(0)

      if (state === 'checking') {
        return h('div', { className: 'dsh-mesh-frame-loading' }, '正在连接记忆服务…')
      }

      if (state === 'down') {
        return h('div', { className: 'dsh-mesh-frame-down' }, [
          h('strong', { key: 't' }, '记忆服务还没起来'),
          h('code', { key: 'c' }, 'http://127.0.0.1:8767 · /dsh-mesh/api/health'),
          h('span', { key: 'h' }, '插件会在加载时自动拉起；如果是刚装完，等两秒重试。'),
          h('div', { className: 'dsh-mesh-frame-actions', key: 'a' }, [
            h(
              'button',
              {
                key: 'retry',
                className: 'dsh-mesh-entry',
                onClick: () => {
                  recheck()
                  setFrameKey((value) => value + 1)
                },
              },
              '重试',
            ),
            h(
              'button',
              {
                key: 'open',
                className: 'dsh-mesh-entry',
                onClick: () => window.open(APP_PATH, '_blank', 'noopener'),
              },
              '新窗口打开',
            ),
          ]),
        ])
      }

      return h('iframe', {
        key: frameKey,
        className: 'dsh-mesh-frame',
        src: APP_PATH,
        title: 'mesh-memory',
        allow: 'clipboard-write',
      })
    }

    function ConversationView() {
      return h('div', { className: 'dsh-mesh-view' }, h(MemoryFrame, null))
    }

    function Overlay({ onClose }) {
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [onClose])

      return createPortal(
        h(
          'div',
          {
            className: 'dsh-mesh-overlay',
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) onClose()
            },
          },
          h('div', { className: 'dsh-mesh-dialog' }, [
            h('button', { key: 'x', className: 'dsh-mesh-close', onClick: onClose, title: '关闭' }, '×'),
            h(MemoryFrame, { key: 'frame' }),
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
          { key: 'btn', className: 'dsh-mesh-entry', title: '打开 mesh-memory', onClick: () => setOpen(true) },
          [h('span', { className: 'dot', key: 'd' }), h('span', { key: 't' }, '记忆')],
        ),
        open ? h(Overlay, { key: 'overlay', onClose: () => setOpen(false) }) : null,
      ])
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
