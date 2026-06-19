# Agent 会话管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Workflow 终端模块支持多个 Agent 会话，可命名 / 删除 / 断开 / 重连，并通过显式“主会话”决定外部派发目标。

**Architecture:** `lib/agent-server.mjs` 中的 hub 从单 active session 改造成 `Map<id, sessionRecord>`，每个 socket 客户端只 attach 其中一个；外部 `dispatchPrompt` 始终发往 `primarySessionId`。前端 `src/terminal.js` 在终端卡片顶部加入 Tab 栏（顶部 Tab 视图），通过新的 WebSocket 协议 list/start/attach/detach/delete/rename/set_primary 操作多个会话；样式新增到 `styles/terminal.css`。

**Tech Stack:** Node.js (`ws`、`node-pty`、`crypto.randomUUID`)、原生 ES Modules 前端、`xterm.js` v6。

---

## File Structure

| 文件 | 责任 |
| --- | --- |
| `lib/agent-server.mjs` | 改造 hub 为多会话，重写 socket 消息分发；新增 `getDispatchStatus()` / `dispatchPrompt()` 走主会话 |
| `server.mjs` | 仅 `/api/agent-status` 返回结构略调整（新增 `primary` 字段）；其它无改动 |
| `src/terminal.js` | 新增 Tab 栏渲染、会话状态机、attach/detach 切换、状态条；保留 xterm 渲染逻辑 |
| `styles/terminal.css` | 顶部 Tab 栏 / 状态条样式 |
| `lib/__tests__/agent-session-hub.test.mjs`（新增） | 纯逻辑单测（不启动 PTY） |

`docs/superpowers/specs/2026-06-16-agent-session-manager-design.md` 是本计划的 spec，不在改动范围。

---

## Task 1: 准备 hub 单元测试基础设施

**Files:**
- Create: `lib/__tests__/agent-session-hub.test.mjs`
- Modify: `package.json`（新增 `test:hub` 脚本）

- [ ] **Step 1: 在 package.json 新增脚本**

```json
{
  "scripts": {
    "start": "node server.mjs",
    "test:hub": "node --test lib/__tests__/agent-session-hub.test.mjs"
  }
}
```

- [ ] **Step 2: 创建空测试文件占位**

```js
// lib/__tests__/agent-session-hub.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

test("placeholder", () => {
  assert.equal(1, 1);
});
```

- [ ] **Step 3: 运行测试确认基础设施可用**

Run: `npm run test:hub`
Expected: `pass 1`

- [ ] **Step 4: Commit**

```bash
git add package.json lib/__tests__/agent-session-hub.test.mjs
git commit -m "test(agent-server): add hub test scaffold"
```

---

## Task 2: 抽取可注入 PTY 工厂的 hub 工厂函数

需要把 `createAgentSessionHub` 拿出来作为可单测的纯逻辑模块（不依赖 node-pty）。注入一个 `ptyFactory(message)` 钩子，单测里替换为 fake PTY。

**Files:**
- Modify: `lib/agent-server.mjs`

- [ ] **Step 1: 写失败测试：hub 应支持注入 ptyFactory 并创建多个会话**

```js
// lib/__tests__/agent-session-hub.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createAgentSessionHub } from "../agent-server.mjs";

function fakePtyFactory() {
  return {
    agent: "codex",
    label: "Codex",
    cwd: "/tmp",
    command: "codex",
    closed: false,
    write() {},
    resize() {},
    kill() { this.closed = true; },
  };
}

test("createSession 创建独立会话并自动设为主会话", async () => {
  const hub = createAgentSessionHub({ ptyFactory: fakePtyFactory });
  const session = await hub.createSession({ agent: "codex" });
  assert.equal(session.agent, "codex");
  assert.match(session.id, /^sess_/);
  assert.equal(session.name, "Codex #1");
  assert.equal(hub.getPrimarySessionId(), session.id);
  assert.equal(hub.listSessions().length, 1);
});
```

- [ ] **Step 2: 运行测试**

Run: `npm run test:hub`
Expected: FAIL（`createAgentSessionHub` 未导出 / `createSession` 不存在）

- [ ] **Step 3: 在 `lib/agent-server.mjs` 重写 hub**

