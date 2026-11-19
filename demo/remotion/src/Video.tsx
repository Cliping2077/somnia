import React, { createContext, useContext } from 'react'
import {
  AbsoluteFill,
  Audio,
  Easing,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/noto-serif-sc/400.css'
import '@fontsource/noto-serif-sc/600.css'
import '@fontsource/noto-serif-sc/700.css'
import { FISH_PATH } from './fish'

type Lang = 'zh' | 'en'
type Card = { k: string; text: string; bad?: boolean }
type Row = readonly [string, string]
type ReportRow = readonly [string, string, string]

const C = {
  bg: '#07090E',
  panel: 'rgba(255,255,255,.045)',
  card: 'rgba(255,255,255,.06)',
  ink: '#F2EBDD',
  cream: '#D8D2C4',
  muted: '#8B8577',
  line: 'rgba(255,255,255,.10)',
  blue: '#9CC0FF',
  gold: '#E7C88A',
  red: '#E08A72',
  badBg: 'rgba(224,120,100,.10)',
  badText: '#F0B4A4',
}
const sans = 'Inter, -apple-system, "Microsoft YaHei", sans-serif'
const serif = '"Noto Serif SC", "Songti SC", serif'
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

const T = {
  zh: {
    kicker: 'A 36-SECOND CONCEPT FILM',
    title1: '大多数 Agent 记忆',
    title2: '只会追加。',
    sub: '重复 · 矛盾 · 过时 · 永不遗忘',
    cardsTitle: '它记得越来越多',
    cards: [
      { k: 'PREF', text: '余额面板喜欢统一列表风' },
      { k: 'PREF', text: '余额面板要统一列表风', bad: true },
      { k: 'PLAN', text: '七月要去新加坡' },
      { k: 'FACT', text: '人在新加坡', bad: true },
      { k: 'PREF', text: '也许喜欢深色主题？', bad: true },
      { k: 'NOTE', text: '用户问过深色主题', bad: true },
      { k: 'PREF', text: '中文文案要统一' },
      { k: 'LESSON', text: '交付前自查位置与动效' },
      { k: 'PLAN', text: '七月要去新加坡', bad: true },
    ] as Card[],
    human1: '人不是这样记住的。',
    human2: '睡眠会回放、重写、遗忘。',
    humanSub: '不是保存一切，而是留下重要的。',
    user: '我不吃辣',
    assistant: '好的，我记住啦。',
    memoryChip: 'PREFERENCE · 不吃辣',
    chatCap: '它没有记下整段对话，只留下了这一句。',
    sleep: 'deepseek 正在睡眠，刚睡着',
    sleepCap: '没有新对话，也没有打扰。只是睡着了。',
    rewriteTitle: '梦会重写，而不是追加',
    before: [
      ['PREF', '余额面板喜欢统一列表风', true],
      ['PREF', '余额面板要统一列表风', false],
      ['PLAN', '七月要去新加坡', false],
      ['FACT', '人在新加坡', false],
      ['PREF', '也许喜欢深色主题？', false],
      ['PREF', '中文文案要统一', true],
      ['NOTE', '用户问过深色主题', false],
    ] as const,
    after: [
      ['PREF', '余额面板：统一列表风，行高一致'],
      ['PREF', '中文界面文案保持一致'],
      ['FACT', '2026 年 7 月去过新加坡'],
      ['LESSON', '交付前自查位置与动效'],
    ] as const,
    ftimePrefix: '时间修订：',
    ftimeOld: '七月要去新加坡',
    ftimeNew: '2026 年 7 月去过新加坡',
    reportTitle: 'Dream 2026-11-17',
    reportSub: 'episodes 24 → salient 7 · entries 1,284 → 6 · hypotheses 2',
    report: [
      ['1', '余额面板：统一列表风，行高一致', 'FOREGROUND'],
      ['2', '2026 年 7 月去过新加坡', 'TIME-SHIFTED'],
      ['3', '中文界面文案保持一致', 'FOREGROUND'],
      ['4', '用户可能仍在比对视觉排布', 'HYPOTHESIS'],
    ] as ReportRow[],
    endTagline: '让 AI 记住你。',
    endLine: '现在，好好睡一觉吧。',
    endSleep: 'deepseek 正在睡眠，已睡 10 分钟',
    endMeta: 'MIT · LOCAL · OPEN SOURCE',
    endUrl: 'github.com/Cliping2077/somnia',
    subs: [
      '记忆，不是越堆｜越好',
      '追加，只会让记忆｜变脏',
      '一句「不吃辣」，被｜留了下来',
      '人靠睡眠｜整理记忆',
      '模型，｜也一样',
      '重写、合并、｜遗忘',
      '留下重要的，其余｜忘掉',
      '',
    ],
  },
  en: {
    kicker: 'A 36-SECOND CONCEPT FILM',
    title1: 'Most agent memory',
    title2: 'only appends.',
    sub: 'duplicates · contradictions · stale · never forgotten',
    cardsTitle: 'It remembers more and more',
    cards: [
      { k: 'PREF', text: 'Balance panel prefers a unified list' },
      { k: 'PREF', text: 'Balance panel wants a unified list', bad: true },
      { k: 'PLAN', text: 'Going to Singapore in July' },
      { k: 'FACT', text: 'Currently in Singapore', bad: true },
      { k: 'PREF', text: 'Maybe likes dark theme?', bad: true },
      { k: 'NOTE', text: 'User asked about dark theme', bad: true },
      { k: 'PREF', text: 'Keep Chinese copy consistent' },
      { k: 'LESSON', text: 'Self-check layout and motion' },
      { k: 'PLAN', text: 'Going to Singapore in July', bad: true },
    ] as Card[],
    human1: 'We do not remember like this.',
    human2: 'Sleep replays, rewrites, forgets.',
    humanSub: 'Not keeping everything — keeping what matters.',
    user: "I don't eat spicy food",
    assistant: 'Got it — noted.',
    memoryChip: 'PREFERENCE · no spicy food',
    chatCap: 'It does not keep the whole chat — just this one line.',
    sleep: 'deepseek is sleeping, just fell asleep',
    sleepCap: 'No new conversation, no interruption. It just slept.',
    rewriteTitle: 'A dream rewrites, it does not append',
    before: [
      ['PREF', 'Prefers a unified list style', true],
      ['PREF', 'Wants a unified list style', false],
      ['PLAN', 'Going to Singapore in July', false],
      ['FACT', 'Currently in Singapore', false],
      ['PREF', 'Maybe likes dark theme?', false],
      ['PREF', 'Keep Chinese copy consistent', true],
      ['NOTE', 'Asked about dark theme', false],
    ] as const,
    after: [
      ['PREF', 'Balance panel: unified list, even rows'],
      ['PREF', 'Chinese UI copy stays consistent'],
      ['FACT', 'Visited Singapore in July 2026'],
      ['LESSON', 'Self-check layout and motion'],
    ] as const,
    ftimePrefix: 'Time-shifted: ',
    ftimeOld: 'Going to Singapore in July',
    ftimeNew: 'Visited Singapore in July 2026',
    reportTitle: 'Dream 2026-11-17',
    reportSub: 'episodes 24 → salient 7 · entries 1,284 → 6 · hypotheses 2',
    report: [
      ['1', 'Balance panel: unified list, even rows', 'FOREGROUND'],
      ['2', 'Visited Singapore in July 2026', 'TIME-SHIFTED'],
      ['3', 'Chinese UI copy stays consistent', 'FOREGROUND'],
      ['4', 'User may still compare visual layouts', 'HYPOTHESIS'],
    ] as ReportRow[],
    endTagline: 'Let AI remember you.',
    endLine: 'Now, get some sleep.',
    endSleep: 'deepseek is sleeping, 10 min',
    endMeta: 'MIT · LOCAL · OPEN SOURCE',
    endUrl: 'github.com/Cliping2077/somnia',
    subs: [
      'More memory is not ｜better memory',
      'Appending only makes it ｜dirtier',
      'One line — "no spicy food" — ｜is kept',
      'Humans sort memory ｜while asleep',
      'So does ｜the model',
      'Rewrite, merge, ｜forget',
      'Keep what matters. ｜Let the rest go',
      '',
    ],
  },
} as const

const LangContext = createContext<Lang>('zh')
const useT = () => T[useContext(LangContext)]

const enter = (frame: number, fps: number, delay = 0, stiffness = 180, damping = 20) =>
  spring({ frame: frame - delay, fps, config: { stiffness, damping, mass: 0.9 } })

const Shot: React.FC<{ children: React.ReactNode; seed?: number }> = ({ children, seed = 0 }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const seconds = frame / fps
  const breathe = Math.sin(seconds * 1.15 + seed) * 0.009
  const push = Math.min(seconds / 9, 1) * 0.025
  const x = Math.sin(seconds * 0.42 + seed) * 4
  const y = Math.cos(seconds * 0.33 + seed) * 3
  return (
    <AbsoluteFill
      style={{
        transform: `scale(${1.012 + push + breathe}) translate(${x}px, ${y}px)`,
        transformOrigin: '50% 55%',
      }}
    >
      {children}
    </AbsoluteFill>
  )
}

const track = (frame: number, points: Array<[number, number]>): number => {
  if (frame <= points[0][0]) return points[0][1]
  for (let i = 1; i < points.length; i += 1) {
    if (frame <= points[i][0]) {
      const [a, av] = points[i - 1]
      const [b, bv] = points[i]
      const t = (frame - a) / (b - a)
      const e = t * t * (3 - 2 * t)
      return av + (bv - av) * e
    }
  }
  return points[points.length - 1][1]
}

const Cursor: React.FC<{ path: Array<[number, number, number]>; clicks: number[] }> = ({ path, clicks }) => {  const frame = useCurrentFrame()
  const x = track(frame, path.map((p) => [p[0], p[1]] as [number, number]))
  const y = track(frame, path.map((p) => [p[0], p[2]] as [number, number]))
  return (
    <div style={{ position: 'absolute', left: x, top: y, zIndex: 20, pointerEvents: 'none' }}>
      <svg width={26} height={26} viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.55))' }}>
        <path d="M5 3l14 9-6.2 1.6L9.6 21z" fill="#fff" stroke="#0B0E14" strokeWidth={1.2} strokeLinejoin="round" />
      </svg>
      {clicks.map((c, i) => {
        const p = (frame - c) / 9
        if (p < 0 || p > 1) return null
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: -16,
              top: -16,
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: '2px solid rgba(231,200,138,.9)',
              transform: `scale(${0.3 + p * 1.4})`,
              opacity: 1 - p,
            }}
          />
        )
      })}
    </div>
  )
}

