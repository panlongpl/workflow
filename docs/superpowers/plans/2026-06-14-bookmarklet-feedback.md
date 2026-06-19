# Bookmarklet Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bookmarklet-based feedback tool that lets users report issues from other frontend pages into the currently running Workflow Cockpit Agent.

**Architecture:** Extend the existing Agent WebSocket server with a small session registry so HTTP routes can check and dispatch to the active Agent. Add CORS-enabled HTTP endpoints, a Workflow Cockpit installation module, and a self-contained bookmarklet payload that injects a floating feedback panel into arbitrary pages.

**Tech Stack:** Node.js HTTP server, existing `ws` + `node-pty` Agent bridge, browser ES modules, vanilla DOM/CSS.

---

## File Structure

- Modify `lib/agent-server.mjs`: track the currently running session and expose `getDispatchStatus()` / `dispatchPrompt(prompt)` from `createAgentServer()`.
- Modify `server.mjs`: add CORS-aware `GET /api/agent-status`, `POST /api/bookmarklet-feedback`, and `OPTIONS` handling; format feedback payloads into Agent prompts.
- Modify `src/api.js`: add `readAgentStatus()` for the installation page.
- Create `src/bookmarklet.js`: render the installation module, generate the bookmarklet `href`, and provide the self-contained injected payload source.
- Modify `src/app.js`: add a third module, “测试反馈”, and render the bookmarklet installation module.
- Modify `index.html`: add the “测试反馈” module button.
- Modify `styles/feedback.css`: add styles for the bookmarklet installation page inside Workflow Cockpit.
- Modify `styles/layout.css`: hide document-only UI affordances while the feedback module is active.

---

### Task 1: Expose active Agent status and HTTP dispatch bridge

**Files:**
- Modify: `lib/agent-server.mjs:35-115`
- Modify: `lib/agent-server.mjs:117-197`

- [ ] **Step 1: Add an Agent session registry in `createAgentServer()`**

Implement a closure-level `activeSession` and return two new methods from `createAgentServer()`:

```js
export function createAgentServer({ appRoot }) {
  const socketServer = new WebSocketServer({ noServer: true });
  let activeSession = null;

  const registry = {
    set(session) {
      activeSession = session;
    },
    clear(session) {
      if (!session || activeSession === session) activeSession = null;
    },
    get() {
      return activeSession;
    },
  };

  socketServer.on("connection", (socket, request) => {
    openAgentSocket(socket, request, appRoot, registry);
  });

  return {
    handleUpgrade(request, socket, head) {
      if (!isLocalRequest(request)) {
        socket.destroy();
        return;
      }

      socketServer.handleUpgrade(request, socket, head, (webSocket) => {
        socketServer.emit("connection", webSocket, request);
      });
    },
    getDispatchStatus() {
      return createDispatchStatus(registry.get());
    },
    dispatchPrompt(prompt) {
      const session = registry.get();
      const status = createDispatchStatus(session);
      if (!status.ok) return status;
      const text = String(prompt || "").trim();
      if (!text) {
        return { ok: false, reason: "empty-prompt", message: "发送内容为空" };
      }
      session.write(`${text}\r`);
      return { ok: true, agent: session.agent, label: session.label };
    },
    close() {
      socketServer.close();
    },
  };
}
```

- [ ] **Step 2: Update `openAgentSocket()` to use the registry**

Change the signature and lifecycle:

```js
function openAgentSocket(socket, request, appRoot, registry) {
  let session = null;
  sendMessage(socket, { type: "connected" });

  socket.on("message", async (raw) => {
    // existing JSON parsing stays unchanged

    if (message.type === "start_session") {
      if (session) {
        sendMessage(socket, { type: "error", message: "会话已经启动" });
        return;
      }
      session = await startAgentSession(socket, message, appRoot, () => {
        registry.clear(session);
        session = null;
      });
      if (session) registry.set(session);
      return;
    }

    // terminal_input / resize / interrupt stay unchanged

    if (message.type === "stop_session") {
      session?.kill("stopped");
      registry.clear(session);
      session = null;
    }
  });

  socket.on("close", () => {
    session?.kill("socket_closed", { silent: true });
    registry.clear(session);
  });
}
```