```js
// 替换原 createAgentSessionHub 实现
export function createAgentSessionHub({ ptyFactory } = {}) {
  const sessions = new Map();
  const clients = new Map(); // socket -> { attachedSessionId }
  let primarySessionId = null;
  const sequence = { codex: 0, claude: 0, custom: 0 };

  function autoName(agent) {
    sequence[agent] = (sequence[agent] || 0) + 1;
    const label = agent === "codex" ? "Codex" : agent === "claude" ? "Claude" : "Custom";
    return `${label} #${sequence[agent]}`;
  }

  async function createSession(message) {
    const factory = ptyFactory ?? defaultPtyFactory;
    const pty = await factory(message);
    if (!pty) return null;

    const id = `sess_${Math.random().toString(36).slice(2, 10)}`;
    const record = {
      id,
      name: autoName(pty.agent),
      agent: pty.agent,
      label: pty.label,
      command: pty.command,
      cwd: pty.cwd,
      status: "running",
      createdAt: Date.now(),
      pty,
      outputBuffer: [],
    };
    sessions.set(id, record);
    if (!primarySessionId) primarySessionId = id;
    return record;
  }

  function listSessions() {
    return Array.from(sessions.values()).map((s) => summarize(s, primarySessionId));
  }

  function getPrimarySessionId() {
    return primarySessionId;
  }

  function getSession(id) {
    return sessions.get(id) || null;
  }

  return {
    createSession,
    listSessions,
    getSession,
    getPrimarySessionId,
    sessions,
    clients,
    setPrimarySessionId(id) {
      if (!sessions.has(id)) return false;
      primarySessionId = id;
      return true;
    },
    deleteSession(id) {
      const session = sessions.get(id);
      if (!session) return false;
      session.pty.kill?.("deleted");
      sessions.delete(id);
      if (primarySessionId === id) {
        const next = sessions.values().next().value;
        primarySessionId = next ? next.id : null;
      }
      return true;
    },
    renameSession(id, name) {
      const session = sessions.get(id);
      if (!session) return false;
      session.name = String(name || "").slice(0, 24).trim() || session.name;
      return true;
    },
    closeAll(reason = "stopped") {
      for (const session of sessions.values()) session.pty.kill?.(reason, { silent: true });
      sessions.clear();
      primarySessionId = null;
    },
  };
}

function summarize(session, primaryId) {
  return {
    id: session.id,
    name: session.name,
    agent: session.agent,
    command: session.command,
    status: session.status,
    isPrimary: session.id === primaryId,
    createdAt: session.createdAt,
  };
}

async function defaultPtyFactory() {
  throw new Error("ptyFactory not configured");
}
```

确保 `createAgentServer` 调用方式更新：

```js
// 在 createAgentServer 中
const hub = createAgentSessionHub({
  ptyFactory: (message) => startAgentSession(message, appRoot, makeSessionHooks(socketServer)),
});
```

注意 `makeSessionHooks` 仍要在 server 文件中实现，本任务先让 hub 工厂函数存在并通过单测；下一任务接 PTY。

- [ ] **Step 4: 运行测试**

Run: `npm run test:hub`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/agent-server.mjs lib/__tests__/agent-session-hub.test.mjs
git commit -m "feat(agent-server): hub now manages multi-session map"
```

---

## Task 3: 主会话切换 + 删除 + 自动选主行为单测

**Files:**
- Modify: `lib/__tests__/agent-session-hub.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
test("setPrimarySessionId 在删除主会话后选下一个", async () => {
  const hub = createAgentSessionHub({ ptyFactory: fakePtyFactory });
  const a = await hub.createSession({ agent: "codex" });
  const b = await hub.createSession({ agent: "claude" });
  assert.equal(hub.getPrimarySessionId(), a.id);

  hub.setPrimarySessionId(b.id);
  assert.equal(hub.getPrimarySessionId(), b.id);

  hub.deleteSession(b.id);
  assert.equal(hub.getPrimarySessionId(), a.id);

  hub.deleteSession(a.id);
  assert.equal(hub.getPrimarySessionId(), null);
});

test("renameSession 限长", async () => {
  const hub = createAgentSessionHub({ ptyFactory: fakePtyFactory });
  const session = await hub.createSession({ agent: "codex" });
  hub.renameSession(session.id, "x".repeat(50));
  assert.equal(hub.getSession(session.id).name.length, 24);
});
```

- [ ] **Step 2: 运行测试**

Run: `npm run test:hub`
Expected: PASS（Task 2 已实现这些方法，本任务确认覆盖）

- [ ] **Step 3: Commit**

```bash
git add lib/__tests__/agent-session-hub.test.mjs
git commit -m "test(agent-server): cover primary session transitions"
```

