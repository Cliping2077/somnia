// Browser half of dsh-plugin-sleep-memory.
//
// The sleep indicator is a `conversation.chat.turnTail` contribution: it lives
// in the transcript's tail, right before the completed Turn's actions row —
// the same position as the host's running status. It only renders
// on the latest Turn and only while the session has been idle long enough, so a
// new task immediately hands the seat back to the thinking line.
//
window.__ModuleLoader__.load({
  id: 'dsh-plugin-sleep-memory',
  factory(require) {
    const React = require('react')
    const { TextShimmer } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement

    const CSS = `
.mem_sleep{display:inline-flex;align-items:center;gap:6px;min-width:0;
  height:calc(28px + var(--dsh-content-font-delta,0px));
  font-family:inherit;
  font-size:calc(var(--dsh-content-font-size,14px) - 2px);
  line-height:calc(22px + var(--dsh-content-font-delta,0px));
  color:var(--dsw-alias-label-deep-diving);
  --dsw-alias-label-shimmer:var(--dsw-alias-label-deep-diving-shimmer);
  user-select:none;white-space:nowrap}
.mem_sleep_text{min-width:0;font-variant-numeric:tabular-nums}
.mem_sleep .mem_whale{width:calc(14px + var(--dsh-content-font-delta,0px));
  height:calc(14px + var(--dsh-content-font-delta,0px));flex:none;overflow:visible;
  transform-origin:35% 75%;animation:memWag 3.4s ease-in-out infinite}
.mem_zzz{position:relative;width:20px;height:14px;flex:none;margin-left:-2px;align-self:center;overflow:visible}
.mem_zzz i{position:absolute;left:0;font-style:italic;font-weight:600;line-height:1;
  animation:memRise 2.4s ease-in-out infinite;will-change:transform,opacity}
.mem_zzz i:nth-child(1){font-size:6px;left:0;bottom:0;animation-delay:0s}
.mem_zzz i:nth-child(2){font-size:6px;left:5px;bottom:3px;animation-delay:.3s}
.mem_zzz i:nth-child(3){font-size:7px;left:10px;bottom:6px;animation-delay:.6s}
@keyframes memWag{0%,100%{transform:rotate(0) translateY(0)}
  50%{transform:rotate(-6deg) translateY(-1px)}}
@keyframes memRise{
  0%{opacity:0;transform:translate(0,0)}
  25%{opacity:1}
  70%{opacity:.9}
  100%{opacity:0;transform:translate(3px,-3px)}}
@media(prefers-reduced-motion:reduce){
  .mem_sleep .mem_whale,.mem_zzz i{animation:none}}
`

    // Tail from Harness RunningWhaleTail, as used in the original Somnia adapter.
    const WHALE_TAIL = 'M8.844 13.742C8.967 12.328 8.45 10.4 8.45 9.65C8.45 8.94 8.88 8.43 9.6 8.43C11.285 8.43 12.106 8.281 12.685 8.104C13.71 7.791 14.585 6.768 15.055 5.945C15.137 5.803 14.99 5.641 14.829 5.671C13.829 5.86 12.828 5.376 11.827 4.978C10.659 4.514 9.491 4.707 8.935 4.876C8.805 4.915 8.658 4.819 8.636 4.686C8.468 3.643 7.405 2.615 5.498 2.238C4.54 2.048 3.748 1.574 3.347 1.202C3.252 1.113 3.088 1.125 3.03 1.242C2.628 2.059 2.168 3.82 5.248 6.115C5.82 6.494 6.31 6.785 6.574 7.637C6.72 8.104 6.157 9.168 6.061 9.368C5.157 11.27 5.089 12.19 4.926 13.742'

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

    function sleepLanguage() {
      // Harness keeps the root language in sync with its active UI locale.
      const language = window.document?.documentElement?.lang || window.navigator?.language
      return /^zh(?:-|$)/i.test(language) ? 'zh-CN' : 'en'
    }

    const ignoreLanguageChanges = () => () => {}

    function subscribeLanguage(listener) {
      const root = window.document?.documentElement
      if (!root || !window.MutationObserver) return () => {}
      const observer = new window.MutationObserver(listener)
      observer.observe(root, { attributes: true, attributeFilter: ['lang'] })
      return () => observer.disconnect()
    }

    function englishDuration(count, unit) {
      return `${count} ${unit}${count === 1 ? '' : 's'}`
    }

    function sleepLabel(ms, language) {
      const totalMinutes = Math.floor(ms / 60_000)
      const hours = Math.floor(totalMinutes / 60)
      const minutes = totalMinutes % 60
      if (language === 'zh-CN') {
        if (totalMinutes === 0) return 'deepseek 正在睡眠，刚睡着'
        if (hours === 0) return `deepseek 正在睡眠，已睡 ${minutes} 分钟`
        return `deepseek 正在睡眠，已睡 ${hours} 小时 ${minutes} 分钟`
      }

      const prefix = 'DeepSeek is sleeping · '
      if (totalMinutes === 0) return prefix + 'Just fell asleep'
      if (hours === 0) return prefix + englishDuration(minutes, 'minute')
      const elapsed = englishDuration(hours, 'hour')
      return prefix + (minutes === 0 ? elapsed : `${elapsed} ${englishDuration(minutes, 'minute')}`)
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
      const language = React.useSyncExternalStore(
        isLatest && running === false && sleeping ? subscribeLanguage : ignoreLanguageChanges,
        sleepLanguage,
      )

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
      const text = sleepLabel(elapsed, language)
      return h(
        React.Fragment,
        null,
        h('style', { key: 'style' }, CSS),
        h('div', { className: 'mem_sleep', role: 'status', 'aria-live': 'polite', lang: language },
          h('svg', { className: 'mem_whale', viewBox: '0 0 16 16', 'aria-hidden': 'true' },
            h('path', { d: WHALE_TAIL, stroke: 'currentColor', strokeWidth: 1.2, fill: 'none' })),
          h(TextShimmer, { active: true, className: 'mem_sleep_text' }, text),
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
