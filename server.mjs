import { createServer } from "node:http";
import { mkdir, readFile, readdir, stat, writeFile, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { watch } from "chokidar";

const root = new URL(".", import.meta.url).pathname;
const port = Number(process.env.PORT || 4173);
const maxBodySize = 900_000;
const codexTimeoutMs = Number(process.env.CODEX_TIMEOUT_MS || 180_000);
const codexModel = process.env.CODEX_MODEL || "";
const annotationStoreRoot = join(homedir(), ".markdown-viewer");
const annotationStoreFile = join(annotationStoreRoot, "annotations.json");
const eventClients = new Set();
let activeDirectoryPath = "";
let activeDirectoryWatcher = null;
let directoryChangeTimer = null;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);

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

server.listen(port, "::", () => {
  console.log(`Markdown viewer running at http://localhost:${port}/`);
});

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

  const result = await runCodexForReading(path, markdown, readingMode);
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
  const { store, importedLegacy } = await readAnnotationStoreWithLegacy(rootPath);
  if (importedLegacy) {
    await writeAnnotationStore(store);
  }

  const document = getAnnotationDocument(store, rootPath, filePath);
  sendJson(response, 200, { annotations: document?.annotations || [] });
}

async function handleSaveAnnotation(request, response) {
  const body = await readRequestBody(request);
  const payload = JSON.parse(body);
  const { rootPath, filePath } = await normalizeAnnotationTarget(payload);
  const incoming = payload.annotation || {};
  const quote = String(incoming.quote || "").trim();
  const note = String(incoming.note || "").trim();

  if (!quote) {
    sendJson(response, 400, { error: "请选择要记录的文字" });
    return;
  }

  if (!note) {
    sendJson(response, 400, { error: "记录内容不能为空" });
    return;
  }

  const { store } = await readAnnotationStoreWithLegacy(rootPath);
  const document = ensureAnnotationDocument(store, rootPath, filePath);
  const annotations = document.annotations;
  const now = new Date().toISOString();
  const existing = incoming.id ? annotations.find((item) => item.id === incoming.id) : null;
  const annotation = {
    id: existing?.id || randomUUID(),
    quote,
    note,
    contextBefore: String(incoming.contextBefore || existing?.contextBefore || ""),
    contextAfter: String(incoming.contextAfter || existing?.contextAfter || ""),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  if (existing) {
    Object.assign(existing, annotation);
  } else {
    annotations.push(annotation);
  }

  document.updatedAt = now;
  await writeAnnotationStore(store);
  sendJson(response, 200, { annotation, annotations });
}

async function handleDeleteAnnotation(request, response) {
  const body = await readRequestBody(request);
  const payload = JSON.parse(body);
  const { rootPath, filePath } = await normalizeAnnotationTarget(payload);
  const annotationId = String(payload.id || "");

  const store = await readAnnotationStore();
  const key = annotationDocumentKey(rootPath, filePath);
  const document = store.documents[key];
  const annotations = (document?.annotations || []).filter((item) => item.id !== annotationId);
  if (document) {
    if (annotations.length) {
      document.annotations = annotations;
      document.updatedAt = new Date().toISOString();
    } else {
      delete store.documents[key];
    }
  }

  await writeAnnotationStore(store);
  sendJson(response, 200, { annotations });
}

async function handleListAllAnnotations(response) {
  const store = await readAnnotationStore();
  const documents = annotationDocuments(store);
  const count = documents.reduce((total, document) => total + document.annotations.length, 0);
  sendJson(response, 200, {
    storePath: annotationStoreFile,
    count,
    documents,
  });
}

async function readAnnotationRequest(request) {
  const body = await readRequestBody(request);
  const payload = JSON.parse(body);
  return await normalizeAnnotationTarget(payload);
}

async function normalizeAnnotationTarget(payload) {
  const rawRootPath = String(payload.rootPath || "").trim();
  const filePath = String(payload.path || "").trim();
  if (!rawRootPath || !filePath) {
    const error = new Error("文件路径无效");
    error.statusCode = 400;
    throw error;
  }

  const rootPath = resolve(rawRootPath);
  const absolutePath = resolve(rootPath, filePath);

  if (!isPathInside(rootPath, absolutePath)) {
    const error = new Error("文件路径无效");
    error.statusCode = 400;
    throw error;
  }

  return { rootPath, filePath };
}

async function readAnnotationStoreWithLegacy(rootPath) {
  const store = await readAnnotationStore();
  const importedLegacy = await importLegacyAnnotationStore(store, rootPath);
  return { store, importedLegacy };
}

async function readAnnotationStore() {
  try {
    const content = await readFile(annotationStoreFile, "utf8");
    const parsed = JSON.parse(content);
    return normalizeAnnotationStore(parsed);
  } catch (error) {
    if (error.code === "ENOENT") return createAnnotationStore();
    throw error;
  }
}

async function writeAnnotationStore(store) {
  await mkdir(annotationStoreRoot, { recursive: true });
  await writeFile(annotationStoreFile, `${JSON.stringify(normalizeAnnotationStore(store), null, 2)}\n`, "utf8");
}

function createAnnotationStore() {
  return { version: 2, documents: {}, legacyImports: {} };
}

function normalizeAnnotationStore(value) {
  const store = createAnnotationStore();
  const documents = value?.documents && typeof value.documents === "object" ? value.documents : {};

  Object.entries(documents).forEach(([key, document]) => {
    if (Array.isArray(document)) {
      return;
    }

    const rootPath = typeof document?.rootPath === "string" ? resolve(document.rootPath) : "";
    const filePath = typeof document?.path === "string" ? document.path : "";
    if (!rootPath || !filePath) return;

    const normalizedKey = annotationDocumentKey(rootPath, filePath);
    store.documents[normalizedKey] = {
      rootPath,
      rootName: document.rootName || basename(rootPath) || rootPath,
      path: filePath,
      fileName: document.fileName || basename(filePath),
      annotations: normalizeAnnotations(document.annotations || []),
      updatedAt: document.updatedAt || latestAnnotationTime(document.annotations || []),
    };
  });

  store.legacyImports = value?.legacyImports && typeof value.legacyImports === "object"
    ? value.legacyImports
    : {};

  return store;
}

function normalizeAnnotations(annotations) {
  return (Array.isArray(annotations) ? annotations : [])
    .map((annotation) => ({
      id: String(annotation?.id || randomUUID()),
      quote: String(annotation?.quote || ""),
      note: String(annotation?.note || ""),
      contextBefore: String(annotation?.contextBefore || ""),
      contextAfter: String(annotation?.contextAfter || ""),
      createdAt: String(annotation?.createdAt || annotation?.updatedAt || new Date().toISOString()),
      updatedAt: String(annotation?.updatedAt || annotation?.createdAt || new Date().toISOString()),
    }))
    .filter((annotation) => annotation.quote && annotation.note);
}

async function importLegacyAnnotationStore(store, rootPath) {
  if (!rootPath || store.legacyImports[rootPath]) return false;

  const legacyPath = join(rootPath, ".markdown-viewer", "annotations.json");
  let imported = false;
  try {
    const content = await readFile(legacyPath, "utf8");
    const parsed = JSON.parse(content);
    const documents = parsed.documents && typeof parsed.documents === "object" ? parsed.documents : {};

    Object.entries(documents).forEach(([filePath, annotations]) => {
      const normalizedAnnotations = normalizeAnnotations(annotations);
      if (!normalizedAnnotations.length) return;

      const document = ensureAnnotationDocument(store, rootPath, filePath);
      const knownIds = new Set(document.annotations.map((annotation) => annotation.id));
      normalizedAnnotations.forEach((annotation) => {
        if (!knownIds.has(annotation.id)) {
          document.annotations.push(annotation);
          knownIds.add(annotation.id);
          imported = true;
        }
      });
      document.updatedAt = latestAnnotationTime(document.annotations);
    });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  store.legacyImports[rootPath] = new Date().toISOString();
  return imported;
}

function ensureAnnotationDocument(store, rootPath, filePath) {
  const key = annotationDocumentKey(rootPath, filePath);
  if (!store.documents[key]) {
    store.documents[key] = {
      rootPath,
      rootName: basename(rootPath) || rootPath,
      path: filePath,
      fileName: basename(filePath),
      annotations: [],
      updatedAt: "",
    };
  }
  return store.documents[key];
}

function getAnnotationDocument(store, rootPath, filePath) {
  return store.documents[annotationDocumentKey(rootPath, filePath)];
}

function annotationDocuments(store) {
  return Object.values(store.documents)
    .map((document) => ({
      ...document,
      annotations: normalizeAnnotations(document.annotations),
      updatedAt: document.updatedAt || latestAnnotationTime(document.annotations),
    }))
    .filter((document) => document.annotations.length)
    .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
}

function annotationDocumentKey(rootPath, filePath) {
  return JSON.stringify([resolve(rootPath), filePath]);
}

function latestAnnotationTime(annotations) {
  return normalizeAnnotations(annotations)
    .map((annotation) => annotation.updatedAt || annotation.createdAt || "")
    .sort()
    .at(-1) || "";
}

async function chooseDirectoryPath() {
  const script = 'POSIX path of (choose folder with prompt "选择 Markdown 目录")';
  const { stdout, stderr, code } = await runCommand("osascript", ["-e", script], "", 0);

  if (code === 0) return stdout.trim();
  if (stderr.includes("User canceled") || stderr.includes("-128")) return "";
  throw new Error(stderr.trim() || "无法打开目录选择窗口");
}

async function readDirectorySnapshot(directoryPath) {
  const rootPath = resolve(directoryPath);
  const info = await stat(rootPath);
  if (!info.isDirectory()) {
    throw new Error("路径不是目录");
  }

  const files = [];
  const tree = createTreeNode(basename(rootPath) || rootPath);
  await scanLocalDirectory(rootPath, rootPath, tree, files);
  files.sort((a, b) => b.lastModified - a.lastModified);
  return {
    rootPath,
    rootName: basename(rootPath) || rootPath,
    files,
    tree,
  };
}

async function scanLocalDirectory(rootPath, directoryPath, treeNode, files) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN");
  });

  for (const entry of entries) {
    const absolutePath = join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) continue;

      const child = createTreeNode(entry.name);
      treeNode.dirs.push(child);
      await scanLocalDirectory(rootPath, absolutePath, child, files);
      if (!child.dirs.length && !child.files.length) {
        treeNode.dirs = treeNode.dirs.filter((dir) => dir !== child);
      }
      continue;
    }

    if (!entry.isFile() || !isMarkdownFile(entry.name)) continue;

    const info = await stat(absolutePath);
    const item = {
      name: entry.name,
      path: relative(rootPath, absolutePath),
      lastModified: info.mtimeMs,
      size: info.size,
    };
    files.push(item);
    treeNode.files.push(item);
  }
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