---

## Task 4: hub 内置广播 + 输出缓存

**Files:**
- Modify: `lib/agent-server.mjs`
- Modify: `lib/__tests__/agent-session-hub.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
test("会话输出广播到 attach 该会话的客户端，并写入 outputBuffer", async () => {
  const hub = createAgentSessionHub({ ptyFactory: fakePtyFactory });
  const session = await hub.createSession({ agent: "codex" });

  const sentA = [];
  const sentB = [];
  const clientA = { send: (msg) => sentA.push(JSON.parse(msg)) };
  const clientB = { send: (msg) => sentB.push(JSON.parse(msg)) };

  hub.addClient(clientA);
  hub.addClient(clientB);
  hub.attachClient(clientA, session.id);

  hub.emitOutput(session.id, "hello");
  assert.deepEqual(sentA.at(-1), { type: "terminal_output", id: session.id, data: "hello" });
  assert.equal(sentB.find((m) => m.type === "terminal_output"), undefined);
  assert.equal(hub.getOutputSnapshot(session.id), "hello");
});
```

- [ ] **Step 2: 运行测试**

Run: `npm run test:hub`
Expected: FAIL（`addClient/attachClient/emitOutput/getOutputSnapshot` 不存在）

- [ ] **Step 3: 在 hub 工厂里实现这些方法**

在 `createAgentSessionHub` return 对象上加：

```js
addClient(socket) {
  if (!clients.has(socket)) clients.set(socket, { attachedSessionId: null });
},
removeClient(socket) {
  clients.delete(socket);
},
attachClient(socket, id) {
  if (!sessions.has(id)) return false;
  if (!clients.has(socket)) clients.set(socket, { attachedSessionId: null });
  clients.get(socket).attachedSessionId = id;
  return true;
},
detachClient(socket, id) {
  const state = clients.get(socket);
  if (!state) return false;
  if (id && state.attachedSessionId !== id) return false;
  state.attachedSessionId = null;
  return true;
},
emitOutput(id, data) {
  const session = sessions.get(id);
  if (!session) return;
  pushOutput(session.outputBuffer, data);
  for (const [socket, state] of clients) {
    if (state.attachedSessionId === id) {
      sendMessage(socket, { type: "terminal_output", id, data });
    }
  }
},
getOutputSnapshot(id) {
  const session = sessions.get(id);
  return session ? session.outputBuffer.join("") : "";
},
broadcast(message) {
  for (const socket of clients.keys()) sendMessage(socket, message);
},
```

`pushOutput` / `sendMessage` 已在文件中存在，沿用即可。

- [ ] **Step 4: 运行测试**

Run: `npm run test:hub`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/agent-server.mjs lib/__tests__/agent-session-hub.test.mjs
git commit -m "feat(agent-server): per-session output buffer + targeted broadcast"
```

---

## Task 5: dispatchPrompt 走主会话 + 状态查询

**Files:**
- Modify: `lib/agent-server.mjs`
- Modify: `lib/__tests__/agent-session-hub.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
test("dispatchPrompt 写入主会话 PTY", async () => {
  const writes = [];
  const factory = (message) => ({
    agent: message.agent,
    label: message.agent,
    cwd: "/tmp",
    command: "",
    closed: false,
    write(data) { writes.push({ id: this._id, data }); },
    resize() {},
    kill() {},
  });
  const hub = createAgentSessionHub({ ptyFactory: factory });
  const a = await hub.createSession({ agent: "codex" });
  a.pty._id = a.id;
  const b = await hub.createSession({ agent: "claude" });
  b.pty._id = b.id;
  hub.setPrimarySessionId(b.id);

  const result = hub.dispatchPrompt("hello");
  assert.equal(result.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].id, b.id);
  assert.equal(writes[0].data, "hello\r");
});