const rnd = (i: number) => {
  const v = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return v - Math.floor(v)
}

const Backdrop: React.FC = () => {
  const frame = useCurrentFrame()
  const t = frame / 30
  const drift = Math.sin(t * 0.35) * 50
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1200px 760px at 50% 10%, #1B2231 0%, #0D121C 52%, #080B12 100%)`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: 900,
          height: 900,
          left: -260 + drift,
          top: -420,
          background: 'radial-gradient(circle, rgba(231,200,138,.19), transparent 62%)',
          filter: 'blur(30px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 800,
          height: 800,
          right: -240 - drift,
          bottom: -380,
          background: 'radial-gradient(circle, rgba(120,160,255,.15), transparent 64%)',
          filter: 'blur(34px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 620,
          height: 620,
          left: 40,
          top: 230,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,196,120,.10), transparent 66%)',
          filter: 'blur(26px)',
        }}
      />
      <div style={{ position: 'absolute', inset: 0 }}>
        {Array.from({ length: 44 }, (_, i) => {
          const x = rnd(i) * 1280
          const y = rnd(i + 50) * 720
          const r = 0.6 + rnd(i + 9) * 1.5
          const ph = rnd(i + 3) * Math.PI * 2
          const a = 0.05 + rnd(i + 11) * 0.16
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: x + Math.sin(t * 0.5 + ph) * 10,
                top: y + Math.cos(t * 0.4 + ph) * 8,
                width: r * 2,
                height: r * 2,
                borderRadius: '50%',
                background: 'rgba(231,200,138,.9)',
                opacity: a,
              }}
            />
          )
        })}
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.2,
          backgroundImage: 'radial-gradient(rgba(255,255,255,.10) 1px, transparent 1px)',
          backgroundSize: '30px 30px',
          maskImage: 'radial-gradient(76% 66% at 50% 50%, black, transparent)',
          WebkitMaskImage: 'radial-gradient(76% 66% at 50% 50%, black, transparent)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(120% 90% at 50% 45%, transparent 44%, rgba(0,0,0,.42) 82%, rgba(0,0,0,.68) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 200,
          background: 'linear-gradient(to top, rgba(0,0,0,.62), transparent)',
        }}
      />
    </AbsoluteFill>
  )
}

