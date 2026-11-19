# Architecture

`sleep-memory` is deliberately small: three files, one model call per nap, no
daemon. This document explains the model, the data, and the trade-offs.

## Layers

```
┌─────────────────────────────────────────────────────────────┐
│ episodes.jsonl   fast / episodic / hippocampus              │
│ - every user message (6–600 chars, not a slash command)     │
│ - 7-day TTL, capped at 2000 lines                           │
│ - never injected into a prompt                              │
└──────────────────────────┬──────────────────────────────────┘
                           │  nap (idle + cooldown)
┌──────────────────────────▼──────────────────────────────────┐
│ memory.json      slow / semantic / neocortex                │
│ - a rewritten summary, not a log                            │
│ - sections: identity, preferences, projects, plans,         │
│   lessons, hypotheses, notes                                │
│ - status: foreground | background                           │
│ - injected: up to 8 foreground entries, ~1400 chars         │
└──────────────────────────┬──────────────────────────────────┘
                           │  before every rewrite
┌──────────────────────────▼──────────────────────────────────┐
│ snapshots/       history / rollback                         │
│ - one JSON snapshot per rewrite, newest 20 kept             │
│ - `memory restore <name>` returns to a prior brain           │
└─────────────────────────────────────────────────────────────┘
```

## Why three layers

A single vector store conflates three different lifetimes:

1. **Experience** is cheap and should expire. It may contain hypotheticals,
   jokes, or a sentence the user was quoting. Keeping it forever is a privacy
   problem and a retrieval problem.
2. **Knowledge** is expensive and should be rewritten. It must be current,
   non-contradictory, and small.
3. **History** is for the human. It lets you answer "why do you think that?"
   and undo a bad dream.

Separating them lets the buffer be broad while the long-term store stays
conservative.

## A nap

Triggered by the host when a session has been idle for `idleMinutes`
(default 10) and the 5-minute cooldown has passed. A nap runs in the host
process, not in the conversation; a user message aborts it before it writes.

### 1. Replay / selection

Every buffered episode gets a salience score:

| Signal | Weight |
| --- | --- |
| explicit memory request (`记住`, `remember`, `from now on`) | +3 |
| hypothetical / hypothetical-adjacent (`万一`, `如果`, `what if`) | −3 |
| preference language (`偏好`, `以后`, `prefer`) | +1 |
| decision / correction (`决定`, `改成`, `不对`) | +1 |
| project language (`项目`, `插件`, `版本`) | +0.5 |
| long message (> 80 chars) | +0.5 |

Only episodes with a positive score are sent to the rewrite, capped at 40. A
sentence like "what if I liked dark themes" scores 0 and is dropped.

### 2. Rewrite

One direct model call (`ctx.llm.stream`, no session) receives the current
summary and the salient episodes, and returns a complete new summary:

- merge duplicates and near-duplicates;
- resolve contradictions in favour of newer evidence;
- time-shift plans whose date has passed;
- demote stale or rarely relevant entries to `background`;
- drop what no longer matters;
- return at most 40 entries and at most 3 hypotheses.

If the model returns an empty list for a non-empty store, the rewrite is
treated as failed and the previous memory is kept. If the model call fails
entirely, a conservative fallback appends the salient text as low-confidence
`notes` instead of losing it.

### 3. Downscale

Independent of the model:

- an entry never used for 30 days and still `foreground` becomes `background`;
- an entry never used for 90 days loses 0.2 confidence;
- anything below 0.15 confidence with zero uses is removed.

### 4. Glymph

- episodes older than 7 days are dropped;
- the buffer is capped at 2000 lines;
- snapshots beyond the newest 20 are removed;
- `dreams/YYYY-MM-DD.md` and `dream-report.md` are written.

## The sleep indicator

The desktop client registers `conversation.chat.turnTail`: a row inside the
transcript, before the completed turn's actions row, where the "深度求索中" line
lives while a run is active. It only renders on the newest turn and only when
`useSessionStatus` reports `running === false` for ten minutes.

The visuals reuse the shipped running status: the official DeepSeek whale tail
path, the same font metrics and the same shimmer mechanism (a `::after` text
clone masked with a 105° gradient and swept with `steps(48, end)`), plus three
small italic `z`s that climb to the upper right.

The row unmounts the moment a run starts, handing the seat back to the thinking
line. There is no overlay and no card, so it never covers the conversation.

## Files on disk

`~/.dsh/memory/`:

| File | Written by | Read by |
| --- | --- | --- |
| `episodes.jsonl` | every user message | replay |
| `memory.json` | rewrite | injection, tools |
| `snapshots/*.json` | each rewrite | `restore` |
| `dreams/YYYY-MM-DD.md` | each nap | humans |
| `dream-report.md` | each nap | humans |
| `dream-journal.json` | each phase | debugging |
| `state.json` | host | idle/cooldown state |

## Security and privacy

- Everything is local; no network calls except the model provider already
  configured in DSH.
- The buffer contains raw user text for at most 7 days.
- The long-term store is a summary, not a transcript.
- No secrets are intentionally stored; the rewrite prompt forbids tokens,
  personal identifiers, and one-off chatter. This is a policy, not a
  guarantee — treat the store as sensitive.
- `memory forget` and `memory restore` are the manual escape hatches.

## Relationship to OpenAI Dreaming

| | OpenAI Dreaming | sleep-memory |
| --- | --- | --- |
| Where | hosted | local, open source |
| Trigger | background synthesis | idle nap, environment-driven |
| Update | rewrite | rewrite |
| Time | time-aware | prompt-level time-shift |
| Decay | demote to background | downscale + drop |
| Dream | none (product term) | report + hypotheses |
| Review | saved-memories UI | tools + snapshots + report |
| Buffer | internal | explicit 7-day episodic buffer |

The interesting difference is the buffer. OpenAI can afford to keep everything
internal; a local agent cannot, so the buffer is a visible, expiring contract
between capture and consolidation.

## Limitations

- Rewrite quality depends on the model; a weak model produces weak summaries.
- Hypotheses are generated but not yet surfaced in a UI.
- No embeddings; retrieval is term overlap over a small summary, which is
  intentional.
- Single-user, single-machine; no sync, no multi-agent sharing.
- Tested on Windows; paths use `os.homedir()` so macOS/Linux should work, but
  they are not yet verified.
