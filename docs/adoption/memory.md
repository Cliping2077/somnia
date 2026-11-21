# Memory design sources

The canonical Somnia implementation is in [`packages/core/src`](../../packages/core/src). The DeepSeek Harness bundle carries local copies of the three core modules so a local plugin installation can load them from its own directory. [`scripts/sync-core.mjs`](../../scripts/sync-core.mjs) keeps those copies in sync.

## Design references

- **OpenAI Dreaming.** OpenAI describes a background process that synthesizes memory across past conversations. This is a reference for separating the capture of episodes from later memory consolidation. [OpenAI's Dreaming announcement](https://openai.com/index/chatgpt-memory-dreaming/)
- **Anthropic agent memory.** Anthropic's research describes offline reflection that revisits transcripts to correct notes and reorganize memory. This is a related design reference for Somnia's replay pass. [The components of agent memory](https://www.anthropic.com/research/components-of-agent-memory)
- **Mem0.** Mem0 describes extracting memories and deciding whether to add, update, delete, or leave a record unchanged. Somnia applies an operation-based design to its own scoped records and checks citations against captured episodes. The upstream repository uses Apache 2.0. [Mem0 paper](https://arxiv.org/abs/2504.19413) · [Upstream operation prompt](https://github.com/mem0ai/mem0/blob/main/mem0/configs/prompts.py) · [Mem0 license](https://github.com/mem0ai/mem0/blob/main/LICENSE)
- **Graphiti.** Graphiti models temporal validity and invalidation of knowledge graph edges. Somnia applies this pattern to the `validFrom` and `validTo` fields of its memory records. The upstream repository uses Apache 2.0. [Graphiti](https://github.com/getzep/graphiti) · [Graphiti license](https://github.com/getzep/graphiti/blob/main/LICENSE)
- **Claude Code auto memory.** Claude Code documents a `MEMORY.md` index with separate memory files. Somnia uses this layout for its editable Markdown mirror and stores one file per Somnia memory record. [Claude Code auto memory documentation](https://code.claude.com/docs/en/memory)

[`docs/memory-design.md`](../memory-design.md) gives the research references for salience, replay, retention, and evaluation. [`consolidate.js`](../../packages/core/src/consolidate.js) implements the scoped write operations and source checks. [`file-memory.js`](../../packages/core/src/file-memory.js) handles the Markdown mirror, and [`somnia.js`](../../packages/core/src/somnia.js) manages scheduling, replay, retention, and snapshots.

## Evaluation data and artwork

[`eval/fetch-datasets.mjs`](../../eval/fetch-datasets.mjs) points to LoCoMo and LongMemEval-S, which are obtained separately for evaluation. LoCoMo uses CC BY-NC 4.0. See the upstream terms for use and redistribution. [LoCoMo dataset license](https://github.com/snap-research/locomo/blob/main/LICENSE.txt) · [LongMemEval dataset](https://huggingface.co/datasets/xiaowu0162/longmemeval)

Release `v1.0.1` included a vector path described in the client source as DeepSeek's running-whale artwork. The original asset URL and reuse terms remain unverified. [Historical client source](https://github.com/Cliping2077/somnia/blob/v1.0.1/packages/dsh-memory/client.js#L104-L106)
