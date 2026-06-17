import { chmod, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const defaultCols = 120;
const defaultRows = 36;
const maxOutputBufferChunks = 4000;
const agents = {
  codex: {
    label: "Codex",
    command: "codex",
    args(cwd) {
      return ["--no-alt-screen", "-C", cwd];
    },
  },
  claude: {
    label: "Claude Code",
    command: "claude",
    args() {
      return [];
    },
  },
  custom: {
    label: "自定义 Agent",
    command: "",
    args() {
      return [];
    },
  },
};

let nodePty;

export function createAgentServer({ appRoot }) {
  const socketServer = new WebSocketServer({ noServer: true });
  const hub = createAgentSessionHub({
    ptyFactory: (message) => ptyFactoryFromMessage(message, appRoot),
  });

  socketServer.on("connection", (socket, request) => {
    openAgentSocket(socket, request, appRoot, hub);
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
    close() {
      hub.closeAll("server_closed");
      socketServer.close();
    },
    getDispatchStatus: () => hub.getDispatchStatus(),
    dispatchPrompt: (prompt) => hub.dispatchPrompt(prompt),
  };
}

export function createAgentSessionHub({ ptyFactory } = {}) {
  const clients = new Map();

  const sessions = new Map();
  let primarySessionId = null;
  const sequence = { codex: 0, claude: 0, custom: 0 };

  function autoName(agent) {
    const key = agent in sequence ? agent : "custom";
    sequence[key] = (sequence[key] || 0) + 1;
    const labelMap = { codex: "Codex", claude: "Claude", custom: "Custom" };
    const label = labelMap[key] || "Custom";
    return `${label} #${sequence[key]}`;
  }

  return {
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
    getClientState(socket) {
      return clients.get(socket) || null;
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
    getSession(id) {
      return sessions.get(id) || null;
    },
    getOutputSnapshot(id) {
      const session = sessions.get(id);
      return session ? session.outputBuffer.join("") : "";
    },
    broadcast(message) {
      for (const socket of clients.keys()) {
        sendMessage(socket, message);
      }
    },
    async createSession(message) {
      const pty = ptyFactory ? await ptyFactory(message) : null;
      if (!pty) return null;
      let id = "sess_" + randomUUID().replace(/-/g, "").slice(0, 12);
      while (sessions.has(id)) {
        id = "sess_" + randomUUID().replace(/-/g, "").slice(0, 12);
      }
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
      if (!primarySessionId) {
        primarySessionId = id;
      }
      return record;
    },
    listSessions() {
      return Array.from(sessions.values()).map((record) => ({
        id: record.id,
        name: record.name,
        agent: record.agent,
        command: record.command,
        status: record.status,
        isPrimary: record.id === primarySessionId,
        createdAt: record.createdAt,
      }));
    },
    getPrimarySessionId() {
      return primarySessionId;
    },
    setPrimarySessionId(id) {
      if (!sessions.has(id)) return false;
      primarySessionId = id;
      return true;
    },
    deleteSession(id) {
      const record = sessions.get(id);
      if (!record) return false;
      try {
        record.pty?.kill?.("deleted");
      } catch {
        // ignore kill errors
      }
      sessions.delete(id);
      if (primarySessionId === id) {
        const next = sessions.values().next().value;
        primarySessionId = next ? next.id : null;
      }
      for (const state of clients.values()) {
        if (state.attachedSessionId === id) {
          state.attachedSessionId = null;
        }
      }
      return true;
    },
    renameSession(id, name) {
      const record = sessions.get(id);
      if (!record) return false;
      const trimmed = String(name || "").trim().slice(0, 24);
      record.name = trimmed || record.name;
      return true;
    },
    closeAll(reason = "stopped") {
      for (const record of sessions.values()) {
        try {
          record.pty?.kill?.(reason, { silent: true });
        } catch {
          // ignore kill errors
        }
      }
      sessions.clear();
      primarySessionId = null;
    },
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
      if (!session) {
        return { ok: false, reason: "no-session", message: "当前没有主会话" };
      }
      if (session.status !== "running") {
        return { ok: false, reason: "closed", message: "主会话不可用" };
      }
      return {
        ok: true,
        status: "running",
        agent: session.agent,
        label: session.label,
        primary: { id: session.id, name: session.name, agent: session.agent, status: session.status },
      };
    },
  };
}

function pushOutput(outputBuffer, data) {
  outputBuffer.push(String(data || ""));
  while (outputBuffer.length > maxOutputBufferChunks) {
    outputBuffer.shift();
  }
}

function openAgentSocket(socket, request, appRoot, hub) {
  hub.addClient(socket);
  sendMessage(socket, { type: "connected" });

  socket.on("message", async (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      sendMessage(socket, { type: "error", message: "消息格式无效" });
      return;
    }

    try {
      await routeAgentMessage(socket, message, hub, appRoot);
    } catch (error) {
      sendMessage(socket, { type: "error", message: error.message || "消息处理失败" });
    }
  });

  socket.on("close", () => {
    hub.removeClient(socket);
  });
}

async function routeAgentMessage(socket, message, hub, appRoot) {
  if (message.type === "list_sessions") {
    sendMessage(socket, sessionsListMessage(hub));
    return;
  }

  if (message.type === "start_session") {
    const result = await createSessionWithHooks(message, hub);
    if (!result.ok) {
      sendMessage(socket, { type: "error", message: result.message });
      return;
    }
    const session = result.session;
    hub.attachClient(socket, session.id);
    sendMessage(socket, { type: "session_started", ...summarizeRecord(session, hub) });
    hub.broadcast(sessionsListMessage(hub));
    return;
  }

  if (message.type === "attach_session") {
    const session = hub.getSession(String(message.id || ""));
    if (!session) {
      sendMessage(socket, { type: "error", id: message.id, message: "会话不存在" });
      return;
    }
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
      hub.broadcast(sessionsListMessage(hub));
    }
    return;
  }

  if (message.type === "rename_session") {
    if (hub.renameSession(String(message.id || ""), String(message.name || ""))) {
      hub.broadcast(sessionsListMessage(hub));
    }
    return;
  }

  if (message.type === "set_primary_session") {
    if (hub.setPrimarySessionId(String(message.id || ""))) {
      hub.broadcast(sessionsListMessage(hub));
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
    return;
  }
}

function sessionsListMessage(hub) {
  return { type: "sessions_list", sessions: hub.listSessions(), primaryId: hub.getPrimarySessionId() };
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

function resolveTargetSession(hub, socket, explicitId) {
  if (explicitId) return hub.getSession(String(explicitId));
  const state = hub.getClientState(socket);
  if (!state || !state.attachedSessionId) return null;
  return hub.getSession(state.attachedSessionId);
}

async function createSessionWithHooks(message, hub) {
  let session;
  try {
    session = await hub.createSession(message);
  } catch (error) {
    return { ok: false, message: error?.message || "Agent 启动失败" };
  }
  if (!session) return { ok: false, message: "Agent 启动失败" };
  session.pty.onOutput = (data) => hub.emitOutput(session.id, data);
  session.pty.onClose = (reason, details = {}) => {
    session.status = "closed";
    hub.broadcast({ type: "session_closed", id: session.id, reason, ...details });
    hub.broadcast({ type: "sessions_list", sessions: hub.listSessions(), primaryId: hub.getPrimarySessionId() });
  };
  session.pty.onError = (errorMessage) => {
    session.status = "error";
    hub.broadcast({ type: "error", id: session.id, message: errorMessage });
  };
  return { ok: true, session };
}

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

  let child;
  try {
    const pty = await loadNodePty();
    child = pty.spawn(launch.command, launch.args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: createAgentEnv(cwd),
    });
  } catch (error) {
    const reason = error?.message || agent.label;
    throw new Error(`Agent 启动失败：${reason}`);
  }

  let closed = false;
  const handlers = { onOutput: null, onClose: null, onError: null };

  const session = {
    agent: agentKey,
    label: agent.label,
    cwd,
    command: launch.displayCommand,
    get closed() {
      return closed;
    },
    write(data) {
      if (!closed) child.write(data);
    },
    resize(c, r) {
      if (!closed) child.resize(c, r);
    },
    kill(reason = "stopped", options = {}) {
      if (closed) return;
      try {
        child.kill();
      } finally {
        closed = true;
        handlers.onClose?.(reason, options);
      }
    },
    set onOutput(fn) {
      handlers.onOutput = fn;
    },
    set onClose(fn) {
      handlers.onClose = fn;
    },
    set onError(fn) {
      handlers.onError = fn;
    },
  };

  child.onData((data) => {
    if (data) handlers.onOutput?.(data);
  });
  child.onExit(({ exitCode, signal }) => {
    if (closed) return;
    closed = true;
    handlers.onClose?.("exited", { exitCode, signal });
  });

  return session;
}

