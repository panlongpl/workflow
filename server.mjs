import { createServer } from "node:http";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const root = new URL(".", import.meta.url).pathname;
const port = Number(process.env.PORT || 4173);
const maxBodySize = 900_000;
const codexTimeoutMs = Number(process.env.CODEX_TIMEOUT_MS || 180_000);
const codexModel = process.env.CODEX_MODEL || "";

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

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    await serveStatic(url.pathname, response, request.method === "HEAD");
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Internal server error" });
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

  if (!markdown.trim()) {
    sendJson(response, 400, { error: "Markdown 内容为空" });
    return;
  }

  const result = await runCodexForReading(path, markdown);
  sendJson(response, 200, { result });
}

async function serveStatic(pathname, response, headOnly) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const localPath = normalize(join(root, cleanPath));

  if (!localPath.startsWith(root)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  const type = mimeTypes[extname(localPath)] || "application/octet-stream";
  response.writeHead(200, { "content-type": type });
  if (!headOnly) {
    createReadStream(localPath).pipe(response);
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

async function runCodexForReading(path, markdown) {
  const outputPath = join(tmpdir(), `markdown-ai-reading-${randomUUID()}.json`);
  const schemaPath = join(root, "ai-reading-schema.json");
  const prompt = buildPrompt(path, markdown);

  try {
    const args = [
        "exec",
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
      args.splice(3, 0, "-m", codexModel);
    }

    await runCommand("codex", args, prompt, codexTimeoutMs);

    const raw = await readFile(outputPath, "utf8");
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

    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Codex 生成超时"));
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(cleanCodexError(stderr) || `Codex exited with code ${code}`));
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

function buildPrompt(path, markdown) {
  return `你是一个文档阅读整理助手。请阅读下面 Markdown 文档，输出严格符合 JSON Schema 的 JSON，不要输出 Markdown、代码围栏或额外解释。

目标：把文档整理成更便于阅读的结构化内容，忠于原文，不要编造。

要求：
- title: 使用文档最合适的标题，若无法判断则用文件名。
- summary: 1-2 句总结文档核心内容。
- highlights: 3-6 条最重要的信息。
- sections: 3-8 个阅读分区；content 用简洁中文说明；items 放字段、步骤、规则、接口、结论等列表。
- risks: 文档中的风险、缺口、待确认点；没有则返回空数组。
- todos: 文档中明确或可合理提炼的后续行动；没有则返回空数组。
- 保留关键英文标识、接口路径、字段名和代码符号。

文件路径：${path}

Markdown 内容：
${markdown}`;
}

function extractJson(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return trimmed;

  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) return match[1].trim();

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
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