test("dispatchPrompt 在主会话不存在时返回 no-agent", () => {
  const hub = createAgentSessionHub({ ptyFactory: fakePtyFactory });
  const result = hub.dispatchPrompt("hi");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-agent");
});
```

- [ ] **Step 2: 运行测试**

Run: `npm run test:hub`
Expected: FAIL

- [ ] **Step 3: 在 hub 工厂上实现 dispatchPrompt + getDispatchStatus**

```js
dispatchPrompt(prompt) {
  const session = primarySessionId ? sessions.get(primarySessionId) : null;
  if (!session || session.status !== "running") {
    return { ok: false, reason: "no-agent", message: "当前没有可用 Agent" };
  }
  const text = String(prompt || "").trim();
  if (!text) {
    return { ok: false, reason: "empty-prompt", message: "发送内容为空" };
  }
  session.pty.write(`${text}\r`);
  return { ok: true, agent: session.agent, label: session.label, id: session.id };
},
getDispatchStatus() {
  const session = primarySessionId ? sessions.get(primarySessionId) : null;
  if (!session) return { ok: false, reason: "no-session", message: "当前没有主会话" };
  if (session.status !== "running") return { ok: false, reason: "closed", message: "主会话不可用" };
  return {
    ok: true,
    status: "running",
    agent: session.agent,
    label: session.label,
    primary: { id: session.id, name: session.name, agent: session.agent, status: session.status },
  };
},
```

更新 `createAgentServer` return：删掉旧 `getDispatchStatus/dispatchPrompt`，改成转发：

```js
return {
  handleUpgrade(...args) { /* 不变 */ },
  close() { hub.closeAll("server_closed"); socketServer.close(); },
  getDispatchStatus: () => hub.getDispatchStatus(),
  dispatchPrompt: (prompt) => hub.dispatchPrompt(prompt),
};
```

- [ ] **Step 4: 运行测试**

Run: `npm run test:hub`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/agent-server.mjs lib/__tests__/agent-session-hub.test.mjs
git commit -m "feat(agent-server): dispatchPrompt routes to primary session"
```

---

## Task 6: 重写 socket 消息处理（list/start/attach/detach/delete/rename/set_primary）

**Files:**
- Modify: `lib/agent-server.mjs`

- [ ] **Step 1: 改写 `openAgentSocket` 内的消息分支**

把整段 `socket.on("message", ...)` 替换为：

```js
socket.on("message", async (raw) => {
  let message;
  try { message = JSON.parse(raw.toString()); }
  catch { sendMessage(socket, { type: "error", message: "消息格式无效" }); return; }

  if (message.type === "list_sessions") {
    sendMessage(socket, { type: "sessions_list", sessions: hub.listSessions(), primaryId: hub.getPrimarySessionId() });
    return;
  }

  if (message.type === "start_session") {
    const created = await createSessionFromMessage(message, appRoot, hub);
    if (!created) {
      sendMessage(socket, { type: "error", message: "Agent 启动失败" });
      return;
    }
    hub.attachClient(socket, created.id);
    sendMessage(socket, { type: "session_started", ...summarizeRecord(created, hub) });
    hub.broadcast({ type: "sessions_list", sessions: hub.listSessions(), primaryId: hub.getPrimarySessionId() });
    return;
  }

  if (message.type === "attach_session") {
    const session = hub.getSession(String(message.id || ""));
    if (!session) { sendMessage(socket, { type: "error", id: message.id, message: "会话不存在" }); return; }
    hub.attachClient(socket, session.id);
    sendMessage(socket, {
      type: "session_attached",
      ...summarizeRecord(session, hub),
      output: hub.getOutputSnapshot(session.id),
    });
    return;
  }

  if (message.type === "detach_session") {
    hub.detachClient(socket, String(message.id || ""));
    return;
  }

  if (message.type === "delete_session") {
    const id = String(message.id || "");
    if (hub.deleteSession(id)) {
      hub.broadcast({ type: "session_closed", id, reason: "deleted" });
      hub.broadcast({ type: "sessions_list", sessions: hub.listSessions(), primaryId: hub.getPrimarySessionId() });
    }
    return;
  }

  if (message.type === "rename_session") {
    if (hub.renameSession(String(message.id || ""), String(message.name || ""))) {
      hub.broadcast({ type: "sessions_list", sessions: hub.listSessions(), primaryId: hub.getPrimarySessionId() });
    }
    return;
  }

  if (message.type === "set_primary_session") {
    if (hub.setPrimarySessionId(String(message.id || ""))) {
      hub.broadcast({ type: "sessions_list", sessions: hub.listSessions(), primaryId: hub.getPrimarySessionId() });
    }
    return;
  }

  if (message.type === "terminal_input") {
    const session = resolveTargetSession(hub, socket, message.id);
    if (!session) return;
    session.pty.write(String(message.data || ""));
    return;
  }

  if (message.type === "resize") {
    const session = resolveTargetSession(hub, socket, message.id);
    if (!session) return;
    const cols = clampDimension(message.cols, defaultCols, 40, 300);
    const rows = clampDimension(message.rows, defaultRows, 12, 120);
    session.pty.resize(cols, rows);
    return;
  }

  if (message.type === "interrupt") {
    const session = resolveTargetSession(hub, socket, message.id);
    if (!session) return;
    session.pty.write("\x03");
  }
});
```