function createAgentLaunch(agentKey, agent, cwd, customCommand) {
  if (agentKey !== "custom") {
    const args = agent.args(cwd);
    return {
      command: agent.command,
      args,
      displayCommand: [agent.command, ...args].join(" "),
    };
  }

  const shell = getUserShell();
  return {
    command: shell,
    args: ["-lc", customCommand],
    displayCommand: customCommand,
  };
}

function getUserShell() {
  const shell = process.env.SHELL || "/bin/bash";
  const name = basename(shell);
  if (name === "bash" || name === "zsh" || name === "sh") return shell;
  return "/bin/bash";
}

async function loadNodePty() {
  await ensureNodePtyHelperExecutable();
  if (!nodePty) {
    nodePty = (await import("node-pty")).default;
  }
  return nodePty;
}

async function ensureNodePtyHelperExecutable() {
  if (process.platform === "win32") return;

  const helperPath = getNodePtyHelperPath();
  if (!helperPath) return;

  try {
    const info = await stat(helperPath);
    if ((info.mode & 0o111) === 0) {
      await chmod(helperPath, info.mode | 0o755);
    }
  } catch {
    // node-pty will surface a clearer startup error if the helper cannot be fixed.
  }
}

function getNodePtyHelperPath() {
  try {
    const packagePath = require.resolve("node-pty/package.json");
    return join(dirname(packagePath), "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
  } catch {
    return "";
  }
}

async function resolveAgentCwd(rawCwd, appRoot) {
  const fallback = resolve(appRoot);
  if (!rawCwd) return fallback;

  try {
    const cwd = resolve(String(rawCwd));
    const info = await stat(cwd);
    return info.isDirectory() ? cwd : fallback;
  } catch {
    return fallback;
  }
}

function createAgentEnv(cwd) {
  return {
    ...process.env,
    PWD: cwd,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
  };
}

function clampDimension(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.floor(number), max));
}

function isLocalRequest(request) {
  const address = request.socket.remoteAddress || "";
  return address === "::1" || address === "127.0.0.1" || address === "::ffff:127.0.0.1";
}

function sendMessage(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}
