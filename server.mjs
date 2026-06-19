import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, extname, join, normalize, relative, resolve } from "node:path";
import { watch } from "chokidar";
import { runCodexForReading } from "./lib/ai-reader.mjs";
import {
  deleteAnnotation,
  listAnnotationHistory,
  listAnnotations,
  normalizeAnnotationTarget,
  saveAnnotation,
} from "./lib/annotation-store.mjs";
import { runCommand } from "./lib/command.mjs";
import {
  isMarkdownFile,
  isPathInside,
  readDirectorySnapshot,
  shouldSkipDirectory,
} from "./lib/directory-snapshot.mjs";
import { createAgentServer } from "./lib/agent-server.mjs";

const root = new URL(".", import.meta.url).pathname;
const port = Number(process.env.PORT || 4173);
const maxBodySize = 900_000;
const codexTimeoutMs = Number(process.env.CODEX_TIMEOUT_MS || 180_000);
const codexModel = process.env.CODEX_MODEL || "";
const eventClients = new Set();
const agentServer = createAgentServer({ appRoot: root });
const bookmarkletToken = randomUUID();
let activeDirectoryPath = "";
let activeDirectoryWatcher = null;
let directoryChangeTimer = null;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);

    if (isBookmarkletApiPath(url.pathname) && request.method === "OPTIONS") {
      sendCorsJson(response, 204, {});
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/bookmarklet-config") {
      handleBookmarkletConfig(response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/agent-status") {
      handleAgentStatus(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/bookmarklet-feedback") {
      await handleBookmarkletFeedback(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/ai-read") {
      await handleAiRead(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/choose-directory") {
      await handleChooseDirectory(response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/read-directory") {
      await handleReadDirectory(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/read-file") {
      await handleReadFile(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/annotations/list") {
      await handleListAnnotations(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/annotations/save") {
      await handleSaveAnnotation(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/annotations/delete") {
      await handleDeleteAnnotation(request, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/annotations/all") {
      await handleListAllAnnotations(response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/events") {
      handleEvents(request, response);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    await serveStatic(url.pathname, response, request.method === "HEAD");
  } catch (error) {
    const statusCode = Number(error.statusCode || 500);
    sendJson(response, statusCode, { error: error.message || "Internal server error" });
  }
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  if (url.pathname === "/api/agent") {
    agentServer.handleUpgrade(request, socket, head);
    return;
  }
  socket.destroy();
});

server.listen(port, "::", () => {
  console.log(`Markdown viewer running at http://localhost:${port}/`);
});

function handleBookmarkletConfig(response) {
  sendJson(response, 200, { token: bookmarkletToken });
}

function handleAgentStatus(request, response) {
  if (!hasValidBookmarkletAccess(request)) {
    sendCorsJson(response, 403, {
      ok: false,
      reason: "invalid-bookmarklet-token",
      message: "反馈工具授权无效，请回到 Workflow Cockpit 重新安装书签。",
    });
    return;
  }

  sendCorsJson(response, 200, agentServer.getDispatchStatus());
}

async function handleBookmarkletFeedback(request, response) {
  if (!String(request.headers["content-type"] || "").includes("application/json")) {
    sendCorsJson(response, 415, {
      ok: false,
      reason: "unsupported-media-type",
      message: "只支持 JSON 请求",
    });
    return;
  }

  const body = await readRequestBody(request);
  let payload;
  try {
    payload = body.trim() ? JSON.parse(body) : {};
  } catch {
    sendCorsJson(response, 400, {
      ok: false,
      reason: "invalid-json",
      message: "JSON 请求格式无效",
    });
    return;
  }

  const normalized = normalizeBookmarkletFeedback(payload);
  if (!hasValidBookmarkletAccess(request, payload)) {
    sendCorsJson(response, 403, {
      ok: false,
      reason: "invalid-bookmarklet-token",
      message: "反馈工具授权无效，请回到 Workflow Cockpit 重新安装书签。",
    });
    return;
  }

  if (!normalized.feedback.description) {
    sendCorsJson(response, 400, {
      ok: false,
      reason: "empty-description",
      message: "请先填写问题描述",
    });
    return;
  }

  const dispatch = agentServer.dispatchPrompt(formatBookmarkletPrompt(normalized));
  if (!dispatch.ok) {
    sendCorsJson(response, 409, {
      ok: false,
      reason: "no-agent",
      message: dispatch.message || "当前没有可用 Agent，请先启动 Agent",
    });
    return;
  }

  sendCorsJson(response, 200, {
    ok: true,
    message: "已发送给 Agent",
    agent: dispatch.agent,
    label: dispatch.label,
  });
}

async function handleAiRead(request, response) {
  const body = await readRequestBody(request);
  const payload = JSON.parse(body);
  const markdown = String(payload.markdown || "").slice(0, maxBodySize);
  const path = String(payload.path || "current.md");
  const readingMode = String(payload.readingMode || "auto");

  if (!markdown.trim()) {
    sendJson(response, 400, { error: "Markdown 内容为空" });
    return;
  }

  const result = await runCodexForReading({
    appRoot: root,
    path,
    markdown,
    readingMode,
    timeoutMs: codexTimeoutMs,
    model: codexModel,
  });
  sendJson(response, 200, { result });
}

async function handleChooseDirectory(response) {
  const selectedPath = await chooseDirectoryPath();
  if (!selectedPath) {
    sendJson(response, 200, { canceled: true });
    return;
  }

  const snapshot = await readDirectorySnapshot(selectedPath);
  await startDirectoryWatcher(snapshot.rootPath);
  sendJson(response, 200, snapshot);
}

async function handleReadDirectory(request, response) {
  const body = await readRequestBody(request);
  const payload = JSON.parse(body);
  const directoryPath = resolve(String(payload.rootPath || "").trim());

  if (!directoryPath) {
    sendJson(response, 400, { error: "目录路径无效" });
    return;
  }

  const snapshot = await readDirectorySnapshot(directoryPath);
  await startDirectoryWatcher(snapshot.rootPath);
  sendJson(response, 200, snapshot);
}

function handleEvents(request, response) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  response.write(": connected\n\n");

  const client = { response };
  eventClients.add(client);
  request.on("close", () => {
    eventClients.delete(client);
  });
}

async function handleReadFile(request, response) {
  const body = await readRequestBody(request);
  const payload = JSON.parse(body);
  const rootPath = resolve(String(payload.rootPath || "").trim());
  const filePath = String(payload.path || "").trim();
  const absolutePath = resolve(rootPath, filePath);

  if (!rootPath || !filePath || !isPathInside(rootPath, absolutePath)) {
    sendJson(response, 400, { error: "文件路径无效" });
    return;
  }

  if (!isMarkdownFile(absolutePath)) {
    sendJson(response, 400, { error: "只能读取 Markdown 文件" });
    return;
  }

  const info = await stat(absolutePath);
  if (!info.isFile()) {
    sendJson(response, 400, { error: "路径不是文件" });
    return;
  }

  const markdown = await readFile(absolutePath, "utf8");
  sendJson(response, 200, { markdown });
}

async function handleListAnnotations(request, response) {
  const { rootPath, filePath } = await readAnnotationRequest(request);
  sendJson(response, 200, { annotations: await listAnnotations(rootPath, filePath) });
}

async function handleSaveAnnotation(request, response) {
  const body = await readRequestBody(request);
  const payload = JSON.parse(body);
  const { rootPath, filePath } = await normalizeAnnotationTarget(payload);
  const { annotation, annotations } = await saveAnnotation(rootPath, filePath, payload.annotation || {});
  sendJson(response, 200, { annotation, annotations });
}

async function handleDeleteAnnotation(request, response) {
  const body = await readRequestBody(request);
  const payload = JSON.parse(body);
  const { rootPath, filePath } = await normalizeAnnotationTarget(payload);
  const annotationId = String(payload.id || "");
  sendJson(response, 200, { annotations: await deleteAnnotation(rootPath, filePath, annotationId) });
}

async function handleListAllAnnotations(response) {
  sendJson(response, 200, await listAnnotationHistory());
}

async function readAnnotationRequest(request) {
  const body = await readRequestBody(request);
  const payload = JSON.parse(body);
  return await normalizeAnnotationTarget(payload);
}

async function chooseDirectoryPath() {
  const script = 'POSIX path of (choose folder with prompt "选择 Markdown 目录")';
  const { stdout, stderr, code } = await runCommand("osascript", ["-e", script], "", 0, root);

  if (code === 0) return stdout.trim();
  if (stderr.includes("User canceled") || stderr.includes("-128")) return "";
  throw new Error(stderr.trim() || "无法打开目录选择窗口");
}

async function startDirectoryWatcher(rootPath) {
  if (activeDirectoryPath === rootPath && activeDirectoryWatcher) return;

  if (activeDirectoryWatcher) {
    await activeDirectoryWatcher.close().catch(() => {});
    activeDirectoryWatcher = null;
  }

  activeDirectoryPath = rootPath;
  activeDirectoryWatcher = watch(rootPath, {
    ignoreInitial: true,
    usePolling: true,
    interval: 1000,
    binaryInterval: 1000,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
    ignored: (filePath, stats) => {
      const name = basename(filePath);
      if (shouldSkipDirectory(name)) return true;
      if (stats?.isFile()) return !isMarkdownFile(filePath);
      return false;
    },
  });

  activeDirectoryWatcher.on("all", (event, filePath) => {
    scheduleDirectoryChange(event, filePath);
  });
  activeDirectoryWatcher.on("error", (error) => {
    broadcastEvent("directory-watch-error", {
      rootPath,
      message: error.message || "目录监听失败",
    });
  });
  broadcastEvent("directory-watch-ready", { rootPath });
}

function scheduleDirectoryChange(event, filePath) {
  if (directoryChangeTimer) clearTimeout(directoryChangeTimer);
  directoryChangeTimer = setTimeout(() => {
    directoryChangeTimer = null;
    broadcastEvent("directory-changed", {
      rootPath: activeDirectoryPath,
      event,
      path: filePath ? relative(activeDirectoryPath, filePath) : "",
      changedAt: Date.now(),
    });
  }, 500);
}

function broadcastEvent(type, payload = {}) {
  const data = JSON.stringify({ type, ...payload });
  for (const client of eventClients) {
    client.response.write(`event: ${type}\n`);
    client.response.write(`data: ${data}\n\n`);
  }
}

async function serveStatic(pathname, response, headOnly) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const localPath = normalize(join(root, cleanPath));

  if (!localPath.startsWith(root)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  let fileInfo;
  try {
    fileInfo = await stat(localPath);
  } catch {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (!fileInfo.isFile()) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const type = mimeTypes[extname(localPath)] || "application/octet-stream";
  response.writeHead(200, { "content-type": type });
  if (!headOnly) {
    const stream = createReadStream(localPath);
    stream.on("error", (error) => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: error.message || "Static file read failed" });
      } else {
        response.destroy(error);
      }
    });
    stream.pipe(response);
  } else {
    response.end();
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function isBookmarkletApiPath(pathname) {
  return pathname === "/api/agent-status" || pathname === "/api/bookmarklet-feedback";
}

function hasValidBookmarkletAccess(request, payload = null) {
  if (!isCrossOriginRequest(request)) return true;
  const headerToken = String(request.headers["x-workflow-bookmarklet-token"] || "");
  const bodyToken = String(payload?.token || "");
  return headerToken === bookmarkletToken || bodyToken === bookmarkletToken;
}

function isCrossOriginRequest(request) {
  const origin = String(request.headers.origin || "");
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    const hostUrl = new URL(`http://${request.headers.host}`);
    return originUrl.host !== hostUrl.host;
  } catch {
    return true;
  }
}

function sendCorsJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-workflow-bookmarklet-token",
    "access-control-max-age": "600",
  });
  response.end(status === 204 ? "" : JSON.stringify(value));
}

function normalizeBookmarkletFeedback(payload) {
  const page = payload?.page || {};
  const viewport = page.viewport || {};
  const consolePayload = payload?.console || {};
  const apiPayload = payload?.api || {};
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
    api: {
      selectedRequests: normalizeApiRequests(apiPayload.selectedRequests),
    },
  };
}

function normalizeApiRequests(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, 10).map((entry) => ({
    method: truncateText(entry?.method, 12).toUpperCase() || "GET",
    url: truncateText(entry?.url, 1400),
    status: clampNumber(entry?.status, 0, 999),
    ok: Boolean(entry?.ok),
    durationMs: clampNumber(entry?.durationMs, 0, 600000),
    type: truncateText(entry?.type, 20),
  })).filter((entry) => entry.url);
}

function normalizeConsoleEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, 20).map((entry) => ({
    message: truncateText(entry?.message, 1000),
    source: truncateText(entry?.source, 1200),
    lineno: clampNumber(entry?.lineno, 0, 1000000),
    colno: clampNumber(entry?.colno, 0, 1000000),
    stack: truncateText(entry?.stack, 3000),
    reason: truncateText(entry?.reason, 1000),
    timestamp: truncateText(entry?.timestamp, 80),
  }));
}

