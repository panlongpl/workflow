# Agent 会话管理设计

## 目标

当前 Agent 终端模块只允许同时存在一个 PTY 会话（共享 hub），多人/多任务并行时不够用。本设计在不影响现有终端体验的前提下，加入多会话管理：允许同时存在多个 Agent 会话；可命名、删除、断开、重新连接；用户可指定一个主会话，所有外部派发（Bookmarklet 反馈、评论派发等）都发送到主会话。

## 核心约束

- 仅服务运行期内保留会话；Node 服务重启后所有会话清空。
- “断开连接”：当前页面 socket 取消订阅该会话，但 PTY 继续运行；下次可重新连接并回放历史输出。
- “删除会话”：杀掉 PTY 并从会话列表移除。
- 同一时间只能有一个主会话；首个新建的会话自动成为主会话。
- 主会话与“当前查看 Tab”解耦：用户可以在 Tab A 看会话，把 Tab B 设为主会话；外部派发始终发给主会话。
- Bookmarklet 反馈或其它派发，发送到的目标 = 主会话。无主会话或主会话已关闭 → 返回 409 “当前没有可用 Agent”。

## 架构

后端继续由 `lib/agent-server.mjs` 中的会话 hub 统一管理。前端在终端模块顶部加入 Tab 栏和会话状态条；终端区域仍然由 xterm 渲染，但只展示“当前查看会话”的输出。

```
浏览器 Tab 栏 ──> /api/agent WebSocket ──> AgentSessionHub
                                          ├─ Map<id, AgentSession{ pty, outputBuffer }>
                                          └─ primarySessionId

外部 HTTP 派发 (/api/bookmarklet-feedback)
            └─> agentServer.dispatchPrompt(prompt) → primarySession.write(prompt)
```

## 数据模型

```ts
type AgentSessionRecord = {
  id: string;            // 服务端生成，例如 "sess_<random>"
  name: string;          // 自动生成 "Codex #1"，可重命名
  agent: "codex" | "claude" | "custom";
  command: string;       // 自定义命令（仅 custom）
  cwd: string;
  status: "starting" | "running" | "closed" | "error";
  createdAt: number;     // ms
  pty: PtySession | null;
  outputBuffer: string[];// 单会话独立缓存，最多 4000 chunks
};

type Hub = {
  sessions: Map<string, AgentSessionRecord>;
  primarySessionId: string | null;
  clients: Map<WebSocket, { attachedSessionId: string | null }>;
};
```

每个 socket 客户端在 hub 上维护“当前 attach 的会话 id”。一个 socket 同一时间只 attach 一个会话；切换 Tab = detach 旧 id + attach 新 id。

## WebSocket 协议

路径：`/api/agent`。所有消息均为 JSON。

### 客户端 → 服务端

| type | payload | 说明 |
| --- | --- | --- |
| `list_sessions` | — | 请求当前会话列表快照 |
| `start_session` | `{ agent, command?, cwd?, cols?, rows? }` | 创建新会话；如果当前没有主会话，新会话自动设为主；新会话自动 attach 到该 socket |
| `attach_session` | `{ id }` | 该 socket 订阅指定会话；服务端回放 outputBuffer |
| `detach_session` | `{ id }` | 该 socket 取消订阅；PTY 继续运行 |
| `delete_session` | `{ id }` | 杀 PTY 并从 Map 移除；若删的是主会话且还有其它会话，hub 把列表第一个设为主 |
| `rename_session` | `{ id, name }` | 修改会话名称；前端做长度限制（1–24） |
| `set_primary_session` | `{ id }` | 把指定会话设为主会话 |
| `terminal_input` | `{ id?, data }` | 写入 PTY；省略 `id` 表示当前 attach 的会话 |
| `resize` | `{ id?, cols, rows }` | 调整 PTY 尺寸 |
| `interrupt` | `{ id? }` | 发送 `\x03`；省略 `id` 走当前 attach 会话 |

### 服务端 → 客户端

| type | payload | 说明 |
| --- | --- | --- |
| `connected` | — | 连接建立 |
| `sessions_list` | `{ sessions: SessionSummary[], primaryId }` | 完整会话快照；广播给所有 socket |
| `session_attached` | `{ id, agent, name, label, cwd, command, output, status }` | 回放 outputBuffer |
| `session_started` | `{ id, agent, name, ... }` | 创建成功；后端会紧跟一条 `sessions_list` 广播 |
| `terminal_output` | `{ id, data }` | 仅由 attach 了该 id 的客户端渲染 |
| `session_status` | `{ id, status, message? }` | 状态变化（启动中、运行中、已断开、错误） |
| `session_closed` | `{ id, reason, exitCode?, signal? }` | PTY 退出；hub 同步标记 status=closed，下一次 `delete_session` 才会从 Map 移除 |
| `error` | `{ id?, message }` | 通用错误 |

`SessionSummary = { id, name, agent, command, status, isPrimary, createdAt }`。

## 后端会话 hub 改造（lib/agent-server.mjs）

新增字段：`sessions: Map`、`primarySessionId`、`clients: Map<WebSocket, { attachedSessionId }>`。