function createTreeNode(name) {
  return { name, dirs: [], files: [] };
}

function isMarkdownFile(name) {
  return /\.(md|markdown)$/i.test(name);
}

function shouldSkipDirectory(name) {
  return name === ".git" || name === "node_modules" || name === ".markdown-viewer";
}

function isPathInside(rootPath, targetPath) {
  const relation = relative(rootPath, targetPath);
  return Boolean(relation) && !relation.startsWith("..") && !isAbsolute(relation);
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

async function runCodexForReading(path, markdown, readingMode) {
  const outputPath = join(tmpdir(), `markdown-ai-reading-${randomUUID()}.json`);
  const schemaPath = join(root, "ai-reading-schema.json");
  const prompt = buildPrompt(path, markdown, readingMode);

  try {
    const args = [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      "-",
    ];

    if (codexModel) {
      args.splice(4, 0, "-m", codexModel);
    }

    const { stdout, stderr, code } = await runCommand("codex", args, prompt, codexTimeoutMs);

    let raw = "";
    try {
      raw = await readFile(outputPath, "utf8");
    } catch {
      raw = extractLastAgentMessage(stdout);
    }

    if (!raw || !extractJson(raw).trim()) {
      throw new Error(cleanCodexError(stderr) || `Codex exited with code ${code}`);
    }

    return normalizeAiResult(JSON.parse(extractJson(raw)));
  } finally {
    await unlink(outputPath).catch(() => {});
  }
}

function runCommand(command, args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });

    let stdout = "";
    let stderr = "";
    const timer = timeoutMs > 0
      ? setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error("Codex 生成超时"));
        }, timeoutMs)
      : null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        resolve({ stdout, stderr, code });
      }
    });

    child.stdin.end(input);
  });
}

