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
  const hub = createAgentSessionHub();

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
      hub.stopSession("server_closed", { silent: true });
      socketServer.close();
    },
    getDispatchStatus() {
      return createDispatchStatus(hub.getSession());
    },
    dispatchPrompt(prompt) {
      const session = hub.getSession();
      const status = createDispatchStatus(session);
      if (!status.ok) return status;

      const text = String(prompt || "").trim();
      if (!text) {
        return { ok: false, reason: "empty-prompt", message: "发送内容为空" };
      }

      session.write(`${text}\r`);
      return { ok: true, agent: session.agent, label: session.label };
    },
  };
}

export function createAgentSessionHub({ ptyFactory } = {}) {
  let activeSession = null;
  let startingSession = null;
  const clients = new Map();
  const outputBuffer = [];

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
      if (id !== undefined) {
        return sessions.get(id) || null;
      }
      return activeSession && !activeSession.closed ? activeSession : null;
    },
    getOutputSnapshot(id) {
      if (id !== undefined) {
        const session = sessions.get(id);
        return session ? session.outputBuffer.join("") : "";
      }
      return outputBuffer.join("");
    },
    async startSession(message, appRoot) {
      if (activeSession && !activeSession.closed) return activeSession;
      if (startingSession) return startingSession;

      outputBuffer.length = 0;
      startingSession = startAgentSession(message, appRoot, {
        onOutput: (data) => {
          pushOutput(outputBuffer, data);
          broadcast(clients, { type: "terminal_output", data });
        },
        onClose: (closedSession, reason, details = {}) => {
          if (activeSession === closedSession) activeSession = null;
          if (!details.silent) {
            broadcast(clients, { type: "session_closed", reason, ...details });
          }
        },
        onError: (message) => {
          broadcast(clients, { type: "error", message });
        },
      }).then((session) => {
        if (session) activeSession = session;
        return session;
      }).finally(() => {
        startingSession = null;
      });

      return startingSession;
    },
    stopSession(reason = "stopped", options = {}) {
      const session = activeSession;
      if (!session) return;
      session.kill(reason, options);
      if (activeSession === session) activeSession = null;
    },
    broadcast(message) {
      broadcast(clients, message);
    },
    async createSession(message) {
      // 注：sessions Map 与旧 activeSession/startSession 路径在 Task 6 才整体打通；
      // 当前 hub 暴露 createSession 仅供单元测试和后续 socket 协议接入。
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
  };
}

function pushOutput(outputBuffer, data) {
  outputBuffer.push(String(data || ""));
  while (outputBuffer.length > maxOutputBufferChunks) {
    outputBuffer.shift();
  }
}

function broadcast(clients, message) {
  if (clients instanceof Map) {
    for (const socket of clients.keys()) sendMessage(socket, message);
  } else {
    for (const socket of clients) sendMessage(socket, message);
  }
}

function createSessionPayload(session, output = "") {
  return {
    agent: session.agent,
    label: session.label,
    cwd: session.cwd,
    command: session.command,
    output,
  };
}

function createDispatchStatus(session) {
  if (!session) {
    return { ok: false, reason: "no-session", message: "当前没有可用的 Agent" };
  }
  if (session.closed) {
    return { ok: false, reason: "closed", message: "当前 Agent 会话不可用" };
  }
  return { ok: true, status: "running", agent: session.agent, label: session.label };
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

    if (message.type === "attach_session") {
      const session = hub.getSession();
      if (!session) {
        sendMessage(socket, { type: "no_session" });
        return;
      }
      sendMessage(socket, {
        type: "session_attached",
        ...createSessionPayload(session, hub.getOutputSnapshot()),
      });
      return;
    }

    if (message.type === "start_session") {
      const existingSession = hub.getSession();
      if (existingSession) {
        sendMessage(socket, {
          type: "session_attached",
          ...createSessionPayload(existingSession, hub.getOutputSnapshot()),
        });
        return;
      }

      const session = await hub.startSession(message, appRoot);
      if (!session) {
        sendMessage(socket, { type: "error", message: "Agent 启动失败" });
        return;
      }
      hub.broadcast({
        type: "session_started",
        ...createSessionPayload(session),
      });
      return;
    }

    if (message.type === "terminal_input") {
      const session = hub.getSession();
      if (!session) {
        sendMessage(socket, { type: "error", message: "请先选择并启动 Agent" });
        return;
      }
      session.write(String(message.data || ""));
      return;
    }

    if (message.type === "resize") {
      const session = hub.getSession();
      if (!session) return;
      const cols = clampDimension(message.cols, defaultCols, 40, 300);
      const rows = clampDimension(message.rows, defaultRows, 12, 120);
      session.resize(cols, rows);
      return;
    }

    if (message.type === "interrupt") {
      hub.getSession()?.write("\x03");
      hub.broadcast({ type: "status", status: "interrupted", message: "已发送停止信号" });
      return;
    }

    if (message.type === "stop_session") {
      hub.stopSession("stopped");
    }
  });

  socket.on("close", () => {
    hub.removeClient(socket);
  });
}

async function startAgentSession(message, appRoot, hooks = {}) {
  const agentKey = String(message.agent || "");
  const agent = agents[agentKey];
  if (!agent) {
    return null;
  }
  const customCommand = String(message.command || "").trim();
  if (agentKey === "custom" && !customCommand) {
    return null;
  }

  const cwd = await resolveAgentCwd(message.cwd, appRoot);
  const cols = clampDimension(message.cols, defaultCols, 40, 300);
  const rows = clampDimension(message.rows, defaultRows, 12, 120);
  const launch = createAgentLaunch(agentKey, agent, cwd, customCommand);

  try {
    const pty = await loadNodePty();
    const child = pty.spawn(launch.command, launch.args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: createAgentEnv(cwd),
    });
    let closed = false;

    const sessionObject = {
      agent: agentKey,
      label: agent.label,
      cwd,
      command: launch.displayCommand,
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

    function closeSession(reason, details = {}) {
      if (closed) return;
      closed = true;
      hooks.onClose?.(sessionObject, reason, details);
    }

    child.onData((data) => {
      if (!data) return;
      hooks.onOutput?.(data);
    });

    child.onExit(({ exitCode, signal }) => {
      closeSession("exited", { exitCode, signal });
    });

    return sessionObject;
  } catch (error) {
    hooks.onError?.(error.message || `无法启动 ${agent.label}`);
    return null;
  }
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
