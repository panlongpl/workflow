import { escapeHtml } from "./utils.js";

export function markdownToHtml(markdown) {
  const blocks = [];
  let source = markdown.replace(/\r\n?/g, "\n");
  const frontmatter = extractFrontmatter(source);
  const frontmatterHtml = frontmatter ? renderFrontmatter(frontmatter.data) : "";
  if (frontmatter) source = frontmatter.body;

  source = source.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const index = blocks.push(renderFencedCode(lang, code));
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

function renderFencedCode(lang, code) {
  if (isDotGraph(lang, code)) {
    const graph = renderDotGraph(code);
    if (graph) return graph;
  }

  const language = normalizeCodeLanguage(lang, code);
  if (!language) {
    return `<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(code.trimEnd())}</code></pre>`;
  }

  return `
    <figure class="code-block code-block-${escapeHtml(language.id)}">
      <figcaption>${escapeHtml(language.label)}</figcaption>
      <pre><code class="language-${escapeHtml(language.id)}">${highlightCode(code.trimEnd(), language.id)}</code></pre>
    </figure>
  `;
}

function normalizeCodeLanguage(lang, code) {
  const value = String(lang || "").trim().toLowerCase();
  const aliases = {
    bash: ["bash", "shell", "sh", "zsh", "fish", "console", "terminal"],
    python: ["python", "py"],
    java: ["java"],
    javascript: ["javascript", "js", "jsx"],
    typescript: ["typescript", "ts", "tsx"],
    json: ["json"],
    yaml: ["yaml", "yml"],
  };
  const labels = {
    bash: "Shell",
    python: "Python",
    java: "Java",
    javascript: "JavaScript",
    typescript: "TypeScript",
    json: "JSON",
    yaml: "YAML",
  };

  const id = Object.entries(aliases).find(([, values]) => values.includes(value))?.[0] || inferCodeLanguage(code);
  return id ? { id, label: labels[id] || id } : null;
}

function inferCodeLanguage(code) {
  if (/^\s*(?:#|(?:python|pip|npm|pnpm|yarn|git|curl|cd|mkdir|rm|cp|mv|ls|cat|grep|rg|sed|awk|chmod|export|source|brew|docker|kubectl|mvn|gradle|java)\b|[A-Z_][A-Z0-9_]*=)/m.test(code)) {
    return "bash";
  }
  if (/^\s*(?:def|class|import|from|if __name__|print\()/m.test(code)) return "python";
  if (/\b(?:public|private|protected)\s+(?:static\s+)?(?:class|interface|enum|void|[\w<>\[\]]+\s+\w+\s*\()/.test(code)) {
    return "java";
  }
  if (/^\s*[{[][\s\S]*[}\]]\s*$/.test(code)) return "json";
  return "";
}

function highlightCode(code, language) {
  const escaped = escapeHtml(code);
  if (language === "bash") return highlightShell(escaped);
  if (language === "python") return highlightGenericCode(escaped, [
    "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else",
    "except", "False", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "None",
    "nonlocal", "not", "or", "pass", "raise", "return", "True", "try", "while", "with", "yield",
  ], /#.*$/gm);
  if (language === "java") return highlightGenericCode(escaped, [
    "abstract", "boolean", "break", "byte", "case", "catch", "char", "class", "const", "continue", "default",
    "do", "double", "else", "enum", "extends", "final", "finally", "float", "for", "if", "implements",
    "import", "instanceof", "int", "interface", "long", "new", "null", "package", "private", "protected",
    "public", "return", "short", "static", "super", "switch", "this", "throw", "throws", "try", "void",
    "while", "true", "false",
  ], /\/\/.*$/gm);
  if (language === "javascript" || language === "typescript") return highlightGenericCode(escaped, [
    "async", "await", "break", "case", "catch", "class", "const", "continue", "default", "delete", "do",
    "else", "export", "extends", "false", "finally", "for", "from", "function", "if", "import", "in",
    "instanceof", "let", "new", "null", "return", "static", "super", "switch", "this", "throw", "true",
    "try", "typeof", "undefined", "var", "void", "while", "yield",
  ], /\/\/.*$/gm);
  if (language === "json" || language === "yaml") return highlightDataCode(escaped);
  return escaped;
}

function highlightShell(escaped) {
  const stash = [];
  let html = protectCodeTokens(escaped, /(["'])(?:\\.|(?!\1)[\s\S])*?\1/g, "code-string", stash);
  html = protectCodeTokens(html, /(^|\s)#.*$/gm, "code-comment", stash);
  html = html.replace(/(^|\n)(\s*)([./\w-]+)(?=\s|$)/g, '$1$2<span class="code-command">$3</span>');
  html = html.replace(/(^|\s)(-{1,2}[\w-]+)/g, '$1<span class="code-option">$2</span>');
  html = html.replace(/(\$[A-Za-z_][\w]*|\$\{[^}]+})/g, '<span class="code-variable">$1</span>');
  return restoreCodeTokens(html, stash);
}

function highlightGenericCode(escaped, keywords, commentPattern) {
  const stash = [];
  let html = protectCodeTokens(escaped, /(["'`])(?:\\.|(?!\1)[\s\S])*?\1/g, "code-string", stash);
  html = protectCodeTokens(html, commentPattern, "code-comment", stash);
  html = html.replace(new RegExp(`\\b(${keywords.join("|")})\\b`, "g"), '<span class="code-keyword">$1</span>');
  html = html.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="code-number">$1</span>');
  html = html.replace(/(@[A-Za-z_][\w.]*)/g, '<span class="code-annotation">$1</span>');
  return restoreCodeTokens(html, stash);
}

function highlightDataCode(escaped) {
  const stash = [];
  let html = protectCodeTokens(escaped, /(["'])(?:\\.|(?!\1)[\s\S])*?\1/g, "code-string", stash);
  html = html.replace(/\b(true|false|null)\b/g, '<span class="code-keyword">$1</span>');
  html = html.replace(/\b(-?\d+(?:\.\d+)?)\b/g, '<span class="code-number">$1</span>');
  return restoreCodeTokens(html, stash);
}

function protectCodeTokens(source, pattern, className, stash) {
  return source.replace(pattern, (match) => {
    const index = stash.push(`<span class="${className}">${match}</span>`) - 1;
    return `\uE000${index}\uE001`;
  });
}

function restoreCodeTokens(source, stash) {
  return source.replace(/\uE000(\d+)\uE001/g, (_, index) => stash[Number(index)] || "");
}

function isDotGraph(lang, code) {
  const normalizedLang = String(lang || "").trim().toLowerCase();
  return ["dot", "gv", "graphviz"].includes(normalizedLang) ||
    /^\s*(?:di)?graph(?:\s+[\w-]+)?\s*\{/.test(code);
}

function renderDotGraph(code) {
  const graph = parseDotGraph(code);
  if (!graph.nodes.length || !graph.edges.length) return "";

  const layout = layoutDotGraph(graph);
  const arrowId = `workflow-arrow-${hashText(code)}`;
  const nodes = layout.nodes.map((node) => renderDotNode(node)).join("");
  const edges = layout.edges.map((edge) => renderDotEdge(edge, arrowId)).join("");

  return `
    <figure class="workflow-diagram" aria-label="工作流图">
      <svg viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="工作流">
        <defs>
          <marker id="${arrowId}" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L9,4.5 L0,9 Z" fill="currentColor"></path>
          </marker>
        </defs>
        ${edges}
        ${nodes}
      </svg>
    </figure>
  `;
}

function parseDotGraph(code) {
  const nodeMap = new Map();
  const edges = [];
  const order = [];

  const ensureNode = (id) => {
    if (!nodeMap.has(id)) {
      nodeMap.set(id, { id, label: id, shape: "box" });
      order.push(id);
    }
    return nodeMap.get(id);
  };

  const statements = code
    .replace(/\/\/.*$/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const statement of statements) {
    if (/^(?:di)?graph\b|\{|}|rankdir\s*=/.test(statement)) continue;

    if (statement.includes("->")) {
      const ids = statement
        .replace(/;$/, "")
        .split("->")
        .map((part) => part.match(/^\s*([A-Za-z_][\w-]*)/)?.[1])
        .filter(Boolean);

      ids.forEach((id) => ensureNode(id));
      for (let index = 0; index < ids.length - 1; index += 1) {
        edges.push({ from: ids[index], to: ids[index + 1] });
      }
      continue;
    }

    const node = statement.match(/^([A-Za-z_][\w-]*)\s*\[(.+)]\s*;?$/);
    if (!node) continue;

    const id = node[1];
    const attrs = parseDotAttributes(node[2]);
    const item = ensureNode(id);
    item.label = attrs.label || id;
    item.shape = attrs.shape || item.shape;
  }

  return {
    nodes: order.map((id) => nodeMap.get(id)),
    edges,
  };
}

function parseDotAttributes(value) {
  const attrs = {};
  const attrPattern = /(\w+)\s*=\s*("(?:\\"|[^"])*"|[^,\]]+)/g;
  let match;
  while ((match = attrPattern.exec(value))) {
    attrs[match[1]] = cleanDotValue(match[2]);
  }
  return attrs;
}

function cleanDotValue(value) {
  return String(value || "")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, "\n");
}

function layoutDotGraph(graph) {
  const nodesById = new Map(graph.nodes.map((node, index) => [node.id, { ...node, order: index }]));
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, []]));

  graph.edges.forEach((edge) => {
    if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) return;
    incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
    outgoing.get(edge.from).push(edge.to);
  });

  const rank = new Map();
  const queue = graph.nodes
    .filter((node) => (incoming.get(node.id) || 0) === 0)
    .map((node) => node.id);

  if (!queue.length && graph.nodes[0]) queue.push(graph.nodes[0].id);
  queue.forEach((id) => rank.set(id, 0));

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    const baseRank = rank.get(id) || 0;
    (outgoing.get(id) || []).forEach((nextId) => {
      const nextRank = Math.max(rank.get(nextId) || 0, baseRank + 1);
      rank.set(nextId, nextRank);
      if (!queue.includes(nextId)) queue.push(nextId);
    });
  }

  graph.nodes.forEach((node) => {
    if (!rank.has(node.id)) rank.set(node.id, 0);
  });

  const levels = [];
  graph.nodes.forEach((node) => {
    const level = rank.get(node.id) || 0;
    if (!levels[level]) levels[level] = [];
    levels[level].push(nodesById.get(node.id));
  });

  const horizontalGap = 44;
  const verticalGap = 72;
  const padding = 36;
  let y = padding;
  let width = 720;
  const positioned = [];

  levels.forEach((levelNodes) => {
    levelNodes.sort((a, b) => a.order - b.order);
    levelNodes.forEach((node) => {
      node.lines = wrapDotLabel(node.label);
      const maxUnits = Math.max(...node.lines.map((line) => displayWidth(line)), 8);
      node.width = Math.min(Math.max(maxUnits * 9 + 42, 154), node.shape === "diamond" ? 260 : 340);
      node.height = Math.max(node.lines.length * 22 + 30, node.shape === "diamond" ? 86 : 66);
      if (node.shape === "diamond") {
        node.width = Math.max(node.width, node.height * 1.45);
      }
    });

    const levelWidth = levelNodes.reduce((sum, node) => sum + node.width, 0) + horizontalGap * (levelNodes.length - 1);
    width = Math.max(width, levelWidth + padding * 2);
    const rowHeight = Math.max(...levelNodes.map((node) => node.height));
    let x = (width - levelWidth) / 2;
    levelNodes.forEach((node) => {
      node.x = x;
      node.y = y + (rowHeight - node.height) / 2;
      positioned.push(node);
      x += node.width + horizontalGap;
    });
    y += rowHeight + verticalGap;
  });

  const height = Math.max(y - verticalGap + padding, 160);
  const layoutNodes = positioned.map((node) => ({ ...node }));
  const layoutMap = new Map(layoutNodes.map((node) => [node.id, node]));
  const layoutEdges = graph.edges
    .map((edge) => ({ from: layoutMap.get(edge.from), to: layoutMap.get(edge.to) }))
    .filter((edge) => edge.from && edge.to);

  return { width, height, nodes: layoutNodes, edges: layoutEdges };
}

function wrapDotLabel(label) {
  const lines = String(label || "")
    .split("\n")
    .flatMap((line) => wrapLine(line.trim(), 34))
    .filter((line) => line.length);
  return lines.length ? lines : [""];
}

function wrapLine(line, maxUnits) {
  if (displayWidth(line) <= maxUnits) return [line];

  const chunks = [];
  let current = "";
  let currentWidth = 0;
  for (const char of Array.from(line)) {
    const width = displayWidth(char);
    if (current && currentWidth + width > maxUnits) {
      chunks.push(current.trimEnd());
      current = "";
      currentWidth = 0;
    }
    current += char;
    currentWidth += width;
  }
  if (current) chunks.push(current.trimEnd());
  return chunks;
}

function displayWidth(value) {
  return Array.from(String(value || "")).reduce((sum, char) => {
    return sum + (/[\u2e80-\u9fff\uff00-\uffef]/.test(char) ? 2 : 1);
  }, 0);
}

function renderDotNode(node) {
  const centerX = node.x + node.width / 2;
  const centerY = node.y + node.height / 2;
  const textY = centerY - ((node.lines.length - 1) * 11);
  const lines = node.lines
    .map((line, index) => `<tspan x="${centerX}" y="${textY + index * 22}">${escapeHtml(line)}</tspan>`)
    .join("");

  if (node.shape === "diamond") {
    const points = [
      `${centerX},${node.y}`,
      `${node.x + node.width},${centerY}`,
      `${centerX},${node.y + node.height}`,
      `${node.x},${centerY}`,
    ].join(" ");
    return `
      <g class="workflow-node workflow-node-decision">
        <polygon points="${points}"></polygon>
        <text>${lines}</text>
      </g>
    `;
  }

  return `
    <g class="workflow-node">
      <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="16" ry="16"></rect>
      <text>${lines}</text>
    </g>
  `;
}

function renderDotEdge(edge, arrowId) {
  const startX = edge.from.x + edge.from.width / 2;
  const startY = edge.from.y + edge.from.height;
  const endX = edge.to.x + edge.to.width / 2;
  const endY = edge.to.y;
  const midY = startY + Math.max(28, (endY - startY) / 2);
  const path = `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
  return `<path class="workflow-edge" d="${path}" marker-end="url(#${arrowId})"></path>`;
}

function hashText(value) {
  let hash = 0;
  for (const char of String(value)) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
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
    const className = inlineCodeClassName(value);
    const index = code.push(`<code class="${className}">${value}</code>`);
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

function inlineCodeClassName(value) {
  const text = String(value || "");
  const isCommandLike = /[/:]|--|\\n|[A-Za-z_][\w-]*=/.test(text);
  return [
    "inline-code",
    text.length >= 18 || isCommandLike ? "inline-code-long" : "",
  ].filter(Boolean).join(" ");
}