const Progress: React.FC = () => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        bottom: 0,
        height: 2,
        width: `${(frame / durationInFrames) * 100}%`,
        background: C.gold,
        opacity: 0.65,
      }}
    />
  )
}

const Subtitles: React.FC = () => {
  const t = useT()
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const windows: Array<[number, number]> = [
    [0, 90],
    [90, 240],
    [240, 360],
    [360, 450],
    [450, 600],
    [600, 780],
    [780, 930],
    [930, 1080],
  ]
  const index = windows.findIndex(([from, to]) => frame >= from && frame < to)
  const text = index >= 0 ? t.subs[index] : ''
  if (!text) return null
  const [from, to] = windows[index]
  const opacity = interpolate(frame, [from, from + 10, to - 10, to], [0, 1, 1, 0], clamp)
  const parts = text.split('｜')
  let k = 0
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 76,
        textAlign: 'center',
        fontFamily: serif,
        fontSize: 32,
        fontWeight: 500,
        lineHeight: 1.35,
        letterSpacing: '.06em',
        color: '#F2EBDD',
        textShadow: '0 4px 26px rgba(0,0,0,.85)',
        opacity,
      }}
    >
      {parts.map((part, pi) => (
        <span key={pi} style={{ color: pi === 0 ? '#F2EBDD' : C.gold }}>
          {Array.from(part).map((ch, i) => {
            const p = spring({
              frame: frame - (from + 8 + k * 1.6),
              fps,
              config: { damping: 26, stiffness: 190, mass: 0.6 },
            })
            k += 1
            return (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  whiteSpace: 'pre',
                  opacity: Math.max(0, p),
                  transform: `translateY(${(1 - p) * 14}px)`,
                }}
              >
                {ch}
              </span>
            )
          })}
        </span>
      ))}
    </div>
  )
}

