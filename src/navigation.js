import { escapeHtml, formatDate } from "./utils.js";

export function renderNavigation({ state, els, onOpenFile }) {
  const files = getFilteredFiles(state);
  els.recentCount.textContent = files.length;
  els.treeCount.textContent = files.length;
  els.recentList.replaceChildren(
    ...files.map((file) => renderFileButton(file, state, onOpenFile, { showTooltip: true })),
  );
  els.treeList.replaceChildren(
    state.tree ? renderTreeNode(state.tree, state, onOpenFile, true, []) : document.createDocumentFragment(),
  );
}

function getFilteredFiles(state) {
  if (!state.query) return [...state.files];
  return state.files.filter((file) =>
    file.path.toLowerCase().includes(state.query),
  );
}

function renderFileButton(file, state, onOpenFile, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = [
    "file-button",
    file.path === state.activePath ? "active" : "",
    options.showTooltip ? "show-tooltip" : "",
  ].filter(Boolean).join(" ");
  button.title = file.path;
  button.dataset.path = file.path;
  button.innerHTML = `
    <span class="file-name">${escapeHtml(file.name)}</span>
    <span class="file-meta">${escapeHtml(formatDate(file.lastModified))} · ${escapeHtml(file.path)}</span>
  `;
  button.addEventListener("click", () => onOpenFile(file));
  return button;
}

function renderTreeNode(node, state, onOpenFile, isRoot = false, pathParts = []) {
  const container = document.createElement("div");
  container.className = isRoot ? "tree-root" : "tree-children";

  const visibleFiles = node.files.filter((file) => matchesQuery(file, state));
  const visibleDirs = node.dirs
    .map((dir) => ({ dir, hasVisible: treeHasMatches(dir, state) }))
    .filter((entry) => entry.hasVisible)
    .map((entry) => entry.dir);

  if (!isRoot) {
    const directoryPath = pathParts.join("/");
    const details = document.createElement("details");
    details.open = Boolean(state.query) || state.expandedDirs.has(directoryPath);
    details.addEventListener("toggle", () => {
      if (details.open) {
        state.expandedDirs.add(directoryPath);
      } else {
        state.expandedDirs.delete(directoryPath);
      }
    });
    const summary = document.createElement("summary");
    summary.textContent = node.name;
    details.append(summary);
    const children = document.createElement("div");
    children.className = "tree-children";
    visibleDirs.forEach((dir) => children.append(renderTreeNode(dir, state, onOpenFile, false, [...pathParts, dir.name])));
    visibleFiles.forEach((file) => children.append(renderFileButton(file, state, onOpenFile)));
    details.append(children);
    return details;
  }

  visibleDirs.forEach((dir) => container.append(renderTreeNode(dir, state, onOpenFile, false, [dir.name])));
  visibleFiles.forEach((file) => container.append(renderFileButton(file, state, onOpenFile)));
  return container;
}

function treeHasMatches(node, state) {
  return (
    node.files.some((file) => matchesQuery(file, state)) ||
    node.dirs.some((child) => treeHasMatches(child, state))
  );
}

function matchesQuery(file, state) {
  return !state.query || file.path.toLowerCase().includes(state.query);
}
