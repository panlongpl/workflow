## Why

当前页面顶部有 Markdown 浏览、AI 终端、历史注释等入口，也支持把评论发送给 Agent，但用户在阅读或评论时无法一眼判断当前是否存在可接收任务的 Agent 会话。尤其在评论发送前，缺少明确的可用状态会导致用户需要手动切换到 AI 终端确认，增加打断和误操作成本。

## What Changes

- 在页面最上方新增一个 Agent 可用性状态展示区域，用于持续展示当前是否有可派发的 Agent。
- 当存在可用 Agent 时，展示绿色状态圆点和 Agent 名称，例如 `Codex 可用` 或 `Claude Code 可用`。
- 当没有可用 Agent、Agent 正在启动、连接断开或当前会话不可派发时，展示对应的非可用状态，避免用户误以为评论可以发送。
- 复用终端控制器已有的会话与派发可用性判断，避免顶部状态与真实派发能力不一致。
- 顶部状态仅作为状态提示，不自动切换视图、不自动启动 Agent，也不改变评论发送失败处理逻辑。

## Capabilities

### New Capabilities
- `agent-availability-indicator`: 展示当前 Agent 派发可用性，包括可用状态、Agent 名称、不可用原因和顶部状态提示交互。

### Modified Capabilities
- `annotation-agent-dispatch`: 评论发送前后可通过顶部状态了解当前是否存在可派发 Agent，但评论保存与发送语义不变。

## Impact

- `index.html`：新增顶部 Agent 状态展示区域。
- `src/app.js`：订阅或刷新终端会话可用状态，并驱动顶部状态渲染。
- `src/terminal.js`：必要时补充状态变更通知或状态快照接口，继续以终端控制器作为可派发性事实来源。
- `styles/*.css`：新增顶部状态圆点、名称和不同状态的视觉样式。
- 不新增后端 API，不改变 node-pty / WebSocket 协议。
