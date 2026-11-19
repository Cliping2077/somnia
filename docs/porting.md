# Porting Somnia to another agent

Somnia's algorithms are host-agnostic. The **v1.0 entry point is a DeepSeek Harness
plugin**, so another agent cannot `npm install` it and go — it needs a small adapter.

This document is the boundary. If your agent can supply the five hooks below, the
sleep loop works unchanged.

## What is generic

| Piece | Where | Host assumptions |
|---|---|---|
| Episodic buffer (TTL, cap, salience) | `index.js` – `trimEpisodes`, `selectSalientEpisodes` | none |
| Dream rewrite (merge, time-shift, demote, contradictions) | `rewrite` prompt + `applyRewrite` + `parseRewrite` | one `generate()` call |
| Deterministic downscale | `downscale` | none |
| Snapshots + restore | `snapshotMemory`, `restoreSnapshot` | a directory |
| Injection text | `injectionText` | a system-prompt slot |
| Memory tool (12 actions) | `ctx.tools.register` | a tool registry |

The parts that are *not* generic are wiring, not logic: how messages arrive, how an
idle moment is detected, how a model is called, where memory is injected, and how a
tool is exposed.

## The adapter boundary

```ts
interface SomniaHost {
  /** Directory for episodes.jsonl, memory.json, snapshots/, dreams/. */
  storageDir: string

  /** Recent user messages, oldest first. Called during replay. */
  listRecentMessages(): Promise<Message[]>

  /** Called once when the agent has been idle for `idleMinutes`. */
  onIdle(handler: (agentId: string) => void): () => void

  /** Called when a user message arrives; cancels a pending nap. */
  onUserMessage(handler: () => void): () => void

  /** One completion call. Return raw text; Somnia parses the JSON. */
  generate(req: { system: string; user: string; maxTokens: number }): Promise<string>

  /** Put the synthesized summary into the agent's system context. */
  inject(text: string): void

  /** Expose the `memory` tool (optional but recommended). */
  registerTool(tool: ToolDefinition): void
}
```

Everything else — prompts, salience scoring, merge rules, time-shift rules,
downscale thresholds, snapshot rotation — lives in Somnia and should not be
reimplemented by the host.

## DSH mapping (v1.0)

| Hook | DeepSeek Harness |
|---|---|
| `listRecentMessages` | `ctx.on('session/event', (session, event) => …)` with `event.type === 'user/message'` |
| `onIdle` | `ctx.on('agent/status', payload => payload.status === 'idle')` |
| `onUserMessage` | `ctx.on('agent/inbox/inserted', …)` |
| `generate` | `ctx.get('llm').stream({ provider, model, … })` + `ctx.get('agentDefaultModel').currentSelection()` |
| `inject` | `ctx.systemPrompt.section({ name: 'memory:index', order: 850, text })` |
| `registerTool` | `ctx.tools.register({ name: 'memory', … })` |

The on-disk format is plain JSON/JSONL. A port can reuse the same files.

## Porting checklist

1. Create `storageDir` (default `~/.dsh/memory` in DSH).
2. Emit user messages into `episodes.jsonl` via `appendEpisode`.
3. Start a timer on idle; call `runDream('idle', { generate })`.
4. Implement `generate` against your model; keep the system prompt and JSON schema.
5. Inject `injectionText()` into your system prompt after every dream.
6. Optional: expose the `memory` tool so the agent can search, hide, forget, restore.

## Honest status

v1.0 ships two pieces: `@somnia/core` (`packages/core/src/somnia.js`, Node only, no
DSH imports) and this DSH adapter (`packages/dsh-memory/index.js`). The adapter is
the reference implementation of the six hooks; porting means writing the same
~200 lines for your host and reusing the core unchanged.

The core has a smoke test (`packages/core/test/smoke.mjs`) covering capture, one
model-backed dream, injection, save/search, snapshots, restore, and config. Unit
tests for salience, rewrite edge cases, and downscale are next.
