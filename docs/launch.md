# Launch notes

Somnia gives an agent a way to keep a durable preference with its source and
scope, and to inspect or roll back changes made during an idle period. The
first audience is people building personal agents and using DeepSeek Harness.

Use the [public repository](https://github.com/Cliping2077/somnia) and
[latest release](https://github.com/Cliping2077/somnia/releases/latest).
The [30-second example](../examples/quickstart.mjs), run from the extracted
source directory, uses synthetic messages and a scripted model response.
It demonstrates what the engine does after receiving those proposals.

## Show HN or a technical community

Suggested title

> Show HN: Somnia, inspectable memory for AI agents

Suggested post

> I built Somnia to make an agent's long-term memory easier to check and fix.
> During an idle period, it takes selected bits of conversation and proposes
> scoped memory updates. Each update can cite its source, and a snapshot
> lets you go back if the result is wrong.
>
> The little example in the README shows why “always use dark mode when
> reviewing drafts” becomes a preference, while “use light mode for this
> demo” stays with that demo. The example runs locally with a scripted model
> response and needs no API key.
>
> The core runs on Node.js, and the DeepSeek Harness adapter makes it usable
> inside that host. I’d like feedback from anyone who has had an agent reuse
> a preference in the wrong task.
>
> https://github.com/Cliping2077/somnia

## 即刻或中文开发者社区

建议正文

> 我做了个开源组件 Somnia，想解决 Agent 把一次性的要求记成永久偏好的问题。
>
> 例如「以后审稿用深色模式」可以长期记住。「这次发布演示用浅色」则只留下
> 一条属于这次演示的笔记。你可以查看每条记忆的原文出处，发现问题时从快照恢复。
>
> README 里有个 30 秒示例，跑起来不需要 API 密钥。也可以把它作为
> DeepSeek Harness 的本地插件试用。你遇到过 Agent 把上一个项目的习惯用到
> 当前项目吗？欢迎拿具体例子来交流。
>
> https://github.com/Cliping2077/somnia

## 展示素材

用上手示例的真实输出展示偏好、笔记及来源。离线睡眠指示器示例上方展示 DeepSeek
Harness 的鲸尾，下方展示通用 Somnia 的月牙。两版使用相同的字体、流光和 42 分钟的
示例时长。可以直接截图，也可以使用合成对话录制当前插件。新录制应只包含用于演示的
界面和数据。 [中文示例](../examples/sleep-indicator.html#zh) · [English example](../examples/sleep-indicator.html)

测试覆盖和数据处理见[架构说明](architecture.md)。目前的评估主要覆盖召回、
来源和恢复等行为。介绍产品时，可以说清这些已验证的用途，也可以邀请用户
提供真实的长对话案例。
