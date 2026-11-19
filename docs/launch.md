# Launch notes

A repository does not promote itself. This is the plan we would run for
`sleep-memory`, written down so it can be executed or handed to someone else.

## Positioning

**One line:** *Most agent memory is append-only. This one sleeps on it.*

**Category:** agent memory / long-term memory / "dreaming" for LLM agents.

**Audience, in order:**

1. People building agents who are frustrated by append-only memory.
2. DSH users (try it immediately, one command).
3. People who saw OpenAI's Dreaming announcement and want an open version.
4. Researchers/curious readers of sleep science.

**Proof points that make it credible:**

- a 30-second before/after: a stale/contradictory memory store becomes a short,
  current summary after one nap;
- a dream report with kept / background / hypotheses;
- a snapshot/restore demo;
- the sleep indicator (the emotional hook).

## Assets to produce before posting

| Asset | Why |
| --- | --- |
| 30–45s screen recording | the single most important asset |
| 3 screenshots | hero, dream report, restore |
| README GIF | autoplays on GitHub |
| one-paragraph explanation | for HN/Reddit text posts |
| a mock-LLM example | lets people try without an API key |

### Video script (40s)

1. (0–8s) Chat normally; show the sleep indicator appearing.
2. (8–18s) `memory state`; show `episodes` growing and `memory.json` as a
   rewrite, not a log.
3. (18–28s) Run `memory dream`; show the report: merged entries, time-shifted
   plan, hypotheses.
4. (28–36s) Show `snapshots` + `restore` — a bad dream can be undone.
5. (36–40s) One line: "Open source. Local. Sleep-stage memory for agents."

## Channels and order

**Day 1 (English):**

- Show HN: `Show HN: Sleep-stage memory for AI agents — an open-source Dreaming`
- r/LocalLLaMA (best fit), r/AI_Agents, r/LLMDevs
- X/Twitter thread with the GIF and the architecture diagram
- LinkedIn (optional)

**Day 1–2 (Chinese):**

- 小红书: 3-slide carousel (sleep indicator, dream report, before/after)
- B站: the 40s video + a 3-minute explanation
- 知乎: "AI Agent 的记忆为什么需要睡眠？"
- V2EX / 即刻: short post with the repo link

**Day 2–7:**

- answer every issue and comment;
- post the dream report as a follow-up ("what one nap did to my memory");
- submit to GitHub topics: `agent-memory`, `llm`, `dreaming`, `deepseek-harness`.

## Post templates

**Show HN**

> Show HN: Sleep-stage memory for AI agents — an open-source Dreaming
>
> Most agent memory is append-only: it grows, duplicates, and keeps stale plans
> alive. I built an open-source version of the "dreaming" idea: a 7-day episodic
> buffer, a background nap that rewrites long-term memory (merge, time-shift,
> demote, drop), active forgetting, and snapshots you can restore. It runs as a
> DSH plugin, local only, no daemon. Happy to answer questions about the
> selection/rewrite design.

**小红书**

> 我给我的 AI 做了个"睡眠"：它会做梦，醒来记忆变短了
> 不是把聊天记录全存下来，而是像人一样：白天进缓冲，空闲时做梦重写记忆，
> 把过时的、重复的、矛盾的洗掉，还能回滚。开源了。

## What not to do

- Do not claim "first" or "better than OpenAI"; claim *open, local, inspectable*.
- Do not post the same text to five subreddits on the same day; tailor.
- Do not launch without the demo video.
- Do not hide the limitations; the architecture doc lists them.

## Realistic expectations

Stars come from the demo + the one-liner + the first 48 hours of distribution.
A repo with no launch gets a handful of views. Plan for a spike, then a long
tail; the long tail is maintained by docs, issues, and follow-up demos (e.g.,
"what 30 days of naps did to my memory").