function cleanCodexError(stderr) {
  const text = stderr
    .replace(/<html[\s\S]*?<\/html>/gi, "[HTML error page]")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const messageMatch = stderr.match(/"message"\s*:\s*"([^"]+)"/);
  if (messageMatch) return messageMatch[1];

  const modelError = text.find((line) => line.includes("model is not supported"));
  if (modelError) return modelError.replace(/^ERROR:\s*/, "");

  const upgradeError = text.find((line) => line.includes("requires a newer version of Codex"));
  if (upgradeError) return upgradeError.replace(/^ERROR:\s*/, "");

  const forbidden = text.find((line) => line.includes("403 Forbidden"));
  if (forbidden) {
    return "Codex CLI 无法连接 ChatGPT/Codex 后端，返回 403 Forbidden。请检查登录状态、网络/VPN，或设置可用的 CODEX_MODEL 后重启服务。";
  }

  return text.slice(-3).join("\n");
}

function buildPrompt(path, markdown, readingMode) {
  const resolvedMode = resolveReadingMode(path, markdown, readingMode);
  const modePrompt = modeInstructions(resolvedMode);
  return `你是一个文档阅读整理助手。请阅读下面 Markdown 文档，输出严格符合 JSON Schema 的 JSON，不要输出 Markdown、代码围栏或额外解释。

目标：把文档整理成更便于阅读的结构化内容，忠于原文，不要编造。

要求：
- title: 使用文档最合适的标题，若无法判断则用文件名。
- summary: 1-2 句总结文档核心内容。只要文档里有正文，就不要返回“暂无摘要”或空字符串。
- highlights: 3-6 条最重要的信息。优先提取明确的接口、字段、步骤、约束、配置项、风险。
- sections: 3-8 个阅读分区；content 用简洁中文说明；items 放字段、步骤、规则、接口、结论等列表。
- 如果原文存在明确小节、列表、字段名、URL、接口名、配置名、错误码、待办项，请尽量提炼到 sections/items 里，不要大量返回空数组。
- risks: 文档中的风险、缺口、待确认点；没有则返回空数组。
- todos: 文档中明确或可合理提炼的后续行动；没有则返回空数组。
- 保留关键英文标识、接口路径、字段名和代码符号。
- 不要输出“暂无”“未提炼出”“无内容”之类的占位文本，除非原文真的没有可提炼信息。
- 当前阅读模式：${readingMode}（实际采用：${resolvedMode}）

模式偏好：
${modePrompt}

针对文档类型的额外偏好：
- 如果是 tasks / task / todo 类文档，优先提炼实施步骤、依赖关系、配置改动、接口改动、风险和验收点。
- 如果是 spec / design 类文档，优先提炼背景、核心改动、接口/字段、边界条件、风险和后续事项。
- 如果文档有标题层级，请尽量沿用原始结构来组织 sections。

文件路径：${path}

Markdown 内容：
${markdown}`;
}