const Header: React.FC = () => (
  <>
    <div
      style={{
        position: 'absolute',
        top: 22,
        left: 28,
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        fontSize: 12,
        color: C.muted,
        fontFamily: sans,
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: C.gold,
          color: '#20180A',
          display: 'grid',
          placeItems: 'center',
          fontSize: 9,
          fontWeight: 700,
        }}
      >
        s
      </span>
      <b style={{ color: C.ink }}>Somnia</b>
      <span>for DeepSeek Harness</span>
    </div>
    <div
      style={{
        position: 'absolute',
        top: 22,
        right: 28,
        fontSize: 10,
        letterSpacing: '.2em',
        color: 'rgba(255,255,255,.28)',
        fontFamily: sans,
      }}
    >
      CONCEPT FILM
    </div>
  </>
)

const Flash: React.FC = () => {
  const frame = useCurrentFrame()
  const opacity = interpolate(frame, [0, 1, 5], [0.28, 0.28, 0], clamp)
  return <AbsoluteFill style={{ background: C.gold, opacity, pointerEvents: 'none' }} />
}

const Whale: React.FC<{ size: number; rotate?: number }> = ({ size, rotate = 0 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    style={{ overflow: 'visible', flex: 'none', transform: `rotate(${rotate}deg)`, transformOrigin: '35% 75%' }}
  >
    <path
      d="M8.844 13.742C8.967 12.328 8.45 10.4 8.45 9.65C8.45 8.94 8.88 8.43 9.6 8.43C11.285 8.43 12.106 8.281 12.685 8.104C13.71 7.791 14.585 6.768 15.055 5.945C15.137 5.803 14.99 5.641 14.829 5.671C13.829 5.86 12.828 5.376 11.827 4.978C10.659 4.514 9.491 4.707 8.935 4.876C8.805 4.915 8.658 4.819 8.636 4.686C8.468 3.643 7.405 2.615 5.498 2.238C4.54 2.048 3.748 1.574 3.347 1.202C3.252 1.113 3.088 1.125 3.03 1.242C2.628 2.059 2.168 3.82 5.248 6.115C5.82 6.494 6.31 6.785 6.574 7.637C6.72 8.104 6.157 9.168 6.061 9.368C5.157 11.27 5.089 12.19 4.926 13.742"
      stroke="currentColor"
      strokeWidth={1.2}
    />
  </svg>
)

const SceneTitle: React.FC = () => {
  const t = useT()
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const a = enter(frame, fps, 0, 150, 22)
  const b = enter(frame, fps, 15, 150, 22)
  const c = enter(frame, fps, 30, 120, 24)
  const rule = interpolate(frame, [30, 55], [0, 200], clamp)
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div style={{ fontSize: 11, letterSpacing: '.34em', color: C.gold, fontFamily: sans, marginBottom: 24, opacity: c }}>
        {t.kicker}
      </div>
      <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 82, lineHeight: 1.22, letterSpacing: '-0.02em', color: C.ink }}>
        <div style={{ opacity: a, transform: `translateY(${(1 - a) * 40}px)` }}>{t.title1}</div>
        <div
          style={{
            opacity: b,
            transform: `translateY(${(1 - b) * 40}px)`,
            background: `linear-gradient(90deg, ${C.gold} 0%, #FBF1D8 50%, ${C.gold} 100%)`,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          {t.title2}
        </div>
      </div>
      <div style={{ marginTop: 24, fontSize: 14, color: C.muted, letterSpacing: '.18em', opacity: c }}>{t.sub}</div>
      <div style={{ height: 2, width: rule, background: C.gold, marginTop: 30, opacity: 0.8 }} />
    </AbsoluteFill>
  )
}