- [ ] **Step 3: Add metadata and closed-state to sessions returned by `startAgentSession()`**

Extend the returned object:

```js
return {
  agent: agentKey,
  label: agent.label,
  get closed() {
    return closed;
  },
  write(data) {
    if (closed) return;
    child.write(data);
  },
  resize(nextCols, nextRows) {
    if (closed) return;
    child.resize(nextCols, nextRows);
  },
  kill(reason = "stopped", options = {}) {
    if (closed) return;
    try {
      child.kill();
    } finally {
      closeSession(reason, options);
    }
  },
};
```

- [ ] **Step 4: Add `createDispatchStatus(session)` helper**

Place it near `sendMessage()`:

```js
function createDispatchStatus(session) {
  if (!session) {
    return { ok: false, reason: "no-session", message: "当前没有可用的 Agent" };
  }
  if (session.closed) {
    return { ok: false, reason: "closed", message: "当前 Agent 会话不可用" };
  }
  return {
    ok: true,
    status: "running",
    agent: session.agent,
    label: session.label,
  };
}
```

- [ ] **Step 5: Run syntax check**

Run: `node --check /Users/bytedance/Documents/workflow/lib/agent-server.mjs`

Expected: no output and exit code `0`.

---

### Task 2: Add CORS-enabled feedback HTTP APIs

**Files:**
- Modify: `server.mjs:44-98`
- Modify: `server.mjs:348-366`

- [ ] **Step 1: Add route handling before existing POST APIs**

In `createServer()` request handler, after constructing `url`, add:

```js
if (isBookmarkletApiPath(url.pathname) && request.method === "OPTIONS") {
  sendCorsJson(response, 204, {});
  return;
}

if (request.method === "GET" && url.pathname === "/api/agent-status") {
  handleAgentStatus(response);
  return;
}

if (request.method === "POST" && url.pathname === "/api/bookmarklet-feedback") {
  await handleBookmarkletFeedback(request, response);
  return;
}
```

- [ ] **Step 2: Add status handler**

Place near the other handlers:

```js
function handleAgentStatus(response) {
  sendCorsJson(response, 200, agentServer.getDispatchStatus());
}
```

- [ ] **Step 3: Add feedback handler**

```js
async function handleBookmarkletFeedback(request, response) {
  if (!String(request.headers["content-type"] || "").includes("application/json")) {
    sendCorsJson(response, 415, { ok: false, reason: "unsupported-media-type", message: "只支持 JSON 请求" });
    return;
  }

  const body = await readRequestBody(request);
  const payload = JSON.parse(body || "{}");
  const normalized = normalizeBookmarkletFeedback(payload);
  if (!normalized.feedback.description) {
    sendCorsJson(response, 400, { ok: false, reason: "empty-description", message: "请先填写问题描述" });
    return;
  }

  const dispatch = agentServer.dispatchPrompt(formatBookmarkletPrompt(normalized));
  if (!dispatch.ok) {
    sendCorsJson(response, 409, { ok: false, reason: "no-agent", message: dispatch.message || "当前没有可用 Agent，请先启动 Agent" });
    return;
  }

  sendCorsJson(response, 200, { ok: true, message: "已发送给 Agent", agent: dispatch.agent, label: dispatch.label });
}
```

- [ ] **Step 4: Add normalization helpers**

Add helpers that clamp payload size and field lengths:

```js
function normalizeBookmarkletFeedback(payload) {
  const page = payload?.page || {};
  const viewport = page.viewport || {};
  const consolePayload = payload?.console || {};
  return {
    source: "bookmarklet-feedback",
    version: 1,
    page: {
      url: truncateText(page.url, 1200),
      title: truncateText(page.title, 300),
      referrer: truncateText(page.referrer, 1200),
      viewport: {
        width: clampNumber(viewport.width, 0, 100000),
        height: clampNumber(viewport.height, 0, 100000),
        devicePixelRatio: clampNumber(viewport.devicePixelRatio, 0, 10),
      },
      userAgent: truncateText(page.userAgent, 500),
      timestamp: truncateText(page.timestamp, 80) || new Date().toISOString(),
    },
    feedback: {
      description: truncateText(payload?.feedback?.description, 6000).trim(),
    },
    console: {
      errors: normalizeConsoleEntries(consolePayload.errors),
      rejections: normalizeConsoleEntries(consolePayload.rejections),
    },
  };
}
```