function resolveReadingMode(path, markdown, readingMode) {
  const normalized = String(readingMode || "auto").trim().toLowerCase();
  if (normalized && normalized !== "auto") {
    return normalized;
  }

  const source = `${path}\n${markdown}`.toLowerCase();
  if (/(^|\/)(tasks?|todo)(\.md|\/|$)/.test(path.toLowerCase()) || /(^|\n)\s*[-*]\s+\[( |x)\]/.test(markdown)) {
    return "task";
  }
  if (
    /(^|\/)(api|openapi|swagger|endpoint|interface|spec)(\.md|\/|$)/.test(path.toLowerCase()) ||
    /(请求参数|响应参数|返回字段|错误码|api|endpoint|request|response|curl)/.test(source)
  ) {
    return "api";
  }
  if (
    /(^|\/)(design|architecture|方案|设计)(\.md|\/|$)/.test(path.toLowerCase()) ||
    /(架构|设计目标|技术方案|边界条件|方案说明|实现思路)/.test(source)
  ) {
    return "design";
  }
  return "general";
}

function modeInstructions(mode) {
  switch (mode) {
    case "task":
      return `- 把文档当作任务执行稿来整理。
- summary 优先说明目标、当前范围和交付方向。
- highlights 优先提炼关键任务、依赖、里程碑、阻塞点。
- sections 优先组织成“目标与范围 / 任务拆解 / 依赖与前置条件 / 风险与阻塞 / 验收与交付”这类结构。
- items 里尽量保留 checklist、步骤顺序、owner 线索、验收条件。`;
    case "api":
      return `- 把文档当作接口阅读稿来整理。
- summary 优先说明接口用途和调用场景。
- highlights 优先提炼接口路径、方法、核心字段、鉴权、约束。
- sections 优先组织成“接口概览 / 请求参数 / 响应结构 / 错误码与异常 / 调用约束与示例”这类结构。
- items 里尽量保留字段名、类型、必填性、枚举值、返回值和错误码。`;
    case "design":
      return `- 把文档当作设计方案来整理。
- summary 优先说明背景、目标和核心改动。
- highlights 优先提炼关键方案决策、影响面、边界条件。
- sections 优先组织成“背景与目标 / 核心方案 / 数据结构与接口 / 风险与边界 / 落地计划”这类结构。
- items 里尽量保留设计权衡、模块改动、依赖、兼容性和后续事项。`;
    default:
      return `- 把文档当作通用知识文档来整理。
- summary 优先说明文档主题和最值得先读的结论。
- highlights 优先提炼结论、规则、步骤、关键名词。
- sections 根据原文自然结构组织，尽量让读者可以快速扫读再回到原文。`;
  }
}