新增辅助函数（同文件）：

```js
function resolveTargetSession(hub, socket, explicitId) {
  if (explicitId) return hub.getSession(String(explicitId));
  const state = hub.clients.get(socket);
  if (!state || !state.attachedSessionId) return null;
  return hub.getSession(state.attachedSessionId);
}

function summarizeRecord(record, hub) {
  return {
    id: record.id,
    name: record.name,
    agent: record.agent,
    label: record.label,
    cwd: record.cwd,
    command: record.command,
    status: record.status,
    isPrimary: record.id === hub.getPrimarySessionId(),
  };
}

async function createSessionFromMessage(message, appRoot, hub) {
  const session = await hub.createSession(message);
  if (!session) return null;
  // 把 PTY 输出回路接到 hub.emitOutput
  session.pty.onOutput = (data) => hub.emitOutput(session.id, data);
  session.pty.onClose = (reason, details = {}) => {
    session.status = "closed";
    hub.broadcast({ type: "session_closed", id: session.id, reason, ...details });
    hub.broadcast({ type: "sessions_list", sessions: hub.listSessions(), primaryId: hub.getPrimarySessionId() });
  };
  session.pty.onError = (error) => {
    session.status = "error";
    hub.broadcast({ type: "error", id: session.id, message: error });
  };
  return session;
}
```

- [ ] **Step 2: 把 `startAgentSession` 改造成 hub 用的 PTY 工厂**

```js
async function ptyFactoryFromMessage(message, appRoot) {
  const agentKey = String(message.agent || "");
  const agent = agents[agentKey];
  if (!agent) return null;
  const customCommand = String(message.command || "").trim();
  if (agentKey === "custom" && !customCommand) return null;

  const cwd = await resolveAgentCwd(message.cwd, appRoot);
  const cols = clampDimension(message.cols, defaultCols, 40, 300);
  const rows = clampDimension(message.rows, defaultRows, 12, 120);
  const launch = createAgentLaunch(agentKey, agent, cwd, customCommand);

  const pty = await loadNodePty();
  const child = pty.spawn(launch.command, launch.args, {
    name: "xterm-256color", cols, rows, cwd, env: createAgentEnv(cwd),
  });

  let closed = false;
  const handlers = { onOutput: null, onClose: null, onError: null };

  const session = {
    agent: agentKey,
    label: agent.label,
    cwd,
    command: launch.displayCommand,
    get closed() { return closed; },
    write(data) { if (!closed) child.write(data); },
    resize(cols, rows) { if (!closed) child.resize(cols, rows); },
    kill(reason = "stopped", options = {}) {
      if (closed) return;
      try { child.kill(); }
      finally { closed = true; handlers.onClose?.(reason, options); }
    },
    set onOutput(fn) { handlers.onOutput = fn; },
    set onClose(fn) { handlers.onClose = fn; },
    set onError(fn) { handlers.onError = fn; },
  };

  child.onData((data) => { if (data) handlers.onOutput?.(data); });
  child.onExit(({ exitCode, signal }) => {
    if (closed) return;
    closed = true;
    handlers.onClose?.("exited", { exitCode, signal });
  });

  return session;
}
```

`createAgentServer` 把 `ptyFactory` 接进 hub：

```js
const hub = createAgentSessionHub({ ptyFactory: (message) => ptyFactoryFromMessage(message, appRoot) });
```

注意：原 `startAgentSession` 函数整体替换为上面的 `ptyFactoryFromMessage`。删除旧实现里给 socket 直接 send 的代码——所有 send 现在都走 hub 内的 broadcast/emitOutput。

- [ ] **Step 3: 启动服务做端到端冒烟**

Run: `node --check lib/agent-server.mjs && node --check server.mjs`
Expected: 无报错。

Run: `node server.mjs &` 然后 `curl -s http://localhost:4173/api/agent-status` 返回包含 `"ok":false` 的 JSON（因为没有主会话）。

- [ ] **Step 4: Commit**

```bash
git add lib/agent-server.mjs
git commit -m "feat(agent-server): multi-session websocket protocol"
```

---

## Task 7: `/api/agent-status` 返回 primary 字段 + Bookmarklet 派发回归冒烟

