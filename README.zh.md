# Somnia

Somnia 是给 AI Agent 用的开源记忆组件。它在空闲时挑选对话片段、整理带出处和适用范围的记忆。新任务可以打断后台整理，用户也可以查看报告、从快照恢复。其 DeepSeek Harness 适配器是独立维护的社区插件。

<img src="https://github.com/Cliping2077/somnia/releases/download/v1.0.5/somnia-sleep-demo.gif" alt="DeepSeek Harness 和通用 Somnia 睡眠指示器动画" width="640" />

*用合成数据制作的离线演示。上方是 DeepSeek Harness 版，下方是通用 Somnia 版。*

[下载 v1.0.5 源码 ZIP](https://github.com/Cliping2077/somnia/archive/refs/tags/v1.0.5.zip) · [安装到 DeepSeek Harness](docs/install-dsh.md) · [离线指示器示例](examples/sleep-indicator.html#zh) · [最新发布](https://github.com/Cliping2077/somnia/releases/latest) · [English](README.md)

## 一次打盹做什么

1. **Replay**：读情节缓冲，按显著性打分（显式要求、重复行为、纠正、决定）。
2. **巩固**：模型提出逐条更新，程序核验情节来源，合并重复，并用有依据的新信息处理冲突。
3. **Downscale**：长期不用且低置信的条目降到 `background`，更老的直接删除。
4. **归档**：把较早情节移出活跃回放窗口、轮换快照、写报告。

整理在后台运行。新任务可以中断整理，未处理的情节可留到下次尝试。

## 30 秒上手

在仓库或解压后的源码目录中，用 Node.js 22 或更新版本运行：

```bash
node examples/quickstart.mjs
```

示例会把「审稿时用深色模式」保留为前台偏好，把「这次发布演示用浅色模式」记为仅适用于该演示的后台笔记，并显示原文出处。示例使用合成对话和预设模型响应，无需 API 密钥或安装 DeepSeek Harness。

## 快速开始（DSH）

在 DSH 的「插件」页面安装 `packages/dsh-memory` 目录后，确认插件包及其 `memory` 插件已启用。若插件管理提示需要重启，请重启 DSH。数据保存在 `~/.dsh/memory/`：

| 文件 | 作用 |
| --- | --- |
| `episodes.jsonl` | 脱敏后的近期情节（回放窗口 30 天，巩固时上限 5,000 条） |
| `memory.json` | 可注入会话的长期记忆条目 |
| `snapshots/` | 可用于恢复的记忆历史 |
| `dreams/YYYY-MM-DD.md` | 人可读的梦报告 |
| `dream-journal.json` | 阶段日志 |

工具：

```
memory save | search | list | hide | show | forget
memory dream | wash | state | config | snapshots | restore
```

## 为什么不是继续追加？

追加式记忆会腐烂：重复、自相矛盾、死计划一直活着、只进不出。每聊一次，库就脏一点。

Somnia 给每条整理出的记忆保留适用范围和原文证据，方便你检查它该在什么时候用。相关项目和采用的设计见[设计出处](docs/adoption/memory.md)。

## 设计原则

- **范围清晰**。一次性的指令可以归入对应任务的笔记。
- **可以检查**。来源、报告和快照帮助你追踪修改，并恢复较早的记忆。
- **存储在本地**。若 DSH 配置了远程模型，整理时会把选中的对话片段和记忆条目发给该服务商。
- **过滤常见敏感内容**。过滤器识别常见凭据、邮箱和卡号格式，记忆文件与归档仍应视为敏感数据。

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
`npm test` 离线运行核心测试、DSH 宿主模拟测试、推送防护测试和记忆流程集成测试。

## 开发和发版验证

使用 Node.js 22 或更高版本。在代码仓库内配置 `git config core.hooksPath .githooks`，
可在提交时检查暂存区，在推送时检查整个待推送的提交范围。新增或变更的媒体及其他
二进制文件需要单独做隐私审查。`node scripts/verify-release.mjs` 在本地验证两个
软件包的实际归档。GitHub 验证流程需要手动触发，流程仅做验证。

DSH 插件以普通目录安装，所以 `packages/dsh-memory` 里带了一份核心文件副本
（`core.js`、`consolidate.js`、`file-memory.js`）。以 `packages/core/src` 为准：
改那里，然后运行 `npm run sync-core`。副本不一致时 `npm test` 会直接失败。

## 为什么叫“睡眠”？

名字借用了睡眠中的回放和巩固。Somnia 的一次「梦」是指在后台挑选情节、应用记忆更新，并写出一份可以查看的报告。

## 其他 Agent

Somnia 拆成两层：**`@somnia/core`**（只依赖 Node，不依赖 DSH）和 **DSH 适配层**。核心只需要一个存储目录和一个 `generate()`；缓冲、显著性、重写提示词、下调、快照、注入、12 个工具动作都在核心里。

移植 = 实现 [docs/porting.md](docs/porting.md) 里的六个钩子，复用 `packages/core/src/somnia.js`。DSH 适配层（`packages/dsh-memory/index.js`）是参考实现，约 200 行接线。

## 状态

已提供独立的 `@somnia/core` 包、DeepSeek Harness 适配层和对话尾部睡眠指示器。自动化测试和打包检查在 Windows 与 Ubuntu 上通过，GitHub 工作流还提供可手动运行的 macOS 测试任务。

现有评估覆盖召回、出处校验和恢复等行为，长期对话中的实际收益仍需要更多验证。

## 许可

MIT。见 [LICENSE](LICENSE)。
