# Somnia

**让 AI 学会做梦。** 大多数 Agent 记忆只会追加，Somnia 会睡觉。

![Somnia — 36 秒概念片](demo/sleep-memory-demo.gif)

[36 秒 · 中文](https://github.com/Cliping2077/somnia/releases/download/v1.0.0/sleep-memory-demo.mp4) · [English](https://github.com/Cliping2077/somnia/releases/download/v1.0.0/sleep-memory-demo-en.mp4) · [全部发布](https://github.com/Cliping2077/somnia/releases)

一个开源的「睡眠阶段记忆」实现：短期情节缓冲 + 后台**做梦**重写长期记忆 + 主动遗忘 + 可回滚快照。以 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）插件形式落地，核心思路与框架无关，可以移植到其他 Agent。

**Sleep · Memory · Consolidation · Recall.**

```bash
node scripts/install-dsh.mjs
```

## 为什么不是继续追加？

追加式记忆会腐烂：重复、自相矛盾、死计划一直活着、只进不出。每聊一次，库就脏一点。

OpenAI 的 **Dreaming**（ChatGPT，2025–2026）给出了另一条路：后台进程从大量对话中**合成**记忆并重写，做时间修订（“七月要去新加坡” → “2026 年 7 月去过新加坡”），把不再重要的降到后台。Anthropic 的托管记忆也是异步维护、变更交给人审。

这些都不开源。`sleep-memory` 是一个本地、可检查、可回滚的小实现，还补上了生物学里真正重要的部分：选择、下调、清除、联想。

## 一次打盹做什么

1. **Replay**：读情节缓冲，按显著性打分（显式要求、重复行为、纠正、决定）。
2. **Rewrite**：一次模型调用重写**整份**记忆摘要——合并重复、用新证据解决矛盾、把过期计划改成过去事实、降级过时项、丢掉噪音。
3. **Downscale**：长期不用且低置信的条目降到 `background`，更老的直接删除。
4. **Glymph**：清过期 episodes、旋转快照、写当日报告。

打盹不建会话、不占聊天；用户消息永远优先。关掉应用也不丢：缓冲在磁盘上，下次醒来继续。一天可以睡很多次。

## 快速开始（DSH）

```bash
dsh plugin add ./packages/dsh-memory
```

然后在 DSH 插件管理里启用 **sleep-memory**。数据在 `~/.dsh/memory/`：

| 文件 | 作用 |
| --- | --- |
| `episodes.jsonl` | 近期原始经历（7 天 TTL，上限 2000 条） |
| `memory.json` | 被重写、注入会话的摘要 |
| `snapshots/` | 每次重写一份，可 restore |
| `dreams/YYYY-MM-DD.md` | 人可读的梦报告 |
| `dream-journal.json` | 阶段日志 |

工具：

```
memory save | search | list | hide | show | forget
memory dream | wash | state | config | snapshots | restore
```

## 设计原则

- **任务优先**：用户消息永远打断梦。
- **广泛捕获，严格巩固**：缓冲可以留一句闲话，长期库不行；假设句在缓冲里过期，不会变成“偏好”。
- **重写而非追加**：记忆是摘要，不是日志。
- **按设计遗忘**：下调与清除是功能。
- **可审**：报告、快照、restore 让每次重写都能查、能回滚。
- **纯本地**：无服务器、无遥测、无上传。
- **先脱敏**：API key、Bearer token、邮箱、卡号在进入缓冲或模型之前就被替换。

## 不打开界面也能审阅

```bash
node bin/somnia.mjs state
node bin/somnia.mjs list --status foreground
node bin/somnia.mjs search "间距"
node bin/somnia.mjs snapshots
node bin/somnia.mjs restore 2026-11-17T...
node bin/somnia.mjs report
```

CLI 读的是同一个存储，所以不开 DSH 也能查梦报告、隐藏条目、回滚快照。
`npm test` 跑核心冒烟测试和单测（脱敏、显著性、中文短条目、下调、BOM、模型失败回退）。

## 为什么叫“睡眠”？

四个阶段对应睡眠科学：

- **NREM 系统巩固**：海马回放、抽象成新皮层 schema。
- **突触下调**：弱化噪音，保留被使用的东西。
- **胶质淋巴清除**：字面意义的清洗，与内容无关。
- **REM 联想**：情绪加工与松散重组——所以只产出低置信 `hypotheses`，不当事实。

梦不是机制，是报告；机制是选择、重写、衰减、审阅。

## 其他 Agent

Somnia 拆成两层：**`@somnia/core`**（只依赖 Node，不依赖 DSH）和 **DSH 适配层**。核心只需要一个存储目录和一个 `generate()`；缓冲、显著性、重写提示词、下调、快照、注入、12 个工具动作都在核心里。

移植 = 实现 [docs/porting.md](docs/porting.md) 里的六个钩子，复用 `packages/core/src/somnia.js`。DSH 适配层（`packages/dsh-memory/index.js`）是参考实现，约 200 行接线。

## 状态

v1.0：已可用：缓冲捕获、模型重写、下调、快照/恢复、注入、梦报告、对话末尾的睡眠指示器（官方 DeepSeek 鲸鱼尾巴 + 蓝色流光 + 三个上升的 z + 已睡时长）。

下一步：抽出与框架无关的 `core` 包并补单测、做记忆审阅 UI、展示 REM 假设、在 macOS/Linux 实测。

## 许可

MIT。见 [LICENSE](LICENSE)。

English: [README.md](README.md)
