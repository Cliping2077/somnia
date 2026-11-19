import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')

function fixture() {
  const timers = new Map()
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
      setTimeout(callback, delay) {
        const id = Symbol('timeout')
        timers.set(id, { at: clock + delay, callback })
        return id
      },
      clearTimeout: (id) => timers.delete(id),
      setInterval: () => Symbol('interval'),
      clearInterval() {},
      __ModuleLoader__: {
        load({ factory }) {
          factory(() => React).apply({
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