const SceneCards: React.FC = () => {
  const t = useT()
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const count = Math.floor(interpolate(frame, [0, 140], [0, 1284], { ...clamp, easing: Easing.out(Easing.cubic) }))
  const zoom = interpolate(frame, [110, 150], [1, 1.05], clamp)
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', top: 58, left: 90, right: 90, display: 'flex', alignItems: 'baseline' }}>
        <div style={{ fontSize: 22, fontWeight: 600, fontFamily: sans, color: C.ink }}>{t.cardsTitle}</div>
        <div
          style={{
            marginLeft: 'auto',
            fontSize: 44,
            fontWeight: 800,
            color: C.gold,
            letterSpacing: '-0.03em',
            fontVariantNumeric: 'tabular-nums',
            fontFamily: sans,
          }}
        >
          {count.toLocaleString('en-US')}
          <span style={{ fontSize: 10, letterSpacing: '.2em', color: C.muted, marginLeft: 8 }}>ENTRIES</span>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 820,
          height: 420,
          transform: `translate(-50%, -50%) scale(${zoom})`,
          perspective: 1000,
        }}
      >
        {t.cards.map((card, i) => {
          const s = enter(frame, fps, 8 + i * 5.4, 180, 18)
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: i * 44,
                left: 0,
                width: '100%',
                padding: '13px 20px',
                borderRadius: 10,
                background: card.bad ? 'rgba(64,48,20,.78)' : 'rgba(21,25,34,.96)',
                border: `1px solid ${card.bad ? 'rgba(231,200,138,.55)' : 'rgba(231,200,138,.14)'}`,
                boxShadow: '0 16px 34px rgba(0,0,0,.35)',
                fontFamily: 'ui-monospace, Consolas, monospace',
                fontSize: 13,
                color: card.bad ? '#F2D9A4' : '#EFE8DA',
                opacity: s,
                transform: `translateY(${(1 - s) * 50}px) rotate(${(1 - s) * -2}deg)`,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              <span style={{ color: card.bad ? '#E7C88A' : C.gold, fontSize: 9.5, letterSpacing: '.14em', marginRight: 12 }}>
                {card.k}
              </span>
              {card.text}
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

const Typewriter: React.FC<{ text: string; start: number; end: number }> = ({ text, start, end }) => {
  const frame = useCurrentFrame()
  const progress = Math.max(0, Math.min(1, (frame - start) / Math.max(1, end - start)))
  const n = Math.floor(progress * text.length)
  const typing = frame >= start && frame <= end
  const caretOn = typing && Math.floor(frame / 6) % 2 === 0
  return (
    <span>
      {text.slice(0, n)}
      {caretOn ? <span style={{ opacity: 0.75 }}>▍</span> : null}
    </span>
  )
}

const SceneChat: React.FC = () => {
  const t = useT()
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const user = enter(frame, fps, 6, 170, 20)
  const assistant = enter(frame, fps, 46, 170, 20)
  const chip = enter(frame, fps, 92, 220, 14)
  const cap = enter(frame, fps, 98, 120, 24)
  const typing = frame >= 30 && frame < 48
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 780, display: 'flex', flexDirection: 'column', gap: 14, fontFamily: sans }}>
        <div
          style={{
            alignSelf: 'flex-end',
            maxWidth: 460,
            padding: '14px 20px',
            borderRadius: '18px 18px 5px 18px',
            background: 'rgba(156,192,255,.14)',
            border: '1px solid rgba(156,192,255,.22)',
            color: C.ink,
            fontSize: 21,
            opacity: user,
            transform: `translateY(${(1 - user) * 22}px)`,
          }}
        >
          <Typewriter text={t.user} start={6} end={28} />
          <span style={{ fontSize: 15, opacity: 0.5, marginLeft: 6 }}>↵</span>
        </div>
        <div style={{ alignSelf: 'flex-start', display: 'flex', gap: 10, alignItems: 'flex-end', opacity: assistant }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'rgba(231,200,138,.14)',
              border: '1px solid rgba(231,200,138,.4)',
              display: 'grid',
              placeItems: 'center',
              flex: 'none',
            }}
          >
            <svg width={28} height={21} viewBox="0 0 23.16 17.04" fill="none">
              <path d={FISH_PATH} fill={C.gold} />
            </svg>
          </div>
          <div
            style={{
              maxWidth: 540,
              padding: '14px 20px',
              borderRadius: '18px 18px 18px 5px',
              background: C.panel,
              border: `1px solid ${C.line}`,
              color: C.cream,
              fontSize: 21,
            }}
          >
            <Typewriter text={t.assistant} start={52} end={88} />
          </div>
        </div>
        {typing ? (          <div style={{ alignSelf: 'flex-start', marginLeft: 44, color: C.muted, fontSize: 20, letterSpacing: '.24em' }}>
            ···
          </div>
        ) : null}
        <div
          style={{
            alignSelf: 'center',
            marginTop: 14,
            padding: '9px 18px',
            borderRadius: 999,
            border: '1px solid rgba(231,200,138,.35)',
            background: 'rgba(231,200,138,.08)',
            color: C.gold,
            fontSize: 12,
            letterSpacing: '.12em',
            opacity: chip,
            transform: `scale(${0.9 + 0.1 * chip})`,
          }}
        >
          ✦ {t.memoryChip}
        </div>
      </div>
    </AbsoluteFill>
  )
}