function extractJson(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    return extractFirstJsonObject(trimmed);
  }

  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) return extractFirstJsonObject(match[1].trim());

  const start = trimmed.indexOf("{");
  if (start >= 0) return extractFirstJsonObject(trimmed.slice(start));
  return trimmed;
}

function extractFirstJsonObject(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let started = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (!started) {
      if (char === "{") {
        started = true;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(text.indexOf("{"), index + 1);
      }
    }
  }

  return text;
}

function extractLastAgentMessage(stdout) {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const event = JSON.parse(lines[index]);
      const item = event && event.item;
      if (item && item.type === "agent_message" && typeof item.text === "string") {
        return item.text;
      }
    } catch {
      // Ignore non-JSON lines from the CLI.
    }
  }

  return stdout;
}

function normalizeAiResult(value) {
  return {
    title: stringValue(value.title),
    summary: stringValue(value.summary),
    highlights: stringArray(value.highlights).slice(0, 8),
    sections: arrayValue(value.sections).slice(0, 10).map((section) => ({
      title: stringValue(section.title),
      content: stringValue(section.content),
      items: stringArray(section.items).slice(0, 12),
    })),
    risks: stringArray(value.risks).slice(0, 10),
    todos: stringArray(value.todos).slice(0, 10),
  };
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function stringArray(value) {
  return arrayValue(value).map((item) => stringValue(item)).filter(Boolean);
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
