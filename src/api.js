async function parseJsonResponse(response, fallbackError) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || fallbackError);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function postJson(url, body, fallbackError) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJsonResponse(response, fallbackError);
}

export async function chooseDirectorySnapshot() {
  const response = await fetch("/api/choose-directory", { method: "POST" });
  return parseJsonResponse(response, "无法选择目录。");
}

export async function readDirectorySnapshot(rootPath) {
  return postJson("/api/read-directory", { rootPath }, "自动同步失败");
}

export async function readMarkdownFile(rootPath, path) {
  return postJson("/api/read-file", { rootPath, path }, "无法读取这个 Markdown 文件。");
}

export async function generateAiReading({ path, lastModified, markdown, readingMode }) {
  return postJson(
    "/api/ai-read",
    { path, lastModified, markdown, readingMode },
    "AI 阅读版生成失败",
  );
}

export async function readAnnotations(rootPath, path) {
  const payload = await postJson("/api/annotations/list", { rootPath, path }, "无法读取注释。");
  return payload.annotations || [];
}

export async function saveAnnotationRecord(rootPath, path, annotation) {
  return postJson(
    "/api/annotations/save",
    { rootPath, path, annotation },
    "保存记录失败。",
  );
}

export async function deleteAnnotationRecord(rootPath, path, id) {
  return postJson(
    "/api/annotations/delete",
    { rootPath, path, id },
    "删除记录失败。",
  );
}

export async function readAnnotationHistory() {
  const response = await fetch("/api/annotations/all");
  return parseJsonResponse(response, "无法读取历史注释。");
}

export async function readAgentStatus() {
  const response = await fetch("/api/agent-status");
  return parseJsonResponse(response, "无法读取 Agent 状态。");
}

export async function readBookmarkletConfig() {
  const response = await fetch("/api/bookmarklet-config");
  return parseJsonResponse(response, "无法读取测试反馈工具配置。");
}