**Files:**
- Modify: `server.mjs`
- 现有 `/api/bookmarklet-feedback` 已经走 `agentServer.dispatchPrompt`，无需改

- [ ] **Step 1: 看现有 `/api/agent-status` 返回值**

`server.mjs:144` 的 `handleAgentStatus` 直接 `sendCorsJson(response, 200, agentServer.getDispatchStatus())`。Task 5 已让 `getDispatchStatus` 在有主会话时带 `primary` 字段，本任务无代码改动，仅冒烟。

- [ ] **Step 2: 冒烟脚本**

```bash
node server.mjs &
SERVER_PID=$!
sleep 1
TOKEN=$(curl -sS http://localhost:4173/api/bookmarklet-config | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token")
curl -sS -H "x-workflow-bookmarklet-token: $TOKEN" http://localhost:4173/api/agent-status
kill $SERVER_PID
```

Expected：响应是 `{"ok":false,"reason":"no-session","message":"当前没有主会话"}`。

- [ ] **Step 3: Commit（如有改动；如无改动跳过 commit）**

```bash
git status
# 若无改动，无需提交
```

---

## Task 8: 前端 Tab 栏 DOM + 样式

**Files:**
- Modify: `src/terminal.js`
- Modify: `styles/terminal.css`

- [ ] **Step 1: 在 `createPage()` 模板顶部加入 Tab 容器**

```html
<section class="agent-session-panel" data-agent-session hidden>
  <div class="agent-session-tabs" data-agent-session-tabs></div>
  <div class="agent-session-statusbar" data-agent-session-statusbar></div>
  <div class="agent-terminal-card">
    <div class="agent-terminal-mount" data-terminal-mount>
      <div class="agent-coco-caret" data-coco-caret hidden></div>
    </div>
  </div>
</section>
```

`createPage()` 内增加：

```js
const tabsBar = element.querySelector("[data-agent-session-tabs]");
const statusBar = element.querySelector("[data-agent-session-statusbar]");
```

把它们闭包到 `createTerminalController` 顶层 `let tabsBar = null; let statusBar = null;` 并赋值。

- [ ] **Step 2: 在 `styles/terminal.css` 末尾追加样式**

```css
.agent-session-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: rgba(7, 23, 36, 0.92);
  border-bottom: 1px solid rgba(125, 182, 216, 0.15);
  overflow-x: auto;
}

.agent-session-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(125, 182, 216, 0.3);
  border-radius: 999px;
  background: rgba(7, 23, 36, 0.6);
  color: #dcebf2;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.agent-session-tab.is-active {
  background: #2a6f97;
  border-color: #4a9cc6;
  color: #fff;
}

.agent-session-tab .tab-star { cursor: pointer; }
.agent-session-tab .tab-status-dot { width: 8px; height: 8px; border-radius: 999px; background: #94a3b8; }
.agent-session-tab .tab-status-dot.is-running { background: #10b981; }
.agent-session-tab .tab-status-dot.is-starting { background: #f59e0b; }
.agent-session-tab .tab-status-dot.is-error { background: #ef4444; }
.agent-session-tab .tab-close { border: 0; background: transparent; color: inherit; cursor: pointer; }

.agent-session-tab-new {
  border: 1px dashed rgba(125, 182, 216, 0.4);
  border-radius: 999px;
  background: transparent;
  color: #dcebf2;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
}

.agent-session-statusbar {
  padding: 6px 14px;
  font-size: 12px;
  background: rgba(7, 23, 36, 0.78);
  color: rgba(220, 235, 242, 0.7);
  border-bottom: 1px solid rgba(125, 182, 216, 0.12);
}
```

- [ ] **Step 3: 启动页面，确认 Tab 容器存在**

Run: `npm start &` → 浏览器打开 `http://localhost:4173`，进入终端模块，确认 `<div class="agent-session-tabs">` 渲染（先空白，下一任务接数据）。

- [ ] **Step 4: Commit**

```bash
git add src/terminal.js styles/terminal.css
git commit -m "feat(terminal): scaffold session tabs container"
```

---

## Task 9: 前端会话状态机（list / start / attach / switch tab）

**Files:**
- Modify: `src/terminal.js`

- [ ] **Step 1: 加入会话状态**

在 `createTerminalController` 顶部新增：

```js
let sessions = [];           // SessionSummary[]
let primaryId = null;
let activeSessionId = null;  // 当前 attach 的 id
```

替换 `connectSocket(options = {})`：

