import { escapeHtml } from "./utils.js";

export function renderAnnotationHistoryPage({
  count,
  documents,
  mode,
  selectedIds = new Set(),
  dispatchPending = false,
  fileFilter = "all",
  filterDocuments = documents,
  storePath,
  onCopy,
  onFileFilterChange,
  onModeChange,
  onDelete,
  onDeleteSelected,
  onOpen,
  onSend,
  onSendSelected,
  onToggleSelection,
}) {
  const article = document.createElement("article");
  article.className = "history-body";
  article.append(renderHistoryHeader({
    count,
    mode,
    documents: filterDocuments,
    fileFilter,
    selectedCount: selectedIds.size,
    dispatchPending,
    storePath,
    onCopy,
    onFileFilterChange,
    onModeChange,
    onSendSelected,
    onDeleteSelected,
  }));

  if (!documents.length) {
    const empty = document.createElement("section");
    empty.className = "history-empty";
    empty.innerHTML = `
      <h2>还没有历史注释</h2>
      <p>在任意 Markdown 文档里选中文字并点击“记录”后，会出现在这里。</p>
    `;
    article.append(empty);
    return article;
  }

  if (mode === "flat") {
    article.append(renderHistoryFlatNotes(documents));
  } else {
    article.append(renderHistoryAnnotationList({
      documents,
      selectedIds,
      dispatchPending,
      onOpen,
      onSend,
      onDelete,
      onToggleSelection,
    }));
  }

  return article;
}

export function renderAnnotationHistoryError(message) {
  const article = document.createElement("article");
  article.className = "history-body";
  article.innerHTML = `
    <section class="history-empty">
      <h2>历史注释读取失败</h2>
      <p>${escapeHtml(message || "无法读取历史注释。")}</p>
    </section>
  `;
  return article;
}

export function historyNotesText(documents) {
  return flattenedHistoryAnnotations(documents)
    .map(({ annotation }) => singleLineAnnotation(annotation.note))
    .filter(Boolean)
    .join("\n");
}

export function flattenedHistoryAnnotations(documents) {
  return documents
    .flatMap((historyDocument) =>
      (historyDocument.annotations || []).map((annotation) => ({
        historyDocument,
        annotation,
      })),
    )
    .sort((a, b) =>
      Date.parse(b.annotation.updatedAt || b.annotation.createdAt || 0) -
      Date.parse(a.annotation.updatedAt || a.annotation.createdAt || 0),
    );
}

function renderHistoryHeader({
  count,
  mode,
  documents,
  fileFilter,
  selectedCount,
  dispatchPending,
  onCopy,
  onFileFilterChange,
  onModeChange,
  onSendSelected,
  onDeleteSelected,
}) {
  const header = document.createElement("section");
  header.className = "history-header";
  const canSendSelected = mode === "grouped" && selectedCount > 0 && !dispatchPending;
  header.innerHTML = `
    <div class="history-header-actions">
      <div class="history-action-group">
        <label class="history-file-filter" for="historyFileFilter">
          <span>文件</span>
          <select id="historyFileFilter" data-history-file-filter ${mode === "flat" ? "disabled" : ""}>
            <option value="all" ${fileFilter === "all" ? "selected" : ""}>全部文件</option>
            ${documents.map((historyDocument) => {
              const key = historyDocumentFilterKey(historyDocument);
              return `<option value="${escapeHtml(key)}" ${fileFilter === key ? "selected" : ""}>${escapeHtml(historyDocument.fileName || historyDocument.path)}</option>`;
            }).join("")}
          </select>
        </label>
        <div class="history-mode-switch" aria-label="历史注释展示方式">
          <button class="history-mode-button ${mode === "grouped" ? "active" : ""}" type="button" data-history-mode="grouped">列表</button>
          <button class="history-mode-button ${mode === "flat" ? "active" : ""}" type="button" data-history-mode="flat">单行</button>
        </div>
      </div>
      <div class="history-action-group history-batch-actions">
        ${mode === "grouped" ? `<span class="history-selected-count">已选 ${selectedCount} 条</span>` : ""}
        ${mode === "grouped" ? `<button class="jump-button" type="button" data-history-send-selected ${canSendSelected ? "" : "disabled"}>发送给 Agent</button>` : ""}
        ${mode === "grouped" ? `<button class="jump-button danger" type="button" data-history-delete-selected ${canSendSelected ? "" : "disabled"}>删除选中</button>` : ""}
        <button class="jump-button" type="button" data-history-copy ${count ? "" : "disabled"}>复制全部</button>
      </div>
    </div>
  `;
  header.querySelectorAll("[data-history-mode]").forEach((button) => {
    button.addEventListener("click", () => onModeChange(button.dataset.historyMode || "grouped"));
  });
  header.querySelector("[data-history-file-filter]")?.addEventListener("change", (event) => {
    onFileFilterChange(event.target.value || "all");
  });
  header.querySelector("[data-history-send-selected]")?.addEventListener("click", onSendSelected);
  header.querySelector("[data-history-delete-selected]")?.addEventListener("click", onDeleteSelected);
  header.querySelector("[data-history-copy]").addEventListener("click", onCopy);
  return header;
}

