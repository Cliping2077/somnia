# Somnia

**Let your AI dream.** Most agent memory is append-only. This one sleeps on it.

![Somnia — a 36-second film](demo/sleep-memory-demo.gif)

[36s film · 中文](https://github.com/Cliping2077/somnia/releases/download/v1.0.0/sleep-memory-demo.mp4) · [English](https://github.com/Cliping2077/somnia/releases/download/v1.0.0/sleep-memory-demo-en.mp4) · [All releases](https://github.com/Cliping2077/somnia/releases)

An open-source implementation of *sleep-stage memory* for AI agents: a short-lived
episodic buffer, a background **dream** that rewrites long-term memory, active
forgetting, and a reviewable snapshot history. Built as a plugin for
[DeepSeek Harness](https://github.com/deepseek-ai) (DSH), with a small,
framework-agnostic design that can be ported to other agents.

**Sleep · Memory · Consolidation · Recall.**

```bash
node scripts/install-dsh.mjs
```

```
day  ──►  episodes.jsonl        (fast, 7-day TTL, never injected)
             │
        nap  ▼
        replay → rewrite → downscale → glymph
             │              │
             ▼              ▼
        memory.json     snapshots/ + dream-report.md
        (slow, injected, foreground / background)
```

## Why not just append?

Append-only memory rots. Entries duplicate, contradict each other, keep stale
plans alive, and never forget. Every conversation makes the store a little
worse.

OpenAI's **Dreaming** (ChatGPT, 2025–2026) showed the alternative: a background
process that *synthesizes* memory from many conversations, rewrites it, shifts
time ("going to Singapore in July" → "went to Singapore in July 2026"), and
demotes what stops mattering. Anthropic's managed memory takes a similar path:
asynchronous maintenance that proposes changes for human review.

None of that is open source. `Somnia` is a small, local, inspectable
take on the same idea — plus the parts biology suggests: selection,
downscaling, clearance, and dreams.

## What a nap does

1. **Replay** — read the episodic buffer and score each episode for salience
   (explicit memory requests, repeated behaviour, corrections, decisions).
2. **Rewrite** — one direct model call rewrites the *whole* memory summary:
   merge duplicates, resolve contradictions with newer evidence, time-shift
   expired plans, demote stale items, drop noise.
3. **Downscale** — entries that are never used fade to `background`; old
   low-confidence entries are dropped.
4. **Glymph** — trim expired episodes, rotate snapshots, write the dated report.

A nap never creates a session, never takes a chat turn, and a user message
always outranks it. If the app closes, nothing is lost: the buffer is on disk
and the next wake consolidates it. Multiple naps per day are expected.

## Quick start (DSH)

```bash
# from this repository
dsh plugin add ./packages/dsh-memory
```

Then enable **sleep-memory** in DSH's plugin manager. Memory lives in
`~/.dsh/memory/`:

| File | Purpose |
| --- | --- |
| `episodes.jsonl` | raw recent experience (7-day TTL, capped at 2000) |
| `memory.json` | the rewritten summary that is injected into sessions |
| `snapshots/` | one snapshot per rewrite, restorable |
| `dreams/YYYY-MM-DD.md` | human-readable dream report |
| `dream-journal.json` | phase log (replay / rewrite / downscale / done) |

The same directory also contains the classic four tools:

```
memory save | search | list | hide | show | forget
memory dream | wash | state | config | snapshots | restore
```

## What that looks like

```
$ memory dream
{ "lastDreamAt": 1794889502731 }

$ cat ~/.dsh/memory/dream-report.md
# Dream 2026-11-17

- Reason: manual
- Engine: model
- Episodes in buffer: 24
- Salient episodes: 7
- Entries: 9 -> 9
- Hypotheses: 2

## Kept
- [preferences] UI: use the DeepSeek layout position as the reference.
- [projects] The user is building an AIGC / fiction workflow and wants DSH to feel like GPT.
...
## Hypotheses
- The user may still be comparing the visual layout of DSH against DeepSeek.
```

## Design principles

- **Task first.** A user message always outranks a dream.
- **Capture broadly, consolidate selectively.** The buffer can hold a stray
  sentence; the long-term store cannot. Hypotheticals and one-off chatter decay
  in the buffer instead of becoming "preferences".
- **Rewrite, don't append.** Memory is a summary, not a log.
- **Forget by design.** Downscaling and clearance are features, not bugs.
- **Human review.** Reports, snapshots, and `restore` make every rewrite
  auditable and reversible.
- **Local only.** No server, no telemetry, no uploads.
- **Redact first.** API keys, bearer tokens, emails, and card numbers are stripped
  before anything reaches the buffer or the model.

## Review without the UI

```bash
node bin/somnia.mjs state
node bin/somnia.mjs list --status foreground
node bin/somnia.mjs search "间距"
node bin/somnia.mjs snapshots
node bin/somnia.mjs restore 2026-11-17T...
node bin/somnia.mjs report
```

The CLI reads the same store as the DSH adapter, so you can audit a dream, hide an
entry, or roll back a snapshot without opening the app. `npm test` runs the core
smoke test and the unit tests (redaction, salience, short CJK entries, downscale,
BOM, failed-model fallback).

## Why "sleep"?

The phases are modelled on what sleep actually does:

- **NREM systems consolidation** — hippocampal replay, abstraction into
  neocortical schemas ([Lutz & Born 2026](https://journals.physiology.org/doi/full/10.1152/physrev.00054.2024)).
- **Synaptic downscaling** — sleep weakens noise and keeps what is used
  ([Tononi & Cirelli](https://www.sciencedirect.com/science/article/abs/pii/S1087079205000420)).
- **Glymphatic clearance** — literal washing, unrelated to content
  ([Molecular Psychiatry 2026](https://www.nature.com/articles/s41380-026-03750-w)).
- **REM association** — emotional processing and loose recombination, which is
  why the plugin stores *hypotheses* (low confidence), never facts
  ([Trends Neurosci 2025](https://www.sciencedirect.com/science/article/abs/pii/S0166223625002218)).

Dreaming is not the mechanism; it is the report. The mechanism is selection,
rewrite, decay, and review.

## Other agents

Somnia is split into **`@somnia/core`** (host-agnostic, Node only) and a **DSH adapter**.
The core takes a storage directory and one `generate()` function; everything else —
buffer, salience, rewrite prompt, downscale, snapshots, injection, tool actions —
is already in the core.

To port, implement the six hooks in [docs/porting.md](docs/porting.md) and reuse
`packages/core/src/somnia.js`. The DSH adapter in `packages/dsh-memory/index.js` is
the reference implementation (~200 lines of wiring).

## Status

Working today: buffer capture, model-backed rewrite, downscale, snapshots,
restore, injection, dream report, and the sleep indicator (official DeepSeek
whale tail, blue shimmer, three rising z's, elapsed sleep time) in the
conversation tail.

Next: extract a framework-agnostic `@somnia/core` with unit tests, add a small
review UI, surface REM hypotheses, and test on macOS/Linux.

## License

MIT. See [LICENSE](LICENSE).

中文说明：[README.zh.md](README.zh.md)
