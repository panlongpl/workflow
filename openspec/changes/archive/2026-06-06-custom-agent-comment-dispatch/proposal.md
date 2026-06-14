## Why

当前自定义 Agent 会话虽然可以在 AI 终端中启动并交互，但评论派发能力仍只允许 Codex / Claude，导致用户使用自定义 Agent 时无法从评论抽屉或历史注释直接发送任务。同时顶部 Agent 状态也会把运行中的自定义 Agent 显示为不可派发，和用户期望不一致。

## What Changes

- 允许运行中且连接正常的自定义 Agent 接收评论派发 prompt。
- 自定义 Agent 启动成功后，顶部 Agent 状态同步显示为可用，并展示自定义 Agent 名称或可识别的启动命令摘要。
- 评论抽屉“发送给 Agent”、自动发送、历史单条发送、历史批量发送均复用同一派发能力，不需要为 custom 单独实现发送路径。
- 保留现有保存优先语义：保存成功后再派发，派发失败不回滚本地评论记录。
- 保留空 prompt、无会话、启动中、连接断开等不可派发状态的校验和反馈。
- 不新增后台队列，不尝试判断自定义 Agent 是否真正理解任务，仅在用户显式启动自定义 Agent 后允许向其写入结构化评论 prompt。

## Capabilities

### New Capabilities

### Modified Capabilities
- `annotation-agent-dispatch`: 将自定义 Agent 纳入评论派发支持范围，使运行中且连接正常的 custom 会话可以接收单条和批量评论 prompt。
- `agent-availability-indicator`: 顶部 Agent 状态需要把可派发的自定义 Agent 同步显示为可用状态，而不是不可派发。

## Impact

- `src/terminal.js`：调整派发可用性判断和状态快照，让 custom 会话在运行且 socket 正常时可派发；保存自定义命令摘要用于状态展示。
- `src/app.js`：原则上继续消费终端控制器状态与派发结果，不新增独立 custom 分支。
- `styles/*.css`：若状态文本更长，必要时微调顶部状态展示的截断或 title。
- 不修改后端协议、不新增 API、不改变评论存储结构。