function renderHistoryFlatNotes(documents) {
  const section = document.createElement("section");
  section.className = "history-flat";

  const textarea = document.createElement("textarea");
  textarea.className = "history-flat-textarea";
  textarea.readOnly = true;
  textarea.spellcheck = false;
  textarea.value = historyNotesText(documents);
  section.append(textarea);
  return section;
}

function renderHistoryAnnotationList({ documents, selectedIds, dispatchPending, onOpen, onSend, onDelete, onToggleSelection }) {
  const section = document.createElement("section");
  section.className = "history-document";

  const list = document.createElement("div");
  list.className = "history-list";
  flattenedHistoryAnnotations(documents)
    .forEach(({ historyDocument, annotation }) => {
      list.append(renderHistoryAnnotation({
        historyDocument,
        annotation,
        selectedIds,
        dispatchPending,
        onOpen,
        onSend,
        onDelete,
        onToggleSelection,
      }));
    });
  section.append(list);
  return section;
}

function renderHistoryAnnotation({ historyDocument, annotation, selectedIds, dispatchPending, onOpen, onSend, onDelete, onToggleSelection }) {
  const item = document.createElement("div");
  const key = historyAnnotationKey(historyDocument, annotation);
  const isSelected = selectedIds.has(key);
  item.className = `history-item${isSelected ? " selected" : ""}`;
  const checkboxId = `history-select-${hashString(key)}`;
  item.innerHTML = `
    <label class="history-select" for="${checkboxId}" title="选择这条注释">
      <input id="${checkboxId}" type="checkbox" ${isSelected ? "checked" : ""} ${dispatchPending ? "disabled" : ""} />
      <span class="sr-only">选择这条注释</span>
    </label>
    <div class="history-card-body">
      <div class="history-note-block">
        <div class="history-note">${escapeHtml(annotation.note)}</div>
      </div>
      <div class="history-quote-block" aria-label="引用原文">
        <div class="history-card-label">原文</div>
        <div class="history-quote">${escapeHtml(annotation.quote)}</div>
      </div>
    </div>
  `;

  const actions = document.createElement("div");
  actions.className = "history-item-actions history-context-menu";

  const openAction = document.createElement("button");
  openAction.className = "history-card-action";
  openAction.type = "button";
  openAction.textContent = "打开";
  openAction.addEventListener("click", () => {
    closeHistoryContextMenus();
    onOpen(historyDocument, annotation);
  });

  const sendAction = document.createElement("button");
  sendAction.className = "history-card-action";
  sendAction.type = "button";
  sendAction.textContent = "发送";
  sendAction.disabled = dispatchPending;
  sendAction.addEventListener("click", () => {
    closeHistoryContextMenus();
    onSend(historyDocument, annotation);
  });

  const deleteAction = document.createElement("button");
  deleteAction.className = "history-card-action danger";
  deleteAction.type = "button";
  deleteAction.textContent = "删除";
  deleteAction.disabled = dispatchPending;
  deleteAction.addEventListener("click", () => {
    closeHistoryContextMenus();
    onDelete(historyDocument, annotation);
  });

  actions.append(openAction, sendAction, deleteAction);
  actions.addEventListener("click", (event) => event.stopPropagation());
  item.append(actions);

  item.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    closeHistoryContextMenus();
    const rect = item.getBoundingClientRect();
    const fallbackLeft = rect.width - 120;
    const left = event.clientX ? event.clientX - rect.left : fallbackLeft;
    const top = event.clientY ? event.clientY - rect.top : 12;
    actions.style.left = `${Math.max(8, Math.min(left, rect.width - 128))}px`;
    actions.style.top = `${Math.max(8, top)}px`;
    actions.classList.add("is-open");
    setTimeout(() => {
      document.addEventListener("click", closeHistoryContextMenusOnce, { once: true });
      document.addEventListener("keydown", closeHistoryContextMenusOnEscape, { once: true });
    }, 0);
  });

  item.querySelector("input")?.addEventListener("change", (event) => {
    onToggleSelection(historyDocument, annotation, event.target.checked);
  });
  return item;
}

function closeHistoryContextMenus(scope = document) {
  scope.querySelectorAll?.(".history-context-menu.is-open").forEach((menu) => {
    menu.classList.remove("is-open");
  });
}

function closeHistoryContextMenusOnce() {
  closeHistoryContextMenus();
}

function closeHistoryContextMenusOnEscape(event) {
  if (event.key === "Escape") closeHistoryContextMenus();
}

export function historyAnnotationKey(historyDocument, annotation) {
  return JSON.stringify([
    historyDocument.rootPath || "",
    historyDocument.path || "",
    annotation.id || "",
  ]);
}

export function historyDocumentFilterKey(historyDocument) {
  return JSON.stringify([
    historyDocument.rootPath || "",
    historyDocument.path || "",
  ]);
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function singleLineAnnotation(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
