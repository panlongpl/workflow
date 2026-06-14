## Context

项目当前已经有独立的 Markdown 浏览区和 AI 终端区，评论发送功能通过前端调用 `terminalController.dispatchPrompt()`，由终端控制器基于会话状态、Agent 类型和 WebSocket 连接判断是否可派发。用户截图中顶部工具栏存在一个空白区域，适合放置轻量状态提示，但目前没有常驻入口告诉用户当前是否有可用 Agent。

本变更需要把“可用 Agent”状态从终端内部信息提升为页面顶层可见信息，同时保持终端控制器作为唯一事实来源，避免 UI 状态与真实可派发能力不一致。

## Goals / Non-Goals

**Goals:**

- 在页面最上方展示当前 Agent 派发可用性。
- 可用时以绿色圆点和 Agent 名称表达状态，例如 `Codex 可用`。
- 不可用时显示明确但不喧宾夺主的状态，例如 `无可用 Agent`、`Agent 启动中`、`当前会话不可派发`。
- 状态变化应跟随终端会话启动、运行、断开、关闭、重启和 Agent 类型变化实时刷新。
- 状态展示应可访问，不能只依赖颜色传达语义。

**Non-Goals:**

- 不自动启动 Agent。
- 不改变评论保存、自动发送或历史批量发送语义。
- 不实现 Agent 忙闲检测，也不判断 Agent 是否正在处理上一条任务。
- 不新增后端 API 或修改 PTY/WebSocket 协议。
- 不把自定义命令默认视为可派发 Agent。

## Decisions

### 1. 顶部状态以终端控制器的可派发性为事实来源

状态展示不直接读取 socket 或内部变量，而是复用 `canDispatchToAgent()` 的结果，必要时由终端控制器暴露 `getDispatchStatus()` 或 `onStatusChange` 回调。

原因：评论发送已经依赖同一判断逻辑，顶部显示必须与真实发送能力一致。替代方案是在 `app.js` 中重复判断 `sessionState`、`selectedAgent` 和 socket 状态，但这会造成逻辑漂移。

### 2. 使用小型状态胶囊放在顶部工具栏空白区域

状态区域采用紧凑 pill/capsule 样式：圆点 + 文案 + 可选 title。绿色表示可用，灰色表示无会话，黄色表示启动中，红色或橙色表示连接不可用/会话不可派发。

原因：用户截图里顶部有明显空白区域，状态提示应该常驻但不抢占主要操作按钮。替代方案是放入 AI 终端按钮附近，但 Markdown 阅读时用户的视线主要在顶部工具区，独立状态更清晰。

### 3. 终端状态变更时主动通知 app 渲染

终端控制器在 `session_started`、`session_closed`、socket `close/error`、`restartSession()`、`closeSession()`、`startSession()` 等关键路径触发状态回调。`app.js` 负责调用统一的 `renderAgentAvailability()` 更新 DOM。

原因：仅在切换页面或发送评论时刷新会导致状态滞后。替代方案是定时轮询，但没有必要且会增加无意义刷新。

### 4. 状态组件不执行强交互

第一版状态组件仅展示信息，不点击切换、不打开终端、不启动 Agent。后续如需要，可再加“点击查看终端”。

原因：本次需求重点是“显示当前是否可用和名字”，状态组件承担提示职责即可，避免引入额外交互语义。

## Risks / Trade-offs

- [Risk] WebSocket 异常关闭时如果没有同步更新 `sessionState`，顶部状态可能短暂显示过期状态。→ Mitigation：在 socket `close/error` 路径触发状态刷新，并让可派发判断同时检查 socket open 状态。
- [Risk] 只用绿色圆点表达可用对色弱用户不友好。→ Mitigation：圆点旁必须展示文本，例如 `Codex 可用`，并补充 `aria-label` / `title`。
- [Risk] 自定义命令可能实际上是 Agent，但默认显示不可派发。→ Mitigation：保持与现有评论派发策略一致，第一版不为 custom 增加 allowlist。
- [Risk] 顶部工具栏空间不足时挤压现有按钮。→ Mitigation：使用紧凑样式，并在响应式布局中允许换行或缩短文案。
