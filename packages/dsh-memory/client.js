// Browser half of @local/dsh-memory.
//
// The sleep indicator is a `conversation.chat.turnTail` contribution: it lives
// in the transcript's tail, right before the completed Turn's actions row —
// the same seat the "深度求索中" status occupies while running. It only renders
// on the latest Turn and only while the session has been idle long enough, so a
// new task immediately hands the seat back to the thinking line.
//
// Art: a small brand-blue whale with a closed eye, a white belly and a
// nightcap. The official mark carries too much detail below ~40px, so this is a
// simplified sleeping version in the same silhouette and colour language.
window.__ModuleLoader__.load({
  id: '@local/dsh-memory',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const CSS = `
.mem_sleep{display:flex;align-items:center;gap:6px;height:28px;
  font-size:calc(var(--dsh-content-font-size,14px) - 2px);
  line-height:22px;color:var(--dsw-alias-label-deep-diving,#4C8DFF);
  font-variant-numeric:tabular-nums;
  --dsw-alias-label-shimmer:var(--dsw-alias-label-deep-diving-shimmer,#DCEBFF);
  user-select:none;white-space:nowrap}
.mem_sleep .mem_whale{width:14px;height:14px;flex:none;overflow:visible;
  transform-origin:35% 75%;animation:memWag 3.4s ease-in-out infinite}
.mem_shimmer{position:relative;display:inline-grid;width:max-content;max-width:100%;
  min-width:0;vertical-align:top;color:inherit}
.mem_shimmer_content{display:flex;align-items:center;min-width:0}
.mem_shimmer_text{color:inherit}
.mem_shimmer_text[data-shimmer-text]:after{content:attr(data-shimmer-text)}
.mem_shimmer_decoration{position:absolute;inset:0;overflow:clip;pointer-events:none;user-select:none}
.mem_shimmer_sweep{position:absolute;inset:0;overflow:hidden;
  color:var(--dsw-alias-label-shimmer);
  mask-image:linear-gradient(105deg,transparent 0%,black 40% 60%,transparent 100%);
  -webkit-mask-image:linear-gradient(105deg,transparent 0%,black 40% 60%,transparent 100%);
  transform:translate(-100%);
  animation:memShimmerSweep 1.5s steps(48,end) .3s infinite}
.mem_shimmer_highlight{width:100%;height:100%;transform:translate(100%);
  animation:memShimmerHighlight 1.5s steps(48,end) .3s infinite}
.mem_zzz{position:relative;width:20px;height:14px;flex:none;margin-left:-2px;align-self:center;overflow:visible}
.mem_zzz i{position:absolute;left:0;font-style:italic;font-weight:600;line-height:1;
  color:var(--dsw-alias-label-deep-diving,#4C8DFF);
  animation:memRise 2.4s ease-in-out infinite;will-change:transform,opacity}
.mem_zzz i:nth-child(1){font-size:6px;left:0;bottom:0;animation-delay:0s}
.mem_zzz i:nth-child(2){font-size:6px;left:5px;bottom:3px;animation-delay:.3s}
.mem_zzz i:nth-child(3){font-size:7px;left:10px;bottom:6px;animation-delay:.6s}
@keyframes memWag{0%,100%{transform:rotate(0) translateY(0)}
  50%{transform:rotate(-6deg) translateY(-1px)}}
@keyframes memShimmerSweep{0%{transform:translate(-100%)}66.6667%,to{transform:translate(100%)}}
@keyframes memShimmerHighlight{0%{transform:translate(100%)}66.6667%,to{transform:translate(-100%)}}
@keyframes memRise{
  0%{opacity:0;transform:translate(0,0)}
  25%{opacity:1}
  70%{opacity:.9}
  100%{opacity:0;transform:translate(3px,-3px)}}
@media(prefers-reduced-motion:reduce){
  .mem_sleep .mem_whale,.mem_zzz i{animation:none}
  .mem_shimmer_decoration{display:none}}
`

    const IDLE_MS = 10 * 60 * 1000

    // Closing sequence numbers are local to each conversation.
    const turnsBySession = new Map()
    const seqListeners = new Set()
    let instanceSeed = 0
    function notifySeq() {
      for (const listener of [...seqListeners]) {
        try { listener() } catch (error) { /* keep the rest alive */ }
      }
    }
    function trackSeq(sessionId, key, seq) {
      let turns = turnsBySession.get(sessionId)
      if (!turns) {
        turns = new Map()
        turnsBySession.set(sessionId, turns)
      }
      turns.set(key, seq)
      notifySeq()
    }
    function untrackSeq(sessionId, key) {
      const turns = turnsBySession.get(sessionId)
      if (!turns?.delete(key)) return
      if (turns.size === 0) turnsBySession.delete(sessionId)
      notifySeq()
    }
    function latestTurn(sessionId) {
      let latestKey = 0
      let latestSeq = -Infinity
      for (const [key, seq] of turnsBySession.get(sessionId) ?? []) {
        if (seq > latestSeq || (seq === latestSeq && key > latestKey)) {
          latestKey = key
          latestSeq = seq
        }
      }
      return latestKey
    }
    function subscribeSeq(listener) {
      seqListeners.add(listener)
      return () => seqListeners.delete(listener)
    }

    // Official DeepSeek running-whale tail, the same path the "深度求索中" line
    // uses as its fallback icon.
    const WHALE_TAIL = 'M8.844 13.742C8.967 12.328 8.45 10.4 8.45 9.65C8.45 8.94 8.88 8.43 9.6 8.43C11.285 8.43 12.106 8.281 12.685 8.104C13.71 7.791 14.585 6.768 15.055 5.945C15.137 5.803 14.99 5.641 14.829 5.671C13.829 5.86 12.828 5.376 11.827 4.978C10.659 4.514 9.491 4.707 8.935 4.876C8.805 4.915 8.658 4.819 8.636 4.686C8.468 3.643 7.405 2.615 5.498 2.238C4.54 2.048 3.748 1.574 3.347 1.202C3.252 1.113 3.088 1.125 3.03 1.242C2.628 2.059 2.168 3.82 5.248 6.115C5.82 6.494 6.31 6.785 6.574 7.637C6.72 8.104 6.157 9.168 6.061 9.368C5.157 11.27 5.089 12.19 4.926 13.742'

    function WhaleTail() {
      return h('svg', {
        className: 'mem_whale', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true',
      },
        h('path', {
          d: WHALE_TAIL, stroke: 'currentColor', strokeWidth: 1.2, fill: 'none',
        }),
      )
    }

    function formatSleep(ms) {
      const seconds = Math.floor(ms / 1000)
      if (seconds < 60) return '刚睡着'
      const minutes = Math.floor(seconds / 60)
      if (minutes < 60) return `已睡 ${minutes} 分钟`
      const hours = Math.floor(minutes / 60)
      return `已睡 ${hours} 小时 ${minutes % 60} 分钟`
    }

    function SleepRow(props) {
      const sessionId = props.sessionId
      const seq = props.seq
      const keyRef = React.useRef(0)
      if (keyRef.current === 0) keyRef.current = ++instanceSeed
      const key = keyRef.current

      React.useEffect(() => {
        if (sessionId === undefined || !Number.isFinite(seq)) return undefined
        trackSeq(sessionId, key, seq)
        return () => untrackSeq(sessionId, key)
      }, [sessionId, key, seq])

      const isLatest = React.useSyncExternalStore(subscribeSeq, () => latestTurn(sessionId) === key)
      const running = props.useSessionStatus((snapshot) => {
        const entry = sessionId === undefined ? undefined : snapshot.get(sessionId)
        return entry === undefined ? undefined : entry.running
      })
      const [sleep, setSleep] = React.useState(null)
      const [clock, setClock] = React.useState(0)
      const sleeping = sleep !== null && sleep.sessionId === sessionId && sleep.seq === seq

      React.useEffect(() => {
        setSleep(null)
        if (!isLatest || running !== false) return undefined
        const timer = window.setTimeout(() => {
          const startedAt = Date.now()
          setSleep({ sessionId, seq, startedAt })
          setClock(startedAt)
        }, IDLE_MS)
        return () => window.clearTimeout(timer)
      }, [isLatest, running, sessionId, seq])

      React.useEffect(() => {
        if (!isLatest || running !== false || !sleeping) return undefined
        const interval = window.setInterval(() => setClock(Date.now()), 30000)
        return () => window.clearInterval(interval)
      }, [isLatest, running, sleeping])

      if (!isLatest || running !== false || !sleeping) return null
      const elapsed = Math.max(0, clock - sleep.startedAt)
      const text = `deepseek 正在睡眠，${formatSleep(elapsed)}`
      return h(
        React.Fragment,
        null,
        h('style', { key: 'style' }, CSS),
        h('div', { className: 'mem_sleep', role: 'status', 'aria-live': 'polite' },
          h(WhaleTail, { key: 'whale' }),
          h('span', { className: 'mem_shimmer', key: 'text' },
            h('span', { className: 'mem_shimmer_content' },
              h('span', { className: 'mem_shimmer_text' }, text),
            ),
            h('span', { className: 'mem_shimmer_decoration', 'aria-hidden': 'true', inert: '' },
              h('span', { className: 'mem_shimmer_sweep' },
                h('span', { className: 'mem_shimmer_content mem_shimmer_highlight' },
                  h('span', { className: 'mem_shimmer_text', 'data-shimmer-text': text }),
                ),
              ),
            ),
          ),
          h('span', { className: 'mem_zzz', key: 'z', 'aria-hidden': 'true' },
            h('i', null, 'z'), h('i', null, 'z'), h('i', null, 'z'),
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail',
          id: 'memory-sleep',
          order: 0,
        }, SleepRow))
      },
    }
  },
})
