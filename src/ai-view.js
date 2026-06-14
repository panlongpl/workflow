import { inlineMarkdown } from "./markdown.js";
import { escapeHtml } from "./utils.js";

export function createAiReadingArticle(result, fallbackTitle) {
  const summary = sanitizeTextBlock(result.summary || "");
  const highlights = sanitizeItems(result.highlights);
  const sections = sanitizeSections(result.sections);
  const risks = sanitizeItems(result.risks);
  const todos = sanitizeItems(result.todos);

  const article = document.createElement("article");
  article.className = "markdown-body ai-body";
  article.innerHTML = `
    <section class="ai-hero">
      <h1>${escapeHtml(result.title || fallbackTitle)}</h1>
      ${summary ? `<p class="ai-summary">${inlineMarkdown(summary)}</p>` : ""}
    </section>
    ${renderAiListSection("重点速览", highlights, "ai-pill-list")}
    ${renderAiSections(sections)}
    ${renderAiListSection("风险与待确认", risks)}
    ${renderAiListSection("后续行动", todos)}
  `;
  return article;
}

function renderAiSections(sections = []) {
  if (!sections.length) {
    return "";
  }

  return sections
    .map((section) => `
      <section class="ai-section">
        <h2>${escapeHtml(section.title || "未命名分区")}</h2>
        ${section.content ? `<p>${inlineMarkdown(section.content)}</p>` : ""}
        ${renderPlainList(section.items)}
      </section>
    `)
    .join("");
}

function renderAiListSection(title, items = [], listClass = "") {
  if (!items.length) {
    return "";
  }

  return `
    <section class="ai-section">
      <h2>${escapeHtml(title)}</h2>
      ${renderPlainList(items, listClass)}
    </section>
  `;
}

function renderPlainList(items = [], listClass = "") {
  return `
    <ul class="${escapeHtml(listClass)}">
      ${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}
    </ul>
  `;
}

function sanitizeItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || "").trim())
    .map((item) => sanitizeTextBlock(item))
    .filter(Boolean);
}

function sanitizeSections(sections = []) {
  return (Array.isArray(sections) ? sections : [])
    .map((section) => ({
      title: String(section?.title || "").trim(),
      content: sanitizeTextBlock(String(section?.content || "").trim()),
      items: sanitizeItems(section?.items || []),
    }))
    .filter((section) => section.title || section.content || section.items.length);
}

function sanitizeTextBlock(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^暂无(摘要|内容)?[。.]?$/u.test(text)) return "";
  if (/^无(内容)?[。.]?$/u.test(text)) return "";
  if (/^(未提炼出|没有提炼出).*[。.]?$/u.test(text)) return "";
  if (/^codex 没有提炼出.*[。.]?$/iu.test(text)) return "";
  return text;
}