function formatBookmarkletPrompt(payload) {
  const page = payload.page;
  const lines = [
    "我在测试一个前端页面时发现了问题，请帮我分析。",
    "",
    "## 用户描述",
    payload.feedback.description,
    "",
    "## 页面上下文",
    `- URL: ${page.url || "未知"}`,
    `- Title: ${page.title || "未知"}`,
  ];

  if (payload.api.selectedRequests.length) {
    lines.push(
      "",
      "## 用户选择的后端接口",
      formatApiRequestSection(payload.api.selectedRequests),
    );
  }

  lines.push(
    "",
    "## 请你做的事",
    "- 根据以上上下文判断可能原因",
    "- 给出排查路径",
    "- 如果需要更多信息，请明确告诉我下一步要收集什么",
  );

  return lines.join("\n");
}

function formatApiRequestSection(entries) {
  if (!entries.length) return "无";
  return entries.map((entry, index) => [
    `${index + 1}. ${entry.method} ${entry.url}`,
    `   Status: ${entry.status || "未知"}`,
    entry.type ? `   Type: ${entry.type}` : "",
  ].filter(Boolean).join("\n")).join("\n\n");
}

function formatConsoleSection(entries) {
  if (!entries.length) return "无";
  return entries
    .map((entry, index) => {
      const lines = [`${index + 1}. ${entry.message || entry.reason || "未知错误"}`];
      if (entry.source) {
        const location = entry.lineno ? `:${entry.lineno}${entry.colno ? `:${entry.colno}` : ""}` : "";
        lines.push(`   Source: ${entry.source}${location}`);
      }
      if (entry.reason && entry.reason !== entry.message) {
        lines.push(`   Reason: ${entry.reason}`);
      }
      if (entry.stack) {
        lines.push(`   Stack: ${entry.stack.replace(/\n/g, "\n   ")}`);
      }
      if (entry.timestamp) {
        lines.push(`   Time: ${entry.timestamp}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

function truncateText(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(max, Math.max(min, number));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBodySize + 20_000) {
        request.destroy(new Error("请求体过大"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}
