# Memory design

> **Status note.** Sections below that describe a whole-store LLM rewrite and the benchmark table
> are superseded by the operation-based pipeline: see `docs/adoption/memory.md` for the current
> data model (`scope`, `source`, validity), the write ops, and the failure-mode evaluation. The
> rewrite design is kept only as history.
Status: experimental. This is not a brain model and must not be marketed as one.

## Goal

Keep episodic evidence, derive a slow semantic view, retrieve per task, and let retrieval
reinforce what is used. A single nightly rewrite is not allowed to be the only memory.

## Architecture

```
session events -> episodes.jsonl (append-only, active 30d)
                    |                    \
                    |                     -> episodes-archive.jsonl (never deleted)
                    v
              dream: interleaved replay (new + sampled old)
                    v
              memory.json (derived semantic cache; rebuildable)
                    v
              injection: pinned + identity/preferences verbatim
              recall: lexical top-k over entries + active + archive episodes
```

Key properties:

- **Append-only episodic store.** `trimEpisodes` moves old episodes to
  `episodes-archive.jsonl`; it never drops them. `recall` searches both stores.
- **Derived semantic cache.** `memory.json` is a cache; a failed dream falls back without
  wiping it, and snapshots are written before rewrites.
- **Pinned anchors.** Pinned entries survive rewrites, downscale, save-time trimming, and
  are injected verbatim.
- **Interleaved replay.** A dream replays new salient episodes plus an evenly sampled set of
  older episodes, but only when new episodes exist.
- **Forgetting curve.** `retentionOf` is an Ebbinghaus-style score based on age, uses,
  confidence, and pinning; low-retention entries are demoted or dropped, pinned ones never.
- **Reconsolidation.** `recall` increments `uses` and `lastUsedAt` for retrieved entries.
- **Knowledge update.** Factual entries may carry a `subject`; retrieval marks older same-subject
  values `superseded` while keeping their provenance. Without an explicit subject, a lexical
  content-overlap heuristic (Jaccard over words + CJK unigrams, threshold 0.5) clusters same-fact
  versions. This is latest-wins with provenance, not free-text entity linking.
- **Temporal ordering.** `retrieve` returns a `timeline` of matched episodes sorted by time,
  so order-of-events questions can be answered from provenance.
- **Embedding (optional).** `createSomnia({ embed })` accepts a synchronous `text -> number[]`
  function; capture stores the vector and `retrieve` blends cosine similarity with lexical/BM25.
  The DSH adapter passes through `config.embed`. DeepSeek's API has no embeddings endpoint
  (multiple provider docs confirm), DSH exposes no embeddings service, and the bundled runtime
  has no local embedding model, so a real embedding source is external. Example (OpenAI-compatible):

```js
// any OpenAI-compatible /embeddings endpoint (OpenAI, Ollama, ONNX server, ...)
const embed = async (text) => {
  const res = await fetch(EMBED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ input: text, model: 'text-embedding-3-small' }),
  })
  const json = await res.json()
  return json.data[0].embedding
}
```

The interface is synchronous in the core, so wrap an async provider before passing it in.

## Literature mapping

