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
    const h = React.createElement

    const CSS = `
.mem_sleep{display:flex;align-items:center;gap:6px;height:28px;
  font-size:calc(var(--dsh-content-font-size,14px) - 2px);
  line-height:22px;color:var(--dsw-alias-label-deep-diving,#4C8DFF);
  font-variant-numeric:tabular-nums;
  --dsw-alias-label-shimmer:var(--dsw-alias-label-deep-diving-shimmer,#DCEBFF);
  user-select:none;white-space:nowrap}
.mem_sleep .mem_moon{position:relative;width:14px;height:14px;flex:none;
  animation:memFloat 3.4s ease-in-out infinite}
.mem_moon:before{content:"";position:absolute;inset:1px 1px 3px 3px;
  border-radius:50%;box-shadow:-2px 2px 0 1px currentColor}
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
@keyframes memFloat{0%,100%{transform:rotate(0) translateY(0)}
  50%{transform:rotate(-6deg) translateY(-1px)}}
@keyframes memShimmerSweep{0%{transform:translate(-100%)}66.6667%,to{transform:translate(100%)}}
@keyframes memShimmerHighlight{0%{transform:translate(100%)}66.6667%,to{transform:translate(-100%)}}
@keyframes memRise{
  0%{opacity:0;transform:translate(0,0)}
  25%{opacity:1}
  70%{opacity:.9}
  100%{opacity:0;transform:translate(3px,-3px)}}
@media(prefers-reduced-motion:reduce){
  .mem_sleep .mem_moon,.mem_zzz i{animation:none}
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
        if (totalMinutes === 0) return 'Somnia 正在睡眠，刚睡着'
        if (hours === 0) return `Somnia 正在睡眠，已睡 ${minutes} 分钟`
        return `Somnia 正在睡眠，已睡 ${hours} 小时 ${minutes} 分钟`
      }

      const prefix = 'Somnia is sleeping · '
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
          h('span', { className: 'mem_moon', key: 'moon', 'aria-hidden': 'true' }),
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
