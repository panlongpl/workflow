import { chmod, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { WebSocket, WebSocketServer } from "ws";

const require = createRequire(import.meta.url);
const defaultCols = 120;
const defaultRows = 36;
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

  socketServer.on("connection", (socket, request) => {
    openAgentSocket(socket, request, appRoot);
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
      socketServer.close();
    },
  };
}

function openAgentSocket(socket, request, appRoot) {
  let session = null;
  sendMessage(socket, { type: "connected" });

  socket.on("message", async (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      sendMessage(socket, { type: "error", message: "消息格式无效" });
      return;
    }

    if (message.type === "start_session") {
      if (session) {
        sendMessage(socket, { type: "error", message: "会话已经启动" });
        return;
      }
      session = await startAgentSession(socket, message, appRoot, () => {
        session = null;
      });
      return;
    }

    if (message.type === "terminal_input") {
      if (!session) {
        sendMessage(socket, { type: "error", message: "请先选择并启动 Agent" });
        return;
      }
      session.write(String(message.data || ""));
      return;
    }

    if (message.type === "resize") {
      if (!session) return;
      const cols = clampDimension(message.cols, defaultCols, 40, 300);
      const rows = clampDimension(message.rows, defaultRows, 12, 120);
      session.resize(cols, rows);
      return;
    }

    if (message.type === "interrupt") {
      session?.write("\x03");
      sendMessage(socket, { type: "status", status: "interrupted", message: "已发送停止信号" });
      return;
    }

    if (message.type === "stop_session") {
      session?.kill("stopped");
      session = null;
    }
  });

  socket.on("close", () => {
    session?.kill("socket_closed", { silent: true });
  });
}

async function startAgentSession(socket, message, appRoot, onClose) {
  const agentKey = String(message.agent || "");
  const agent = agents[agentKey];
  if (!agent) {
    sendMessage(socket, { type: "error", message: "不支持的 Agent" });
    return null;
  }
  const customCommand = String(message.command || "").trim();
  if (agentKey === "custom" && !customCommand) {
    sendMessage(socket, { type: "error", message: "请输入自定义 Agent 的启动命令" });
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

    function closeSession(reason, details = {}) {
      if (closed) return;
      closed = true;
      onClose?.();
      if (!details.silent) {
        sendMessage(socket, { type: "session_closed", reason, ...details });
      }
    }

    sendMessage(socket, {
      type: "session_started",
      agent: agentKey,
      label: agent.label,
      cwd,
      command: launch.displayCommand,
    });

    child.onData((data) => {
      if (!data) return;
      sendMessage(socket, { type: "terminal_output", data });
    });

    child.onExit(({ exitCode, signal }) => {
      closeSession("exited", { exitCode, signal });
    });

    return {
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
  } catch (error) {
    sendMessage(socket, {
      type: "error",
      message: error.message || `无法启动 ${agent.label}`,
    });
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