| Design choice | Source |
|---|---|
| Two systems, interleaved replay, avoid catastrophic interference | McClelland, McNaughton & O'Reilly 1995, *Psychol Rev* — [PubMed 7624455](https://pubmed.ncbi.nlm.nih.gov/7624455/) |
| Sleep replay / systems consolidation | Brodt et al. 2023, *Neuron* — [PubMed 37023710](https://pubmed.ncbi.nlm.nih.gov/37023710/) |
| Synaptic downscaling preserves salient traces | Tononi & Cirelli 2014, *Neuron* — [PubMed 24411729](https://pubmed.ncbi.nlm.nih.gov/24411729/) |
| Virtual context / tiered memory, interrupts | Packer et al. 2023, MemGPT — [arXiv:2310.08560](https://arxiv.org/abs/2310.08560) |
| Ebbinghaus forgetting curve, memory updating | Zhong et al. 2023, MemoryBank — [arXiv:2305.10250](https://arxiv.org/abs/2305.10250) |
| Saved memories + reference chat history, user controls | OpenAI, [Memory and new controls for ChatGPT](https://openai.com/index/memory-and-new-controls-for-chatgpt/) |
| "Memories" from past chats, user controls | Google, [Gemini personalisation](https://blog.google/company-news/inside-google/around-the-globe/google-europe/united-kingdom/gemini-launches-new-personalisation-features-in-the-uk/) |

## Alignment with OpenAI / Gemini (public behaviour only)

| Capability | OpenAI (public) | Gemini (public) | Somnia |
|---|---|---|---|
| Explicit saved memories | yes | yes ("Memories") | yes, entries with pin |
| Reference past conversations | yes | yes | yes, append-only episodes + recall |
| User view/delete | yes | yes | list/forget |
| Per-task retrieval | yes (history reference) | yes | `recall` lexical top-k; not wired to every turn yet |
| Provenance | not public | not public | `source` + episode timestamps |
| Forgetting/decay | not public | not public | Ebbinghaus-style `retentionOf` |
| Internal mechanism claims | not public | not public | explicitly not claimed |

## Reference selection (timeliness and self-review)

Selection rule: use 2023–2026 work for system design and 1995/2014 classics only for the
mechanistic claims they established. Reviews are used for synthesis, primary papers for
specific mechanisms. No claim here depends on a single blog post.

Additional recent references reviewed:

- A-MEM: agentic, Zettelkasten-style memory with note linking and evolution — [arXiv:2502.12110](https://arxiv.org/abs/2502.12110)
- Mem0: production-oriented extract/update memory pipeline — [arXiv:2504.19413](https://arxiv.org/abs/2504.19413)
- LongMemEval: five long-term memory abilities, including knowledge update and abstention — [ICLR 2025 / arXiv:2410.10813](https://arxiv.org/abs/2410.10813)
- Survey: memory forms, functions and dynamics in the agent era — [arXiv:2512.13564](https://arxiv.org/abs/2512.13564)
- Survey: mechanisms, evaluation and evolution of LLM memory — [arXiv:2509.18868](https://arxiv.org/abs/2509.18868)

Self-review limits: these are public abstracts/pages, not full reproductions; no claim is made
that Somnia matches their reported scores. The LoCoMo protocol below is retrieval-only and
uses a different metric from published QA accuracy.

## Measured results (LoCoMo, retrieval-only)

Protocol: 10 conversations, 50 questions each (500 questions), top-10 retrieval. A hit means
the retrieved context contains a gold evidence `dia_id` or the gold answer string. This
measures retrieval, not answer accuracy; it is not comparable to published LoCoMo QA scores.

| System | Evidence recall@10 | Avg context chars |
|---|---|---|
| Recency window (last 10 turns) | 0.018 | 1392 |
| Fixed 2000-char summary | 0.148 | 2000 |
| v3 recall + BM25 | 0.588 | 1511 |

Run: `node eval/locomo-eval.mjs 50`. The retrieval result is the measurable claim; no claim
is made about end-to-end QA.

Per-step retrieval: the adapter listens to `agent/pre-step` and prepends relevant memories
(marker `[long-term memory]`) to the messages entering a step; superseded entries are excluded
from the injected block, and steps that already carry the marker are not re-injected. The handler
(including `next()` delegation and the guard) is unit-tested in `test-adapter.mjs`.

## Reproducible evaluation

`node eval/run-all.mjs` runs the full suite and writes `eval/results.json` (exit code
non-zero on any failure). `eval/locomo-eval.mjs` uses the downloaded `eval/locomo10.json`
(LoCoMo, CC BY-NC 4.0, retrieval metric only).

External benchmark status: LoCoMo (CC BY-NC 4.0) and LongMemEval-S (MIT) are downloaded
and run. LongMemEval-S result is **session-level retrieval recall** (top-10 episodes → sessions,
hit any gold `answer_session_ids`), not end-to-end QA accuracy; it is therefore not comparable
to the paper's QA scores, which use a reader + judge.

LongMemEval-S (500 instances, retrieval only):

| question_type | n | session recall@10ep | session recall@20ep |
|---|---|---|---|
| single-session-user | 70 | 0.986 | 1.000 |
| single-session-assistant | 56 | 1.000 | 1.000 |
| single-session-preference | 30 | 0.767 | 0.833 |
| multi-session | 133 | 0.962 | 0.970 |
| temporal-reasoning | 133 | 0.940 | 0.955 |
| knowledge-update | 78 | 1.000 | 1.000 |
| **overall** | 500 | **0.958** | **0.970** |

`single-session-preference` is the weak type and is the one a semantic/embedding retriever
should lift; lexical + BM25 tops out near 0.83 on it.

## Self-review (known gaps)

- P0: none found in the current code paths under test; no claim of end-to-end QA accuracy is made.
- P1: retrieval defaults to lexical + BM25 (no bundled embedding model), so paraphrase and
  synonym recall is weak unless an `embed` function is provided; `subject`-based knowledge
  update needs the model to emit `subject`, not free-text entity linking.
- P1: per-step `agent/pre-step` injection is unit-tested (handler + guard + capture), but a live
  turn with a real memory hit has not been observed end-to-end.
- P2: `estimateCostCny` models flash off-peak pricing only; O(n) retrieval over the full
  episode pool is unindexed.

Verification matrix: capture (`session/event` → episode) unit-tested; per-step injection
(handler + superseded filter + guard) unit-tested; pinned survival, knowledge update, temporal
ordering, abstention, and LoCoMo retrieval measured. Not verified: a real embedding model, a
live turn, LongMemEval.

## Non-claims

- Not "close to the human brain"; the mapping is an engineering analogy.
- Not internal alignment with OpenAI or Gemini; only public behaviour is compared.
- No embedding retrieval yet; `recall` is lexical (CJK bigrams + word overlap).
- No formal benchmark results yet; `eval/memory-eval.mjs` is a smoke evaluation.

## Evaluation

Run:

```
node eval/memory-eval.mjs
```

It checks: pinned survival across a dream, retrieval over entries/episodes, reinforcement,
and fallback behaviour. This is a regression check, not a research benchmark.