关键函数：
- `createSession(message)` → 生成 id、自动名称（`{Codex|Claude|coco|Custom} #N`，N = 同 agent 当前序号 + 1），创建 PTY，写入 hub.sessions；若 `primarySessionId == null` 自动设为主。
- `deleteSession(id)` → 杀 PTY、`sessions.delete(id)`；若删除主会话，从剩余 sessions 取第一个作为新主（无剩余则 `primarySessionId = null`）；广播 `sessions_list`。
- `setPrimarySession(id)` → 校验存在 + 状态非 `closed/error`；写入 `primarySessionId`；广播 `sessions_list`。
- `attachClient(socket, id)` / `detachClient(socket, id)` → 维护 `clients` Map；attach 时回放 outputBuffer。
- `dispatchPrompt(prompt)` → 写入 `sessions.get(primarySessionId).pty`；如主会话不存在或 status 非 running，返回 `{ ok:false, reason:'no-agent' }`。

输出广播：每个会话 `child.onData` 时，向 `clients` 中 `attachedSessionId === sessionId` 的 socket 发送 `terminal_output { id, data }`，并写入该会话 `outputBuffer`。其它会话的 client 不接收这条数据。

## 前端 UI（src/terminal.js + 样式）

终端模块结构调整：

```
.agent-session-panel
├─ .agent-session-tabs           (顶部 Tab 栏)
│   ├─ .agent-session-tab[*]     (★ name · status dot · ×)
│   └─ .agent-session-tab-new    (+ 新建)
├─ .agent-session-statusbar       ("主会话：Codex #1 · 当前查看：Claude #2")
└─ .agent-terminal-card           (现有终端 mount，保持不变)
```

### Tab 行为

- 单击 Tab → 切到该会话：发送 `detach_session(oldId)` + `attach_session(newId)`；终端 `reset()` 后回放新会话 outputBuffer。
- 双击 Tab 名称 → 进入重命名 inline input；回车 = `rename_session`；Esc = 取消。
- 点击 Tab 上的 ★ / ☆ → `set_primary_session(id)`；星标更新；不切换当前查看 Tab。
- 点击 Tab 的 `×` → 弹确认（“删除该会话会终止其 Agent 进程，确定？”），确认后 `delete_session(id)`；若删的是当前查看 Tab，前端切到主会话或第一个剩余会话。
- 状态点颜色：绿色 running / 橙色 starting / 灰色 closed / 红色 error。
- `+ 新建` 按钮 → 复用现有 `agent-start-panel` 选择 UI 弹层；选择后 `start_session`；新会话自动成为当前查看 Tab。

### Tab 右侧菜单（⋯ 按钮）

- 设为主会话
- 重命名
- 断开连接（仅 status=running 时可用）→ `detach_session`，本地状态切到 “已断开（PTY 仍运行）”
- 重新连接（仅本地标记为断开时可用）→ `attach_session`
- 删除会话

### 状态条文案

- 主会话存在：`主会话：{name}（{status}） · 当前查看：{name2}`
- 主会话不存在：`无主会话 · 当前查看：{name}`
- 完全无会话：`暂无 Agent 会话，点击右上角 “新建会话”`

### 派发提示

发送按钮 tooltip：
- 当前查看 Tab == 主会话：`将发送到 {主会话名称}`
- 解耦时：`将发送到主会话 {主会话名称}（当前查看 {当前 Tab 名称}）`

## HTTP API 影响

- `/api/agent-status`（Bookmarklet 用）返回 `{ ok, primary: { id, name, agent, status } | null }`；`ok = primarySession?.status === 'running'`。
- `/api/bookmarklet-feedback` 派发逻辑改成 `agentServer.dispatchPrompt(prompt)` 走主会话；其余响应结构保持不变。

## 持久化

服务运行期内保留：sessions Map 不持久化到磁盘，Node 服务重启后清空。

前端 `localStorage`：仅记录 `lastAttachedSessionId`，刷新页面或新开 Tab 时尝试 `attach_session`，失败回退到主会话或第一个会话。

## 错误处理

| 场景 | 行为 |
| --- | --- |
| `start_session` 启动 PTY 失败 | 不写入 sessions Map；socket 收到 `error`；不影响其它会话 |
| 派发到主会话但其状态 ≠ running | dispatchPrompt 返回 `{ ok:false, reason:'no-agent' }`；前端弹 toast |
| `attach_session` 时 id 不存在 | 服务端回 `error { id, message:'session not found' }`；前端切回主会话 |
| 主会话 PTY 自动退出 | hub 广播 `session_closed { id }`；hub 不会自动选新主，由用户决定（避免误派发到其它任务） |
| 同时多个 socket attach 同一会话 | 都接收 `terminal_output`；都可以输入；这就是“多 Tab 共享同一会话”体验 |

## 测试策略

- 单测：`createAgentSessionHub` 的 createSession / deleteSession / setPrimarySession / dispatchPrompt 四组分支（Node 内 jest-style 子进程或纯逻辑测试）。
- 行为验证脚本：`node --input-type=module -e "..."` 直接 import hub，模拟 socket 发消息，断言 sessions_list 广播内容。
- 手测脚本：
  1. 启动两个 Codex 会话 + 一个 custom 会话；
  2. 切换主会话，触发 Bookmarklet 反馈，确认终端里收到的是主会话；
  3. 断开 Tab B，重连 Tab B，确认 outputBuffer 回放；
  4. 删除主会话，确认 hub 重新选主；
  5. Node 服务重启，确认 sessions 清空。

## 范围之外（YAGNI）

- 跨 Node 进程重启的会话恢复
- 会话权限/多用户隔离
- 主题/字体可视化定制
- 主会话自动选举策略（PTY 自然退出后）：本期不自动选主，避免派发误指