Also add `normalizeConsoleEntries`, `truncateText`, `clampNumber`.

- [ ] **Step 5: Add prompt formatter**

```js
function formatBookmarkletPrompt(payload) {
  const page = payload.page;
  const viewport = page.viewport;
  return [
    "我在测试一个前端页面时发现了问题，请帮我分析。",
    "",
    "## 用户描述",
    payload.feedback.description,
    "",
    "## 页面上下文",
    `- URL: ${page.url || "未知"}`,
    `- Title: ${page.title || "未知"}`,
    `- Referrer: ${page.referrer || "无"}`,
    `- Viewport: ${viewport.width || 0}x${viewport.height || 0} @${viewport.devicePixelRatio || 1}x`,
    `- UserAgent: ${page.userAgent || "未知"}`,
    `- Time: ${page.timestamp}`,
    "",
    "## 最近 Console Errors",
    formatConsoleSection(payload.console.errors),
    "",
    "## 最近 Unhandled Rejections",
    formatConsoleSection(payload.console.rejections),
    "",
    "## 请你做的事",
    "- 根据以上上下文判断可能原因",
    "- 给出排查路径",
    "- 如果需要更多信息，请明确告诉我下一步要收集什么",
  ].join("\n");
}
```

- [ ] **Step 6: Add CORS JSON helpers**

```js
function isBookmarkletApiPath(pathname) {
  return pathname === "/api/agent-status" || pathname === "/api/bookmarklet-feedback";
}

function sendCorsJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  response.end(status === 204 ? "" : JSON.stringify(value));
}
```

- [ ] **Step 7: Run syntax check**

Run: `node --check /Users/bytedance/Documents/workflow/server.mjs`

Expected: no output and exit code `0`.

---

### Task 3: Build bookmarklet installation module

**Files:**
- Create: `src/bookmarklet.js`
- Modify: `src/api.js:60-64`
- Modify: `index.html:56-59`
- Modify: `src/app.js:1-23`, `src/app.js:80-131`, `src/app.js:150-167`, `src/app.js:214-235`
- Modify: `styles/feedback.css`
- Modify: `styles/layout.css`

- [ ] **Step 1: Add API wrapper**

In `src/api.js`, append:

```js
export async function readAgentStatus() {
  const response = await fetch("/api/agent-status");
  return parseJsonResponse(response, "无法读取 Agent 状态。");
}
```

- [ ] **Step 2: Add module button in `index.html`**

Inside `.module-switch`, after `#terminalModule`, add:

```html
<button class="module-button" id="feedbackModule" type="button">测试反馈</button>
```

- [ ] **Step 3: Create `src/bookmarklet.js`**

Export `renderBookmarkletPage(container, options)` and `createBookmarkletHref(serviceOrigin)`. The module must render the installation UI and generate a self-contained `javascript:` URL that injects the floating panel.

- [ ] **Step 4: Wire the module into `src/app.js`**

Import `renderBookmarkletPage`, add `readAgentStatus`, add `feedbackModule` to `els`, register its click handler, support `state.activeModule === "feedback"`, and implement:

```js
async function renderFeedbackModule() {
  setActiveModule("feedback");
  els.status.textContent = "测试反馈工具";
  els.docName.textContent = "测试反馈工具";
  els.docPath.textContent = "把其他前端页面的问题快速发送给当前 Agent";
  els.contentShell.innerHTML = "";
  renderBookmarkletPage(els.contentShell, {
    readAgentStatus,
    serviceOrigin: window.location.origin,
    showToast,
  });
}
```

- [ ] **Step 5: Add page styles**

