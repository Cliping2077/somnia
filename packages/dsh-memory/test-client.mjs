import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const TextShimmer = Symbol('Harness TextShimmer')

function fixture({ language = 'zh-CN', browserLanguage = 'en-US' } = {}) {
  const timers = new Map()
  const intervals = new Map()
  const status = new Map()
  let clock = 0
  let current
  let TurnTail
  const React = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props, children }),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useRef(initialValue) {
      const index = current.index++
      return current.slots[index] ??= { current: initialValue }
    },
    useState(initialValue) {
      const index = current.index++
      const state = current.slots[index] ??= { value: initialValue }
      return [state.value, (value) => { state.value = value }]
    },
    useEffect(effect, dependencies) {
      const frame = current
      const index = frame.index++
      const previous = frame.slots[index]
      if (previous?.dependencies.every((value, i) => value === dependencies[i])) return
      frame.effects.push(() => {
        previous?.cleanup?.()
        frame.slots[index] = { dependencies, cleanup: effect() }
      })
    },
  }
  runInNewContext(source, {
    Date: { now: () => clock },
    window: {
      document: { documentElement: { lang: language } },
      navigator: { language: browserLanguage },
      setTimeout(callback, delay) {
        const id = Symbol('timeout')
        timers.set(id, { at: clock + delay, callback })
        return id
      },
      clearTimeout: (id) => timers.delete(id),
      setInterval(callback, delay) {
        const id = Symbol('interval')
        intervals.set(id, { at: clock + delay, callback })
        return id
      },
      clearInterval: (id) => intervals.delete(id),
      __ModuleLoader__: {
        load({ factory }) {
          factory((name) => {
            if (name === 'react') return React
            assert.equal(name, '@deepseek-ai/dsh-client-ui-primitives')
            return { TextShimmer }
          }).apply({
            slots: {
              inject: (_slot, register) => register(),
              register: (_definition, component) => { TurnTail = component },
            },
          })
        },
      },
    },
  })
  const advance = (ms) => {
    clock += ms
    for (const [id, timer] of timers) {
      if (timer.at > clock) continue
      timers.delete(id)
      timer.callback()
    }
    for (const interval of intervals.values()) {
      if (interval.at <= clock) interval.callback()
    }
  }
  const turn = (sessionId, seq) => {
    const frame = { slots: [] }
    return {
      render(session = sessionId, sequence = seq) {
        current = frame
        frame.index = 0
        frame.effects = []
        const result = TurnTail({
          sessionId: session,
          seq: sequence,
          useSessionStatus: (select) => select(status),
        })
        for (const effect of frame.effects) effect()
        return result
      },
    }
  }
  return { status, advance, turn }
}

test('turn-tail status is scoped to the active turn within each session', () => {
  const { status, advance, turn } = fixture()
  status.set('one', { running: false })
  status.set('two', { running: false })
  const oldTurn = turn('one', 1)
  const newestInOne = turn('one', 2)
  const newestInTwo = turn('two', 50)
  for (const row of [oldTurn, newestInOne, newestInTwo]) row.render()
  for (const row of [oldTurn, newestInOne, newestInTwo]) row.render()
  advance(600_000)
  assert.equal(oldTurn.render(), null)
  assert.ok(newestInOne.render())
  assert.ok(newestInTwo.render())
})

test('a running task hides the sleep row on the first render', () => {
  const { status, advance, turn } = fixture()
  status.set('one', { running: false })
  const row = turn('one', 1)
  row.render()
  row.render()
  advance(600_000)
  assert.ok(row.render())
  status.set('one', { running: true })
  assert.equal(row.render(), null)
})

test('the sleep row uses the original whale and the host text shimmer', () => {
  const { status, advance, turn } = fixture()
  status.set('one', { running: false })
  const row = turn('one', 1)
  row.render()
  row.render()
  advance(600_000)

  const [style, sleepStatus] = row.render().children
  const [whale, label] = sleepStatus.children

  assert.equal(label.type, TextShimmer)
  assert.equal(label.props.active, true)
  assert.equal(label.children[0], 'deepseek 正在睡眠，刚睡着')
  assert.equal(sleepStatus.props.role, 'status')
  assert.equal(sleepStatus.props['aria-live'], 'polite')
  assert.equal(whale.type, 'svg')
  assert.equal(whale.props.viewBox, '0 0 16 16')
  assert.equal(whale.props['aria-hidden'], 'true')
  assert.match(whale.children[0].props.d, /^M8\.844 13\.742/)
  assert.match(style.children[0], /--dsw-alias-label-shimmer:var\(--dsw-alias-label-deep-diving-shimmer\)/)
  assert.match(style.children[0], /font-size:calc\(var\(--dsh-content-font-size,14px\) - 2px\)/)
  assert.match(style.children[0], /font-family:inherit/)
})

test('the English sleep row follows the Harness language and formats elapsed time', () => {
  const { status, advance, turn } = fixture({ language: 'en-GB', browserLanguage: 'zh-CN' })
  status.set('one', { running: false })
  const row = turn('one', 1)
  row.render()
  row.render()
  advance(600_000)

  const text = () => row.render().children[1].children[1].children[0]
  assert.equal(text(), 'DeepSeek is sleeping · Just fell asleep')
  advance(60_000)
  assert.equal(text(), 'DeepSeek is sleeping · 1 minute')
  advance(60 * 60_000)
  assert.equal(text(), 'DeepSeek is sleeping · 1 hour 1 minute')
})

test('the sleep row falls back to the browser language when the host omits it', () => {
  const { status, advance, turn } = fixture({ language: '', browserLanguage: 'en-US' })
  status.set('one', { running: false })
  const row = turn('one', 1)
  row.render()
  row.render()
  advance(600_000)

  const [, sleepStatus] = row.render().children
  const [, label] = sleepStatus.children
  assert.equal(label.children[0], 'DeepSeek is sleeping · Just fell asleep')
})
