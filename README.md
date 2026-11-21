# Somnia

Somnia is an open-source memory component for AI agents. During an idle
period, it turns selected conversation excerpts into scoped memory updates
with citations. A new task can interrupt the background work. Reports and
snapshots let you inspect changes and recover an earlier memory state. Its
DeepSeek Harness adapter is an independently maintained community plugin.

<img src="https://github.com/Cliping2077/somnia/releases/download/v1.0.5/somnia-sleep-demo.gif" alt="Animated DeepSeek Harness and universal Somnia sleep indicators" width="640" />

*Offline demo with synthetic data. The Harness indicator is above the universal indicator.*

[Download v1.0.5 source ZIP](https://github.com/Cliping2077/somnia/archive/refs/tags/v1.0.5.zip) · [Install in DeepSeek Harness](docs/install-dsh.md) · [Offline indicator example](examples/sleep-indicator.html) · [Latest release](https://github.com/Cliping2077/somnia/releases/latest) · [简体中文](README.zh.md)

## What a nap does

1. **Replay** — read the episodic buffer and score each episode for salience
   (explicit memory requests, repeated behaviour, corrections, decisions).
2. **Consolidate** — the model proposes individual changes. The engine verifies
   their cited episodes, merges duplicates, and resolves conflicts using newer
   evidence.
3. **Downscale** — entries that are never used fade to `background`; old
   low-confidence entries are dropped.
4. **Archive** — move older episodes out of the replay window, rotate snapshots,
   and write the dated report.

Consolidation runs in the background. The adapter cancels it when a new task
starts, and pending episodes remain available for a later attempt.

## Try it in 30 seconds

Open the checkout or extracted source archive in a terminal with Node.js 22+
and run:

```bash
node examples/quickstart.mjs
```

The example records two synthetic messages, runs one consolidation, and shows
why one instruction becomes a durable preference while the other stays scoped
to a single task. It uses a local fixture in place of a model and needs no API
key or DeepSeek Harness installation.

```text
Foreground preference · Use dark mode (project drafts, when reviewing)
Background note · Use light mode (release demo, this demo only)
Evidence · “Remember: always use dark mode when reviewing project drafts.”
```

```
day  ──►  episodes.jsonl        (fast, 30-day replay window, never injected)
             │
        nap  ▼
        replay → consolidate → downscale → archive
             │              │
             ▼              ▼
        memory.json     snapshots/ + dream-report.md
        (slow, injected, foreground / background)
```

## Quick start (DSH)

In DSH's **Plugins** page, [install the local bundle](docs/install-dsh.md)
from this repository's `packages/dsh-memory` directory. Verify that its
`memory` plugin is enabled. Memory lives in `~/.dsh/memory/`:

| File | Purpose |
| --- | --- |
| `episodes.jsonl` | redacted recent episodes (30-day replay window, capped at 5,000 during consolidation) |
| `memory.json` | long-term entries available for session context |
| `snapshots/` | restorable history of memory changes |
| `dreams/YYYY-MM-DD.md` | human-readable dream report |
| `dream-journal.json` | current or most recent consolidation phase |

The `memory` tool includes these actions:

```
memory save | search | list | hide | show | forget
memory dream | wash | state | config | snapshots | restore
```

## Why not just append?

Append-only memory rots. Entries duplicate, contradict each other, keep stale
plans alive, and never forget. Every conversation makes the store a little
worse.

Somnia stores the scope and source of a memory so you can see where it applies
and what prompted it. The [design notes](docs/adoption/memory.md) document the
related projects and published designs that informed it.

## Design principles

- **Task first.** A user message always outranks a dream.
- **Record scope.** A one-off instruction can stay in the notes for its task.
- **Keep a review trail.** Sources, reports, and `restore` let you inspect
  memory changes and recover earlier entries.
- **Keep the store on disk.** When DSH uses a remote provider for
  consolidation, selected excerpts and memory entries go to that provider.
- **Redact common sensitive patterns.** The filter covers common credentials,
  emails, and card numbers. Treat the store and its archives as sensitive.

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
entry, or roll back a snapshot without opening the app. `npm test` runs the
core, mock DSH host, publication safety, and end-to-end memory tests offline.

## Development and release verification

Use Node.js 22 or newer. Set `git config core.hooksPath .githooks` in the
checkout to validate staged Git objects and the complete outbound commit range.
New or changed media and other binary files require a separate privacy review.
Run `node scripts/verify-release.mjs` to verify the two package archives locally.
The GitHub verification workflow starts only when dispatched and does not
publish either package.

The DSH plugin installs as a plain directory, so `packages/dsh-memory` carries
its own copy of the core files (`core.js`, `consolidate.js`, `file-memory.js`).
`packages/core/src` is the source of truth: edit it there, then run
`npm run sync-core`. `npm test` fails if the copies drift.

## Why "sleep"?

The name comes from an analogy with replay and consolidation during sleep.
In Somnia, a dream is a background round of selecting episodes, applying
memory updates, and writing a report you can review.

## Other agents

Somnia is split into **`@somnia/core`** (host-agnostic, Node only) and a **DSH adapter**.
The core takes a storage directory and one `generate()` function; everything else —
buffer, salience, rewrite prompt, downscale, snapshots, injection, tool actions —
is already in the core.

To port, implement the six hooks in [docs/porting.md](docs/porting.md) and reuse
`packages/core/src/somnia.js`. The DSH adapter in `packages/dsh-memory/index.js` is
the reference implementation (~200 lines of wiring).

## Status

Somnia includes the host-independent core, the DeepSeek Harness adapter,
and a sleep indicator in the conversation tail. The automated suite and
package checks have passed on Windows and Ubuntu. The GitHub workflow also
defines a macOS job for manual verification.

## Current design and how to verify it

The engine applies `ADD / UPDATE / DELETE / NOOP` operations. An added entry needs
a scope object and traceable evidence. Somnia can demote a one-off decision to
`notes` and can mark an older claim as superseded when a newer claim concerns
the same subject and scope. See the [design and attribution notes](docs/adoption/memory.md).

The machine store is `memory.json`; it is mirrored to a Claude-style `memory/MEMORY.md` index
plus one markdown file per entry. **Editing a file is authoritative** — the next load takes the
file over the JSON.

Run the verification suites (no dataset download needed):

```sh
node packages/core/test/units.mjs
node packages/dsh-memory/test-adapter.mjs
node eval/adoption-eval.mjs
node eval/integration-eval.mjs
node eval/file-sync-eval.mjs
node eval/fetch-datasets.mjs   # tells you how to fetch LoCoMo / LongMemEval-S
```

The evaluation scripts measure behaviors such as retrieval, source validation
and restoration. Long-running conversations and the effect of memory on final
answers still need broader evaluation.

## License

MIT. See [LICENSE](LICENSE).
