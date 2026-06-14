## Context

当前评论派发链路已经集中在前端终端控制器：评论抽屉和历史注释会调用 `terminalController.dispatchPrompt()`，而 `dispatchPrompt()` 依赖 `canDispatchToAgent()` 判断当前会话是否可派发。现状中 `canDispatchToAgent()` 只允许 `codex` 和 `claude`，因此运行中的 `custom` 会话会被返回为 `unsupported-agent`，顶部 Agent 状态也会同步显示为不可派发。

用户希望自定义 Agent 也能接收评论任务，同时顶部可用状态要同步反映该能力。由于自定义 Agent 是用户显式输入命令启动的交互会话，本次变更将其纳入可派发范围，但仍保留连接状态、启动状态和空输入等基础校验。

## Goals / Non-Goals

**Goals:**

- 让运行中且 WebSocket 连接正常的自定义 Agent 支持评论 prompt 派发。
- 让评论抽屉、自动发送、历史单条发送、历史批量发送无需新增分支即可使用 custom 派发能力。
- 让顶部 Agent 状态在 custom 可派发时显示可用，并展示“自定义 Agent”或自定义命令摘要。
- 继续保持无会话、启动中、断开、空 prompt 等失败状态的明确反馈。

**Non-Goals:**

- 不校验自定义命令是否真实为 AI Agent。
- 不新增 custom allowlist、黑名单或二次确认弹窗。
- 不改变 PTY/WebSocket 后端协议。
- 不改变评论保存优先、发送失败不回滚的语义。
- 不实现 Agent 忙闲检测或任务完成检测。

## Decisions

### 1. 将 custom 纳入终端控制器的可派发 Agent 集合

`canDispatchToAgent()` 继续作为唯一派发事实来源，但支持集合从 `codex / claude` 扩展为 `codex / claude / custom`。判断顺序保持不变：必须有会话、非 starting、状态为 running、socket open，然后再返回可派发。

原因：评论发送、历史发送和顶部状态都已经依赖该函数，最小改动即可同步所有入口。替代方案是在 app 层对 custom 单独放行，但会导致状态展示和真实派发校验分裂。

### 2. 自定义 Agent 状态显示复用现有名称，必要时附带命令摘要

终端控制器在启动 custom 时保存用户输入的命令，并在状态快照中提供 label，例如 `自定义 Agent` 或 `自定义 Agent · coco`。顶部状态使用同一 label 展示 `自定义 Agent 可用`，title 可展示完整命令，便于用户确认当前会话。

原因：用户需要看到“其名字”，但完整命令可能过长，不适合直接放在顶部。替代方案是只显示固定 `自定义 Agent`，实现更简单但信息量不足。

### 3. 不新增安全确认，遵循“用户显式启动即允许派发”

一旦用户通过自定义表单启动命令并进入运行状态，系统视为用户希望该交互程序接收输入。评论派发只是写入同一个 PTY，与用户手动在终端输入 prompt 等价。

原因：本次需求明确希望 custom 支持发送评论。替代方案是增加“允许评论派发”复选框，但会增加操作复杂度，并偏离当前请求。

## Risks / Trade-offs

- [Risk] 用户启动的 custom 命令不是 AI Agent，评论 prompt 可能被写入普通 shell。→ Mitigation：仅对用户显式启动且运行中的 custom 放行，顶部明确显示 custom 名称；后续如需要可增加 opt-in 开关。
- [Risk] 自定义命令过长导致顶部状态拥挤。→ Mitigation：顶部显示短 label，完整命令放入 title 或状态详情中。
- [Risk] custom 会话刚断开时状态短暂不一致。→ Mitigation：继续依赖 socket open 校验，并在 close/error/session_closed 时触发状态刷新。
- [Risk] Agent 忙时被插入新评论 prompt。→ Mitigation：保持现有第一版策略，不做忙闲检测；用户可通过终端观察。
