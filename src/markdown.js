import { escapeHtml } from "./utils.js";

export function markdownToHtml(markdown) {
  const blocks = [];
  let source = markdown.replace(/\r\n?/g, "\n");
  const frontmatter = extractFrontmatter(source);
  const frontmatterHtml = frontmatter ? renderFrontmatter(frontmatter.data) : "";
  if (frontmatter) source = frontmatter.body;

  source = source.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const index = blocks.push(
      `<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(code.trimEnd())}</code></pre>`,
    );
    return `\n@@BLOCK_${index - 1}@@\n`;
  });

  source = source.replace(/^\|(.+)\|\n\|([\s:-]+\|)+\n((?:\|.*\|\n?)*)/gm, (match) => {
    const rows = match
      .trim()
      .split("\n")
      .map((row) => row.slice(1, -1).split("|").map((cell) => cell.trim()));
    const [headers, , ...body] = rows;
    const table = [
      "<table><thead><tr>",
      ...headers.map((cell) => `<th>${inlineMarkdown(cell)}</th>`),
      "</tr></thead><tbody>",
      ...body.flatMap((row) => [
        "<tr>",
        ...row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`),
        "</tr>",
      ]),
      "</tbody></table>",
    ].join("");
    const index = blocks.push(table);
    return `\n@@BLOCK_${index - 1}@@\n`;
  });

  const lines = source.split("\n");
  const html = [];
  let paragraph = [];
  let listStack = [];
  let quote = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const closeLists = (targetDepth = 0) => {
    while (listStack.length > targetDepth) {
      html.push(`</${listStack.pop()}>`);
    }
  };

  const flushQuote = () => {
    if (!quote.length) return;
    html.push(`<blockquote>${quote.map((line) => `<p>${inlineMarkdown(line)}</p>`).join("")}</blockquote>`);
    quote = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const blockMatch = line.match(/^@@BLOCK_(\d+)@@$/);
    if (blockMatch) {
      flushParagraph();
      flushQuote();
      closeLists();
      html.push(blocks[Number(blockMatch[1])]);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushQuote();
      closeLists();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushQuote();
      closeLists();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const quoteLine = line.match(/^>\s?(.*)$/);
    if (quoteLine) {
      flushParagraph();
      closeLists();
      quote.push(quoteLine[1]);
      continue;
    }

    const listItem = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      flushQuote();
      const depth = Math.floor(listItem[1].length / 2);
      const type = /\d+\./.test(listItem[2]) ? "ol" : "ul";
      const level = depth + 1;

      if (listStack[depth] && listStack[depth] !== type) {
        closeLists(depth);
      } else {
        closeLists(level);
      }

      while (listStack.length < level) {
        html.push(`<${type}>`);
        listStack.push(type);
      }

      html.push(`<li>${inlineMarkdown(listItem[3])}</li>`);
      continue;
    }

    closeLists();
    flushQuote();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushQuote();
  closeLists();

  return [frontmatterHtml, html.join("\n")].filter(Boolean).join("\n");
}

function extractFrontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return null;
  return {
    data: parseFrontmatter(match[1]),
    body: source.slice(match[0].length),
  };
}

function parseFrontmatter(value) {
  const data = {};
  let section = "";
  value.split("\n").forEach((line) => {
    const topLevel = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (topLevel) {
      section = topLevel[1];
      if (topLevel[2]) data[section] = cleanFrontmatterValue(topLevel[2]);
      return;
    }

    const nested = line.match(/^\s+([A-Za-z][\w-]*):\s*(.*)$/);
    if (nested && section) {
      data[`${section}.${nested[1]}`] = cleanFrontmatterValue(nested[2]);
    }
  });
  return data;
}

function cleanFrontmatterValue(value) {
  return String(value || "").trim().replace(/^(["'])(.*)\1$/, "$2");
}

function renderFrontmatter(data) {
  const name = data.name;
  const description = data.description;
  const details = Object.entries(data)
    .filter(([key, value]) => value && key !== "name" && key !== "description");

  if (!name && !description && !details.length) return "";

  return `
    <section class="markdown-frontmatter">
      ${name ? `<h1>${inlineMarkdown(name)}</h1>` : ""}
      ${description ? `<p class="frontmatter-description">${inlineMarkdown(description)}</p>` : ""}
      ${details.length ? `
        <dl class="frontmatter-meta">
          ${details.map(([key, value]) => `
            <div>
              <dt>${escapeHtml(formatFrontmatterKey(key))}</dt>
              <dd>${inlineMarkdown(value)}</dd>
            </div>
          `).join("")}
        </dl>
      ` : ""}
    </section>
  `;
}

function formatFrontmatterKey(key) {
  return key.replace(/^metadata\./, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function inlineMarkdown(text) {
  let escaped = escapeHtml(text);
  const code = [];
  escaped = escaped.replace(/`([^`]+)`/g, (_, value) => {
    const index = code.push(`<code>${value}</code>`);
    return `§§CODE${index - 1}§§`;
  });
  escaped = escaped
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" />')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*\s][^*]*?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])__([^_\s][^_]*?)__(?!\w)/g, "$1<strong>$2</strong>")
    .replace(/\*([^*\s][^*]*?)\*/g, "<em>$1</em>")
    .replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
  code.forEach((html, index) => {
    escaped = escaped.replace(`§§CODE${index}§§`, html);
  });
  return escaped;
}
