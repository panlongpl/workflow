import { readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCommand } from "./command.mjs";

export async function runCodexForReading({
  appRoot,
  path,
  markdown,
  readingMode,
  timeoutMs,
  model,
}) {
  const outputPath = join(tmpdir(), `markdown-ai-reading-${randomUUID()}.json`);
  const schemaPath = join(appRoot, "ai-reading-schema.json");
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

    if (model) {
      args.splice(4, 0, "-m", model);
    }

    const { stdout, stderr, code } = await runCommand("codex", args, prompt, timeoutMs, appRoot);

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
    } else if (char === "}") {
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