```js
function connectSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}/api/agent`);
  const currentSocket = socket;

  socket.addEventListener("open", () => {
    if (socket !== currentSocket) return;
    socket.send(JSON.stringify({ type: "list_sessions" }));
    const stored = localStorage.getItem("workflow-active-session-id");
    if (stored) socket.send(JSON.stringify({ type: "attach_session", id: stored }));
  });

  socket.addEventListener("message", (event) => {
    if (socket !== currentSocket) return;
    handleSocketMessage(event.data);
  });

  socket.addEventListener("close", () => {
    if (socket !== currentSocket) return;
    socket = null;
    sessionState = "closed";
    notifyAvailabilityChange();
    setStatus("AI 终端已断开");
  });
}
```

替换 `handleSocketMessage` 的关键分支：

```js
if (message.type === "sessions_list") {
  sessions = Array.isArray(message.sessions) ? message.sessions : [];
  primaryId = message.primaryId || null;
  if (!sessions.find((s) => s.id === activeSessionId)) {
    activeSessionId = primaryId || sessions[0]?.id || null;
  }
  renderSessionTabs();
  renderStatusBar();
  notifyAvailabilityChange();
  return;
}

if (message.type === "session_started") {
  activeSessionId = message.id;
  localStorage.setItem("workflow-active-session-id", activeSessionId);
  selectedAgent = message.agent;
  customCommand = message.agent === "custom" ? String(message.command || "") : "";
  sessionState = "running";
  selectView.hidden = true;
  sessionView.hidden = false;
  ensureTerminal();
  terminal.reset();
  fitAndResize();
  notifyAvailabilityChange();
  return;
}

if (message.type === "session_attached") {
  activeSessionId = message.id;
  localStorage.setItem("workflow-active-session-id", activeSessionId);
  selectedAgent = message.agent;
  customCommand = message.agent === "custom" ? String(message.command || "") : "";
  sessionState = "running";
  selectView.hidden = true;
  sessionView.hidden = false;
  ensureTerminal();
  terminal.reset();
  if (message.output) {
    suppressTerminalData = true;
    terminal.write(keepCursorVisible(message.output), () => { suppressTerminalData = false; });
    setTimeout(() => { suppressTerminalData = false; }, 1000);
  }
  fitAndResize();
  notifyAvailabilityChange();
  return;
}

if (message.type === "terminal_output") {
  if (message.id && message.id !== activeSessionId) return;
  writeTerminalOutput(message.data || "");
  return;
}

if (message.type === "session_closed") {
  if (message.id === activeSessionId) {
    sessionState = "closed";
    terminal?.writeln("\r\n[会话已结束]");
    notifyAvailabilityChange();
  }
}
```

- [ ] **Step 2: 实现 Tab 渲染**

```js
function renderSessionTabs() {
  if (!tabsBar) return;
  tabsBar.replaceChildren();
  for (const session of sessions) {
    const tab = document.createElement("div");
    tab.className = "agent-session-tab" + (session.id === activeSessionId ? " is-active" : "");
    tab.title = session.command || session.agent;

    const star = document.createElement("span");
    star.className = "tab-star";
    star.textContent = session.id === primaryId ? "★" : "☆";
    star.addEventListener("click", (event) => {
      event.stopPropagation();
      sendSocket({ type: "set_primary_session", id: session.id });
    });

    const dot = document.createElement("span");
    dot.className = `tab-status-dot is-${session.status}`;

    const name = document.createElement("span");
    name.textContent = session.name;
    name.addEventListener("dblclick", () => beginRenameTab(session, name));

    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      if (window.confirm(`删除会话 ${session.name}？这会终止其 Agent 进程。`)) {
        sendSocket({ type: "delete_session", id: session.id });
      }
    });

    tab.append(star, dot, name, close);
    tab.addEventListener("click", () => {
      if (session.id === activeSessionId) return;
      if (activeSessionId) sendSocket({ type: "detach_session", id: activeSessionId });
      sendSocket({ type: "attach_session", id: session.id });
    });
    tabsBar.appendChild(tab);
  }

  const newButton = document.createElement("button");
  newButton.type = "button";
  newButton.className = "agent-session-tab-new";
  newButton.textContent = "+ 新建";
  newButton.addEventListener("click", () => {
    sessionState = null;
    selectView.hidden = false;
    sessionView.hidden = true;
  });
  tabsBar.appendChild(newButton);
}