Append styles to `styles/feedback.css` for `.bookmarklet-page`, `.bookmarklet-card`, `.bookmarklet-install-button`, `.bookmarklet-status`, and instruction blocks. Use existing CSS variables such as `--paper`, `--ink`, `--accent`, and `--shadow-md`.

- [ ] **Step 6: Hide document affordances in feedback mode**

Add to `styles/layout.css`:

```css
.app.module-feedback .doc-outline,
.app.module-feedback .bottom-jump {
  display: none;
}
```

---

### Task 4: Implement injected feedback panel behavior

**Files:**
- Modify: `src/bookmarklet.js`

- [ ] **Step 1: Implement the injected payload generated by `createBookmarkletHref()`**

The payload must:

- Store state on `window.__workflowFeedbackTool`.
- Toggle existing panel instead of injecting duplicates.
- Hook `window.error`, `window.unhandledrejection`, and `console.error` after injection.
- Keep the latest 20 errors and latest 20 rejections.
- Render a fixed right-bottom panel with textarea and buttons.
- Call `${serviceOrigin}/api/agent-status` for checks.
- Call `${serviceOrigin}/api/bookmarklet-feedback` for sends.
- Show blocking no-Agent messages returned by the API.

- [ ] **Step 2: Implement payload collection**

The request payload must match the approved spec:

```js
{
  source: "bookmarklet-feedback",
  version: 1,
  page: {
    url: location.href,
    title: document.title,
    referrer: document.referrer,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
  },
  feedback: { description },
  console: { errors, rejections },
}
```

- [ ] **Step 3: Implement fallback alerts**

If DOM injection fails, call:

```js
alert("当前页面安全策略可能阻止了反馈工具运行，请手动复制页面信息给 Agent。");
```

If local service cannot be reached, show in-panel text:

```text
无法连接 Workflow Cockpit。请先运行本项目服务，然后重试。
```

---

### Task 5: Verify end-to-end behavior

**Files:**
- No source file changes expected.

- [ ] **Step 1: Syntax checks**

Run:

```bash
node --check /Users/bytedance/Documents/workflow/server.mjs && node --check /Users/bytedance/Documents/workflow/lib/agent-server.mjs && node --check /Users/bytedance/Documents/workflow/src/bookmarklet.js && node --check /Users/bytedance/Documents/workflow/src/app.js && node --check /Users/bytedance/Documents/workflow/src/api.js
```

Expected: no output and exit code `0`.

- [ ] **Step 2: Start local server**

Run: `npm start`

Expected: output includes `Markdown viewer running at http://localhost:4173/`.

- [ ] **Step 3: Check Agent status API without Agent**

Run: `curl -i http://localhost:4173/api/agent-status`

Expected: HTTP 200, CORS headers, JSON with `"ok":false` and `"reason":"no-session"`.

- [ ] **Step 4: Check feedback API blocks without Agent**

Run a POST with JSON feedback.

Expected: HTTP 409, JSON with `"ok":false` and message telling the user to start Agent.

- [ ] **Step 5: Browser smoke test**

Open `http://localhost:4173/`, switch to “测试反馈”, confirm:

- The install page renders.
- The bookmarklet link starts with `javascript:`.
- The Agent status block matches the current no-Agent state.

- [ ] **Step 6: Injection smoke test**

Create a temporary HTML test page outside the repository, install or paste the bookmarklet in the browser address bar, then confirm:

- Feedback panel appears.
- `console.error("boom")` after injection appears in the captured error summary.
- Sending with empty description is blocked client-side.
- Sending with no Agent shows the no-Agent blocking message.

---

## Self-Review

- Spec coverage: every approved MVP requirement maps to tasks above: bookmarklet injection, payload collection, Agent status check, no-Agent blocking, prompt dispatch, CORS, and verification.
- Placeholder scan: no `TODO`, `TBD`, or ambiguous “handle later” instructions remain.
- Type consistency: API names are consistently `readAgentStatus`, `getDispatchStatus`, `dispatchPrompt`, `/api/agent-status`, and `/api/bookmarklet-feedback`.