const SceneHuman: React.FC = () => {
  const t = useT()
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const a = enter(frame, fps, 0, 140, 18)
  const b = enter(frame, fps, 18, 140, 22)
  const c = enter(frame, fps, 36, 120, 24)
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div
        style={{
          fontFamily: serif,
          fontSize: 74,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          color: C.ink,
          opacity: a,
          transform: `translateY(${(1 - a) * 30}px)`,
        }}
      >
        {t.human1}
      </div>
      <div
        style={{
          marginTop: 30,
          fontFamily: serif,
          fontSize: 40,
          fontWeight: 500,
          color: C.gold,
          opacity: b,
          transform: `translateY(${(1 - b) * 24}px)`,
        }}
      >
        {t.human2}
      </div>
      <div style={{ marginTop: 30, fontSize: 14, color: C.muted, letterSpacing: '.18em', opacity: c }}>{t.humanSub}</div>
    </AbsoluteFill>
  )
}

const PHASES = ['replay', 'rewrite', 'downscale', 'glymph']
const PHASE_AT = [6, 21, 36, 51]

const SceneSleep: React.FC = () => {
  const t = useT()
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const s = enter(frame, fps, 0, 160, 20)
  const caption = enter(frame, fps, 14, 120, 24)
  const rawBand = interpolate(frame % 45, [0, 45], [-12, 112])
  const band = Math.max(0, Math.min(100, rawBand))
  const bandLeft = Math.max(0, band - 8)
  const bandRight = Math.min(100, band + 8)
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div
        style={{
          position: 'absolute',
          width: 760,
          height: 760,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(120,160,255,.12), transparent 62%)',
          filter: 'blur(20px)',
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          color: '#C9DCFF',
          fontSize: 36,
          fontWeight: 600,
          fontFamily: sans,
          fontVariantNumeric: 'tabular-nums',
          opacity: s,
          transform: `scale(${0.95 + 0.05 * s})`,
          whiteSpace: 'nowrap',
          textShadow: '0 0 28px rgba(140,180,255,.35)',
        }}
      >
        <Whale size={32} rotate={Math.sin(frame / 12) * 5} />
        <span style={{ position: 'relative', display: 'inline-block' }}>
          <span>{t.sleep}</span>
          <span
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              color: '#EAF2FF',
              maskImage: `linear-gradient(90deg, transparent ${bandLeft}%, white ${band}%, transparent ${bandRight}%)`,
              WebkitMaskImage: `linear-gradient(90deg, transparent ${bandLeft}%, white ${band}%, transparent ${bandRight}%)`,
              pointerEvents: 'none',
            }}
          >
            {t.sleep}
          </span>
        </span>
        <span style={{ position: 'relative', width: 44, height: 28, display: 'inline-block' }}>
          {[0, 1, 2].map((i) => {
            const phase = (frame - i * 9) / 9
            return (
              <i
                key={i}
                style={{
                  position: 'absolute',
                  left: i * 11,
                  bottom: i * 5,
                  fontSize: 13 + i,
                  fontStyle: 'italic',
                  fontWeight: 600,
                  lineHeight: 1,
                  color: C.blue,
                  opacity: 0.45 + 0.45 * Math.max(0, Math.sin(phase + 1)),
                  transform: `translateY(${Math.sin(phase) * 2}px)`,
                }}
              >
                z
              </i>
            )
          })}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 44 }}>
        {PHASES.map((p, i) => {
          const on = frame >= PHASE_AT[i]
          return (
            <div
              key={p}
              style={{
                padding: '8px 16px',
                border: `1px solid ${on ? 'rgba(156,192,255,.45)' : C.line}`,
                borderRadius: 999,
                background: on ? 'rgba(156,192,255,.08)' : 'transparent',
                fontSize: 11,
                letterSpacing: '.14em',
                textTransform: 'uppercase',
                color: on ? '#C9DCFF' : 'rgba(255,255,255,.38)',
                boxShadow: on ? '0 8px 22px rgba(120,160,255,.12)' : 'none',
                transform: `translateY(${on ? -2 : 0}px)`,
                fontFamily: sans,
              }}
            >
              {p}
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

const Panel: React.FC<{ title: string; rows: readonly Row[]; before?: boolean }> = ({ title, rows, before }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return (
    <div
      style={{
        padding: '20px 22px',
        borderRadius: 12,
        background: 'rgba(17,21,29,.9)',
        border: '1px solid rgba(231,200,138,.16)',
        fontFamily: sans,
        overflow: 'hidden',
      }}
    >
      <div style={{ marginBottom: 12, fontSize: 10, letterSpacing: '.26em', color: C.muted, fontWeight: 600 }}>{title}</div>
      {rows.map(([k, text], i) => {
        const s = enter(frame, fps, 8 + i * 7, 160, 20)
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'baseline',
              padding: '8px 0',
              fontSize: 13.5,
              color: before ? (i === 0 || i === 5 ? C.cream : C.muted) : C.cream,
              textDecoration: before && !(i === 0 || i === 5) ? 'line-through' : 'none',
              textDecorationColor: 'rgba(231,200,138,.35)',
              opacity: s,
              transform: `translateX(${(1 - s) * -8}px)`,
            }}
          >
            <span style={{ width: 52, flex: 'none', fontSize: 9, letterSpacing: '.14em', color: C.gold }}>{k}</span>
            {text}
          </div>
        )
      })}
    </div>
  )
}

const SceneRewrite: React.FC = () => {
  const t = useT()
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ftime = enter(frame, fps, 90, 160, 20)
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', top: 58, left: 90, right: 90, display: 'flex', alignItems: 'baseline' }}>
        <div style={{ fontSize: 22, fontWeight: 600, fontFamily: sans, color: C.ink }}>{t.rewriteTitle}</div>
        <div style={{ marginLeft: 'auto', fontSize: 30, fontWeight: 800, color: C.gold, letterSpacing: '-0.02em', fontFamily: sans }}>
          1,284 → 6
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 90,
          right: 90,
          top: 140,
          bottom: 150,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 36,
        }}
      >
        <Panel title="BEFORE" rows={t.before} before />
        <Panel title="AFTER" rows={t.after} />
      </div>
    </AbsoluteFill>
  )
}