function beginRenameTab(session, nameElement) {
  const input = document.createElement("input");
  input.value = session.name;
  input.className = "agent-session-tab-rename";
  nameElement.replaceWith(input);
  input.focus();
  input.select();
  const finish = (commit) => {
    if (commit) sendSocket({ type: "rename_session", id: session.id, name: input.value.trim() });
    input.replaceWith(nameElement);
  };
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); finish(true); }
    if (event.key === "Escape") { event.preventDefault(); finish(false); }
  });
}

function renderStatusBar() {
  if (!statusBar) return;
  const primary = sessions.find((s) => s.id === primaryId);
  const active = sessions.find((s) => s.id === activeSessionId);
  if (!primary && !active) {
    statusBar.textContent = "暂无 Agent 会话，点击右上角 + 新建会话";
    return;
  }
  if (!primary) {
    statusBar.textContent = `无主会话 · 当前查看：${active?.name || "-"}`;
    return;
  }
  statusBar.textContent = `主会话：${primary.name}（${primary.status}） · 当前查看：${active?.name || "-"}`;
}
```

- [ ] **Step 3: 改 `startSession(agent, options)` 用新协议**

替换原函数体：

```js
function startSession(agent, options = {}) {
  if (!agents[agent]) return;
  const command = agent === "custom" ? String(options.command || "").trim() : "";
  const dimensions = getTerminalDimensions();
  sendSocket({
    type: "start_session",
    agent,
    command,
    cwd: getCwd(),
    cols: dimensions.cols,
    rows: dimensions.rows,
  });
  setSessionStatus("启动中");
}
```

- [ ] **Step 4: 改 `terminal_input` / `resize` / `interrupt` 都带 `id`**

`sendSocket` 包装一个 helper：

```js
function sendTerminalAction(type, extra = {}) {
  if (!activeSessionId) return;
  sendSocket({ type, id: activeSessionId, ...extra });
}
```

把 `terminal.onData` 内部的 `sendSocket({ type: "terminal_input", data })` 改为 `sendTerminalAction("terminal_input", { data })`，同理 `fitAndResize` 内的 resize、`interruptSession` 的 `\x03`。

- [ ] **Step 5: 冒烟手测**

`npm start` → 进入终端模块 → 创建两个会话 → 切换 Tab → 输入命令 → 删除会话。

- [ ] **Step 6: Commit**

```bash
git add src/terminal.js
git commit -m "feat(terminal): tab-based multi-session UI"
```

---

## Task 10: Bookmarklet 反馈端到端验证 + 最终回归

**Files:** 无代码改动，只验证。

- [ ] **Step 1: 启动**

Run: `npm start`

- [ ] **Step 2: 创建两个会话**

界面操作：新建 Codex 会话（自动名 `Codex #1`，自动主会话），新建 Claude 会话（`Claude #2`）。

- [ ] **Step 3: 切换主会话到 Claude #2**

点击 `Claude #2` 的 ☆，状态条变为 `主会话：Claude #2（running） · 当前查看：Claude #2`。

- [ ] **Step 4: 在浏览器侧通过 Bookmarklet 发送反馈**

通过现有 Bookmarklet 注入页面，发起一次反馈。

Expected：Claude #2 终端里收到该 prompt，Codex #1 终端不变。

- [ ] **Step 5: 删除主会话**

点击 `Claude #2` 的 ×，确认。状态条更新为 `主会话：Codex #1（running） · 当前查看：Codex #1`。

- [ ] **Step 6: 关闭服务再启动**

Run: `pkill -f 'node server.mjs'; npm start`

确认会话列表为空，UI 回到选择 Agent 面板。

- [ ] **Step 7: Commit（如无代码改动跳过）**

```bash
git status
```

---

## Self-Review Checklist

- 每个 spec 章节都有对应任务：
  - 数据模型 + 持久化 → Task 2 / Task 4
  - WebSocket 协议 → Task 4 / Task 5 / Task 6
  - 后端 hub 改造 → Task 2-6
  - HTTP API 影响 → Task 7
  - 前端 UI（Tab + 状态条 + 操作） → Task 8 / Task 9
  - 主会话与查看 Tab 解耦 → Task 9 step 2 渲染逻辑 + Task 5 dispatchPrompt
  - 测试 → Task 1-5（hub 单测） + Task 9 / Task 10（手测）
- 不使用占位符；所有代码块完整；命令带预期输出。
- 函数命名一致：`createSession` / `deleteSession` / `setPrimarySessionId` / `attachClient` / `detachClient` / `emitOutput` / `dispatchPrompt` 全程统一。
