# Architecture

Somnia has a Node.js memory engine and a DeepSeek Harness adapter. The core
takes a caller-provided storage directory and model function. The adapter
subscribes to host activity, invokes the configured DSH model, and exposes
the memory tool and conversation-tail indicator.

## Capture and storage

The adapter captures eligible user text and applies common-pattern redaction.
The active buffer is kept on disk. During consolidation, it retains up to
5,000 recent episodes within a 30-day replay window. Older episodes move to
the local archive, which the memory tool can also search.

| File | Purpose |
| --- | --- |
| `episodes.jsonl` | Active episodic buffer |
| `episodes-archive.jsonl` | Older episodes available to recall |
| `memory.json` | Long-term entries with provenance, scope, and review history |
| `memory/MEMORY.md` | Markdown index for the user-editable memory mirror |
| `snapshots/*.json` | Up to 20 recovery points |
| `dream-report.md` | Most recent consolidation report |
| `dreams/YYYY-MM-DD.md` | Dated reports |
| `dream-journal.json` | Consolidation phase and outcome |
| `state.json` | Idle and pause settings and runtime timestamps |

## Consolidation

The adapter schedules an automatic attempt after the configured idle interval
(10 minutes by default) when all observed agents are idle. Automatic attempts
have a minimum six-hour cooldown after the previous attempt or successful
dream. A new foreground task or user inbox activity can cancel the current
attempt. A manual `memory dream` can request consolidation immediately.

1. **Replay.** Rank recent episodes by signals such as explicit requests,
   corrections, and project context. Hypothetical language reduces the score.
   A small sample of previous episodes can provide additional context.
2. **Apply operations.** The model proposes individual adds, updates,
   invalidations, or a no-op. The engine checks cited episode IDs and supplied
   quotes against the selected episodes. Scope and explicit preference cues
   help keep single-task instructions in their own notes. A failed model
   attempt leaves the existing store intact. Relevant episodes can be tried
   again later.
3. **Downscale.** Age, confidence and remembered usage influence retention.
   Unused entries can move to the background or leave the active memory
   store. Pinning protects entries from automatic downscaling.
4. **Review.** The journal records the outcome. Reports and snapshots help
   users inspect and recover memory changes.

See [design and attribution](adoption/memory.md) for the published ideas and
layout conventions that influenced the implementation.

## Recall and prompt context

The memory tool searches saved entries and episodes with lexical ranking.
The host can supply an optional embedding function. For prompt injection,
Somnia prioritizes pinned and profile entries, ranks other foreground entries
against the supplied context, and caps the text at 2,400 characters. The
retrieval evaluations measure recall and selected behaviors. Broader
long-running evaluation is still needed to show when the agent uses the
right memory in its final answer.

## DeepSeek Harness integration

The adapter installs as a local plugin directory. Its copy of the core is
generated from `packages/core/src` with `npm run sync-core`. The project test
suite checks that the copies match. The conversation-tail indicator displays
an estimate of idle time and hides when a task begins. The `memory state`
action shows the adapter's actual consolidation state.

## Data handling

Somnia writes its files to the local machine. During a model-backed dream,
the adapter sends selected episodes and memory entries to the configured
DeepSeek Harness model provider. Pattern-based redaction reduces exposure to
common sensitive formats. Treat the buffer, archive, store and snapshots
as sensitive data.

Removing a saved memory through the tool changes the long-term store.
Episodes, their archive and existing recovery snapshots have separate
lifetimes within the same memory directory.