const SceneReport: React.FC = () => {
  const t = useT()
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const card = enter(frame, fps, 0, 160, 20)
  const coin = enter(frame, fps, 90, 220, 12)
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          width: 760,
          padding: '28px 32px',
          borderRadius: 14,
          background: 'rgba(13,17,24,.97)',
          border: '1px solid rgba(231,200,138,.2)',
          boxShadow: '0 30px 80px rgba(0,0,0,.55)',
          position: 'relative',
          opacity: card,
          transform: `translateY(${(1 - card) * 30}px) scale(${0.97 + 0.03 * card})`,
          fontFamily: sans,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: C.ink }}>{t.reportTitle}</div>
          <div style={{ marginLeft: 'auto', fontSize: 9, letterSpacing: '.22em', color: C.gold, fontWeight: 700 }}>ENGINE · MODEL</div>
        </div>
        <div style={{ margin: '6px 0 16px', fontSize: 11, color: C.muted, letterSpacing: '.06em' }}>{t.reportSub}</div>
        {t.report.map(([n, text, tag], i) => {
          const s = enter(frame, fps, 6 + i * 5, 170, 20)
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'baseline',
                padding: '9px 0',
                borderTop: '1px solid rgba(255,255,255,.07)',
                fontSize: 13.5,
                color: '#EFE8DA',
                opacity: s,
                transform: `translateX(${(1 - s) * -6}px)`,
              }}
            >
              <span style={{ width: 18, color: C.gold, fontWeight: 800, fontSize: 12 }}>{n}</span>
              {text}
              <span style={{ marginLeft: 'auto', fontSize: 9, letterSpacing: '.14em', color: '#9A9485' }}>{tag}</span>
            </div>
          )
        })}
        <div
          style={{
            position: 'absolute',
            right: -40,
            bottom: -44,
            width: 88,
            height: 88,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 30%, #FBF1D8, #E7C88A 48%, #9A7434 100%)',
            boxShadow: '0 14px 34px rgba(231,200,138,.32)',
            display: 'grid',
            placeItems: 'center',
            color: '#4A3512',
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: '.1em',
            transform: `scale(${coin})`,
          }}
        >
          SNAPSHOT
        </div>
      </div>
    </AbsoluteFill>
  )
}

const SceneEnd: React.FC = () => {
  const t = useT()
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const mark = enter(frame, fps, 0, 160, 22)
  const tag = enter(frame, fps, 10, 140, 24)
  const line = enter(frame, fps, 24, 130, 20)
  const sleep = enter(frame, fps, 40, 150, 22)
  const meta = enter(frame, fps, 54, 150, 24)
  const fade = interpolate(frame, [110, 150], [0, 1], clamp)
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div
        style={{
          fontFamily: serif,
          fontSize: 64,
          fontWeight: 700,
          letterSpacing: '-0.04em',
          color: C.ink,
          opacity: mark,
          transform: `translateY(${(1 - mark) * 20}px)`,
        }}
      >
        Som<span style={{ color: C.gold }}>nia</span>
      </div>
      <div style={{ marginTop: 14, fontSize: 13, color: C.muted, letterSpacing: '.22em', opacity: tag }}>{t.endTagline}</div>
      <div
        style={{
          marginTop: 26,
          fontFamily: serif,
          fontSize: 46,
          fontWeight: 600,
          color: C.gold,
          opacity: line,
          transform: `translateY(${(1 - line) * 18}px)`,
          textShadow: '0 0 40px rgba(231,200,138,.18)',
        }}
      >
        {t.endLine}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 30,
          color: C.blue,
          fontSize: 20,
          fontWeight: 500,
          fontFamily: sans,
          opacity: sleep,
        }}
      >
        <Whale size={22} rotate={Math.sin(frame / 12) * 5} />
        <span>{t.endSleep}</span>
        <span style={{ display: 'inline-flex', gap: 2, fontSize: 12, fontStyle: 'italic', opacity: 0.8 }}>
          <i>z</i>
          <i>z</i>
          <i>z</i>
        </span>
      </div>
      <div style={{ marginTop: 22, fontSize: 10, color: C.muted, letterSpacing: '.2em', opacity: meta, fontFamily: sans }}>
        {t.endMeta}
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: C.gold, opacity: meta, fontFamily: sans }}>{t.endUrl}</div>
      <AbsoluteFill style={{ background: '#000', opacity: fade, pointerEvents: 'none' }} />
    </AbsoluteFill>
  )
}

export const Video: React.FC<{ lang: Lang }> = ({ lang }) => {
  return (
    <LangContext.Provider value={lang}>
      <AbsoluteFill style={{ background: C.bg, fontFamily: sans, overflow: 'hidden' }}>
        <Backdrop />
        <Audio src={staticFile('soundtrack.wav')} />

        <Sequence from={0} durationInFrames={90}>
          <Shot seed={1}>
            <SceneTitle />
          </Shot>
          <Flash />
        </Sequence>
        <Sequence from={90} durationInFrames={150}>
          <Shot seed={2}>
            <SceneCards />
          </Shot>
          <Flash />
        </Sequence>
        <Sequence from={240} durationInFrames={120}>
          <Shot seed={22}>
            <SceneChat />
          </Shot>
          <Flash />
        </Sequence>
        <Sequence from={360} durationInFrames={90}>
          <Shot seed={3}>
            <SceneHuman />
          </Shot>
          <Flash />
        </Sequence>
        <Sequence from={450} durationInFrames={150}>
          <Shot seed={4}>
            <SceneSleep />
          </Shot>
          <Flash />
        </Sequence>
        <Sequence from={600} durationInFrames={180}>
          <Shot seed={5}>
            <SceneRewrite />
          </Shot>
          <Flash />
        </Sequence>
        <Sequence from={780} durationInFrames={150}>
          <Shot seed={6}>
            <SceneReport />
          </Shot>
          <Flash />
        </Sequence>
        <Sequence from={930} durationInFrames={150}>
          <Shot seed={7}>
            <SceneEnd />
          </Shot>
        </Sequence>

        <Header />
        <Subtitles />
      </AbsoluteFill>
    </LangContext.Provider>
  )
}
