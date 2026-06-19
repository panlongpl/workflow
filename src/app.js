import {
  chooseDirectorySnapshot,
  deleteAnnotationRecord,
  generateAiReading,
  readAnnotationHistory,
  readAnnotations,
  readAgentStatus,
  readBookmarkletConfig,
  readDirectorySnapshot,
  readMarkdownFile,
  saveAnnotationRecord,
} from "./api.js";
import { createAiReadingArticle } from "./ai-view.js";
import { applyAnnotationHighlights } from "./annotations.js";
import { createDocumentPanel } from "./document-panel.js";
import { markdownToHtml } from "./markdown.js";
import { renderNavigation as renderNavigationView } from "./navigation.js";
import {
  createToastController,
  initResizableSidebar,
  scrollContentTo as scrollContentShellTo,
  setLoading as setLoadingState,
} from "./ui.js";
import { createTerminalController } from "./terminal.js";
import { renderBookmarkletPage } from "./bookmarklet.js";
import {
  createTreeNode,
  escapeHtml,
  formatDate,
  formatSize,
  readingModeLabel,
  waitForPaint,
} from "./utils.js";
import {
  flattenedHistoryAnnotations,
  historyAnnotationKey,
  historyDocumentFilterKey,
  historyNotesText,
  renderAnnotationHistoryError,
  renderAnnotationHistoryPage as createAnnotationHistoryPage,
} from "./history.js";

const state = {
  files: [],
  tree: null,
  activePath: "",
  query: "",
  expandedDirs: new Set(),
  searchExpandedDirsSnapshot: null,
  rootPath: "",
  currentFile: null,
  currentMarkdown: "",
  annotations: [],
  annotationHistory: [],
  annotationHistoryMode: "grouped",
  annotationHistoryFileFilter: "all",
  selectedHistoryAnnotationIds: new Set(),
  annotationStorePath: "",
  annotationDraft: null,
  annotationDispatchPending: false,
  historyDispatchPending: false,
  annotationPanelTab: "outline",
  activeModule: "markdown",
  viewMode: "raw",
  refreshInFlight: false,
  refreshTimer: null,
  eventSource: null,
  eventRefreshTimer: null,
  aiPendingKey: "",
  aiPendingPath: "",
  aiErrorPath: "",
  aiErrorMessage: "",
  readingMode: "auto",
  annotationAutoSend: false,
  toastAction: null,
  toastTimer: null,
};

const AI_CACHE_VERSION = "v3-mode-aware";
const LAST_DIRECTORY_STORAGE_KEY = "markdown-viewer-last-directory-v1";
const ANNOTATION_AUTO_SEND_STORAGE_KEY = "markdown-viewer-annotation-auto-send-v1";
const HISTORY_BATCH_LIMIT = 20;

const els = {
  app: document.querySelector(".app"),
  chooseDir: document.querySelector("#chooseDir"),
  currentPath: document.querySelector("#currentPath"),
  resizer: document.querySelector("#resizer"),
  search: document.querySelector("#search"),
  recentList: document.querySelector("#recentList"),
  treeList: document.querySelector("#treeList"),
  recentCount: document.querySelector("#recentCount"),
  treeCount: document.querySelector("#treeCount"),
  docName: document.querySelector("#docName"),
  docPath: document.querySelector("#docPath"),
  docOutline: document.querySelector("#docOutline"),
  outlineList: document.querySelector("#outlineList"),
  outlineTab: document.querySelector("#outlineTab"),
  selectionRecord: document.querySelector("#selectionRecord"),
  annotationDrawer: document.querySelector("#annotationDrawer"),
  annotationQuote: document.querySelector("#annotationQuote"),
  annotationText: document.querySelector("#annotationText"),
  annotationClose: document.querySelector("#annotationClose"),
  annotationDelete: document.querySelector("#annotationDelete"),
  annotationSave: document.querySelector("#annotationSave"),
  annotationSend: document.querySelector("#annotationSend"),
  rawView: document.querySelector("#rawView"),
  aiView: document.querySelector("#aiView"),
  historyView: document.querySelector("#historyView"),
  markdownModule: document.querySelector("#markdownModule"),
  terminalModule: document.querySelector("#terminalModule"),
  feedbackModule: document.querySelector("#feedbackModule"),
  markdownControls: document.querySelector("#markdownControls"),
  historyToolbarSlot: document.querySelector("#historyToolbarSlot"),
  readingMode: document.querySelector("#readingMode"),
  annotationAutoSend: document.querySelector("#annotationAutoSend"),
  regenerateAi: document.querySelector("#regenerateAi"),
  terminalHeaderActions: document.querySelector("#terminalHeaderActions"),
  agentAvailability: document.querySelector("#agentAvailability"),
  agentAvailabilityText: document.querySelector("#agentAvailabilityText"),
  terminalClear: document.querySelector("#terminalClear"),
  terminalStop: document.querySelector("#terminalStop"),
  terminalFullscreen: document.querySelector("#terminalFullscreen"),
  terminalReconnect: document.querySelector("#terminalReconnect"),
  terminalRestart: document.querySelector("#terminalRestart"),
  toast: document.querySelector("#toast"),
  toastMessage: document.querySelector("#toastMessage"),
  toastDismiss: document.querySelector("#toastDismiss"),
  toastAction: document.querySelector("#toastAction"),
  scrollTop: document.querySelector("#scrollTop"),
  scrollBottom: document.querySelector("#scrollBottom"),
  status: document.querySelector("#status"),
  contentShell: document.querySelector("#contentShell"),
  loadingText: document.querySelector("#loadingText"),
  supportNotice: document.querySelector("#supportNotice"),
};

const documentPanel = createDocumentPanel({ state, els, openAnnotationDrawer });
const { showToast, hideToast } = createToastController({ state, els });
const terminalController = createTerminalController({
  getCwd: () => state.rootPath || ".",
  fullscreenButton: els.terminalFullscreen,
  setStatus: (message) => {
    if (state.activeModule === "terminal") {
      els.status.textContent = message;
    }
  },
  onAvailabilityChange: (status) => renderAgentAvailability(status),
});

els.chooseDir.disabled = false;
els.chooseDir.textContent = "选择本地目录";
els.currentPath.textContent = "尚未选择目录";

els.chooseDir.addEventListener("click", chooseDirectory);
els.search.addEventListener("input", () => {
  updateSearchQuery(els.search.value);
  renderNavigation();
});
els.markdownModule.addEventListener("click", () => switchModule("markdown"));
els.terminalModule.addEventListener("click", () => switchModule("terminal"));
els.feedbackModule.addEventListener("click", () => switchModule("feedback"));
els.rawView.addEventListener("click", () => switchView("raw"));
els.aiView.addEventListener("click", () => {
  const aiErrored = Boolean(state.aiErrorPath) && state.currentFile && state.aiErrorPath === state.currentFile.path;
  switchView("ai", aiErrored ? { regenerate: true } : {});
});
els.historyView.addEventListener("click", () => switchView("history"));
els.terminalClear.addEventListener("click", () => terminalController.clear());
els.terminalStop.addEventListener("click", () => terminalController.interrupt());
els.terminalFullscreen.addEventListener("click", () => terminalController.toggleFullscreen());
els.terminalReconnect.addEventListener("click", () => terminalController.reconnect());
els.terminalRestart.addEventListener("click", () => terminalController.restart());
els.readingMode.addEventListener("change", () => {
  state.readingMode = els.readingMode.value;
  if (!state.currentFile) return;
  const wasAi = state.viewMode === "ai";
  if (wasAi) {
    switchView("ai");
  } else {
    showToast(`已切换到${readingModeLabel(state.readingMode)}。下次生成 AI 阅读版时生效。`);
  }
});
els.regenerateAi.addEventListener("click", () => switchView("ai", { regenerate: true }));
els.annotationAutoSend.addEventListener("change", () => {
  state.annotationAutoSend = els.annotationAutoSend.checked;
  saveAnnotationAutoSendPreference(state.annotationAutoSend);
  showToast(state.annotationAutoSend ? "已开启评论保存后自动发送。" : "已关闭评论保存后自动发送。");
});
els.toastDismiss.addEventListener("click", hideToast);
els.toastAction.addEventListener("click", () => {
  const action = state.toastAction;
  hideToast();
  if (typeof action === "function") action();
});
els.scrollTop?.addEventListener("click", () => scrollContentShellTo(els, "top"));
els.scrollBottom.addEventListener("click", () => scrollContentShellTo(els, "bottom"));
els.outlineTab.addEventListener("click", () => documentPanel.switchAnnotationPanel("outline"));
els.selectionRecord.addEventListener("click", () => openAnnotationDrawer(state.annotationDraft));
els.annotationClose.addEventListener("click", closeAnnotationDrawer);
els.annotationSave.addEventListener("click", () => saveCurrentAnnotation({ forceDispatch: false }));
els.annotationSend.addEventListener("click", () => saveCurrentAnnotation({ forceDispatch: true }));
els.annotationDelete.addEventListener("click", deleteCurrentAnnotation);
els.contentShell.addEventListener("mouseup", handleTextSelection);
els.contentShell.addEventListener("keyup", handleTextSelection);
els.contentShell.addEventListener("scroll", hideSelectionRecord);
initResizableSidebar(els);
restoreAnnotationAutoSendPreference();
updateModuleControls();
updateViewButtons();
renderAgentAvailability();
restoreRememberedDirectoryOnStartup();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.activeModule === "markdown") refreshDirectoryIfNeeded();
});
window.addEventListener("focus", () => {
  if (state.activeModule === "markdown") refreshDirectoryIfNeeded();
});

async function switchModule(module) {
  if (module === "feedback") {
    renderFeedbackModule();
    return;
  }

  if (module === "terminal") {
    renderTerminalModule();
    return;
  }

  await renderMarkdownModule();
}

function setActiveModule(module) {
  state.activeModule = module;
  updateModuleControls();
}

function updateModuleControls() {
  els.app.classList.toggle("module-terminal", state.activeModule === "terminal");
  els.app.classList.toggle("module-feedback", state.activeModule === "feedback");
  els.markdownModule.classList.toggle("active", state.activeModule === "markdown");
  els.terminalModule.classList.toggle("active", state.activeModule === "terminal");
  els.feedbackModule.classList.toggle("active", state.activeModule === "feedback");
  els.markdownModule.setAttribute("aria-pressed", state.activeModule === "markdown" ? "true" : "false");
  els.terminalModule.setAttribute("aria-pressed", state.activeModule === "terminal" ? "true" : "false");
  els.feedbackModule.setAttribute("aria-pressed", state.activeModule === "feedback" ? "true" : "false");
  renderAgentAvailability();
}

function renderAgentAvailability(status = terminalController.getDispatchStatus()) {
  if (!els.agentAvailability || !els.agentAvailabilityText) return;
  const tone = status.tone || (status.ok ? "available" : "idle");
  const text = status.text || status.message || "无可用 Agent";
  const ariaLabel = status.ariaLabel || `Agent 状态：${text}`;

  els.agentAvailability.className = `agent-availability is-${tone}`;
  els.agentAvailability.title = status.title || status.message || text;
  els.agentAvailability.setAttribute("aria-label", ariaLabel);
  els.agentAvailabilityText.textContent = text;
}

async function renderMarkdownModule() {
  setActiveModule("markdown");
  hideSelectionRecord();
  closeAnnotationDrawer();
  updateViewButtons();

  if (state.viewMode === "history") {
    await renderAnnotationHistory();
  } else if (state.currentFile) {
    await switchView(state.viewMode === "ai" ? "ai" : "raw");
  } else if (state.rootPath) {
    renderEmpty("未打开文件", "选择左侧 Markdown 文件后在这里预览");
  } else {
    renderEmpty("选择一个本地目录", "左侧会生成两个入口：最近更新按 Markdown 文件更新时间倒序排列，目录结构保留原始层级。");
  }

  refreshDirectoryIfNeeded();
}

async function chooseDirectory() {
  els.chooseDir.disabled = true;
  els.chooseDir.textContent = "选择中...";
  els.status.textContent = "等待目录选择";

  try {
    const snapshot = await chooseDirectorySnapshot();

    if (snapshot.canceled) {
      els.status.textContent = "已取消选择";
      return;
    }

    await loadDirectorySnapshot(snapshot);
  } catch (error) {
    els.status.textContent = "读取失败";
    renderEmpty("目录读取失败", error.message || "无法读取这个目录。");
  } finally {
    els.chooseDir.disabled = false;
    els.chooseDir.textContent = "选择本地目录";
  }
}

async function loadDirectorySnapshot(snapshot) {
  try {
    setLoadingState(els, true, "正在解析目录");
    await waitForPaint();
    els.status.textContent = "扫描中";
    state.activePath = "";
    state.rootPath = snapshot.rootPath;
    state.expandedDirs.clear();
    state.searchExpandedDirsSnapshot = null;
    els.currentPath.textContent = snapshot.rootName || snapshot.rootPath;
    state.files = snapshot.files || [];
    state.tree = snapshot.tree || createTreeNode(snapshot.rootName || "已选择目录");
    els.status.textContent = `${state.files.length} 个 Markdown 文件`;
    renderNavigation();
    connectDirectoryEvents();
    startDirectoryRefreshLoop();

    if (state.files[0]) {
      await openFile(state.files[0]);
    } else {
      renderEmpty("没有找到 Markdown 文件", "这个目录下没有 .md 或 .markdown 文件。");
    }

    saveRememberedDirectory(snapshot);
    return true;
  } catch (error) {
    els.status.textContent = "读取失败";
    renderEmpty("目录读取失败", error.message || "无法读取这个目录。");
    return false;
  } finally {
    setLoadingState(els, false);
  }
}

async function restoreRememberedDirectoryOnStartup() {
  const remembered = readRememberedDirectory();
  if (!remembered || state.rootPath) return;

  els.chooseDir.disabled = true;
  els.chooseDir.textContent = "恢复中...";
  els.status.textContent = "恢复上次目录";
  els.currentPath.textContent = remembered.rootName || remembered.rootPath;
  renderEmpty("正在恢复上次目录", "正在重新读取上次选择的 Markdown 目录。");

  try {
    setLoadingState(els, true, "正在恢复上次目录");
    await waitForPaint();
    const snapshot = await readDirectorySnapshot(remembered.rootPath);
    const loaded = await loadDirectorySnapshot(snapshot);
    if (!loaded) {
      throw new Error("上次目录无法恢复，请重新选择。");
    }
  } catch (error) {
    clearRememberedDirectory();
    resetDirectoryState();
    els.status.textContent = "恢复失败";
    els.currentPath.textContent = "尚未选择目录";
    renderChooseDirectoryPrompt(error.message || "上次目录无法读取，请重新选择。");
  } finally {
    els.chooseDir.disabled = false;
    els.chooseDir.textContent = "选择本地目录";
    setLoadingState(els, false);
  }
}

function renderNavigation() {
  renderNavigationView({ state, els, onOpenFile: openFile });
}

function updateSearchQuery(value) {
  const nextQuery = value.trim().toLowerCase();
  const wasSearching = Boolean(state.query);
  const isSearching = Boolean(nextQuery);

  if (!wasSearching && isSearching) {
    state.searchExpandedDirsSnapshot = new Set(state.expandedDirs);
  }

  state.query = nextQuery;

  if (wasSearching && !isSearching && state.searchExpandedDirsSnapshot) {
    const restoredExpandedDirs = new Set(state.searchExpandedDirsSnapshot);
    state.expandedDirs = restoredExpandedDirs;
    state.searchExpandedDirsSnapshot = null;
    queueMicrotask(() => {
      if (!state.query) state.expandedDirs = new Set(restoredExpandedDirs);
    });
  }
}

function resetDirectoryState() {
  state.files = [];
  state.tree = null;
  state.activePath = "";
  state.rootPath = "";
  state.expandedDirs.clear();
  state.searchExpandedDirsSnapshot = null;
  renderNavigation();
}

async function openFile(file) {
  try {
    setActiveModule("markdown");
    clearHistorySelection();
    els.status.textContent = "读取中";
    const payload = await readMarkdownFile(state.rootPath, file.path);

    const markdown = payload.markdown || "";
    state.activePath = file.path;
    state.currentFile = file;
    state.currentMarkdown = markdown;
    state.aiErrorPath = "";
    state.aiErrorMessage = "";
    setViewMode("raw");
    await loadAnnotations(file.path);
    els.docName.textContent = file.name;
    els.docPath.textContent = `${file.path} · ${formatDate(file.lastModified)} · ${formatSize(file.size)}`;
    renderRawMarkdown();
    els.status.textContent = "HTML 预览";
    renderNavigation();
  } catch (error) {
    els.status.textContent = "读取失败";
    renderEmpty("文件读取失败", error.message || "无法读取这个 Markdown 文件。");
  }
}

function renderEmpty(title, text) {
  setActiveModule("markdown");
  els.docName.textContent = title;
  els.docPath.textContent = text;
  state.currentFile = null;
  state.currentMarkdown = "";
  state.annotations = [];
  state.annotationDraft = null;
  state.aiErrorPath = "";
  state.aiErrorMessage = "";
  setViewMode("raw");
  documentPanel.clearDocumentOutline();
  documentPanel.renderAnnotationList();
  closeAnnotationDrawer();
  hideSelectionRecord();
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.innerHTML = `
    <div class="empty-card">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(text)}</p>
    </div>
  `;
  els.contentShell.replaceChildren(empty);
}

function renderChooseDirectoryPrompt(text = "左侧会生成两个入口：最近更新按 Markdown 文件更新时间倒序排列，目录结构保留原始层级。") {
  renderEmpty("选择一个本地目录", text);
}

async function switchView(mode, options = {}) {
  if (state.activeModule !== "markdown") setActiveModule("markdown");

  if (mode === "history") {
    await renderAnnotationHistory();
    return;
  }

  clearHistorySelection();

  if (!state.currentFile) return;

  if (mode === "raw") {
    setViewMode("raw");
    renderRawMarkdown();
    els.status.textContent = "HTML 预览";
    return;
  }

  const key = getAiCacheKey(state.currentFile);
  const cached = !options.regenerate ? getAiCache(key) : null;
  if (cached) {
    setViewMode("ai");
    renderAiReading(cached);
    els.status.textContent = "AI 阅读版";
    return;
  }

  setViewMode("raw");
  els.status.textContent = "AI 后台生成中";
  renderRawMarkdown();
  await generateAiReadingInBackground(options);
}

function setViewMode(mode) {
  state.viewMode = mode;
  updateViewButtons();
}

function updateViewButtons() {
  els.rawView.classList.toggle("active", state.viewMode === "raw");
  els.aiView.classList.toggle("active", state.viewMode === "ai");
  els.historyView.classList.toggle("active", state.viewMode === "history");
  els.historyView.setAttribute("aria-pressed", state.viewMode === "history" ? "true" : "false");
  els.readingMode.closest(".mode-switch").style.display =
    state.viewMode === "history" ? "none" : "";
  const aiErrored = Boolean(state.aiErrorPath) && state.currentFile && state.aiErrorPath === state.currentFile.path;
  els.aiView.classList.toggle("error", aiErrored && state.viewMode !== "ai");
  els.regenerateAi.style.display = state.currentFile && state.viewMode === "ai" ? "" : "none";
  els.historyToolbarSlot.hidden = state.viewMode !== "history";
  if (state.viewMode !== "history") els.historyToolbarSlot.replaceChildren();
  const aiPending = Boolean(state.aiPendingKey) && state.currentFile && state.aiPendingPath === state.currentFile.path;
  els.rawView.disabled = !state.currentFile;
  els.aiView.disabled = !state.currentFile || aiPending;
  els.aiView.textContent = aiPending ? "AI 生成中..." : aiErrored ? "AI 失败" : "AI 阅读版";
  els.aiView.title = "";
  els.aiView.dataset.error = aiErrored
    ? `${state.aiErrorMessage || "AI 阅读版生成失败"}\A点击可重新生成`
    : "";
}

function renderRawMarkdown() {
  updateCurrentDocumentHeader();
  const article = document.createElement("article");
  article.className = "markdown-body";
  article.insertAdjacentHTML("beforeend", markdownToHtml(state.currentMarkdown));
  els.contentShell.replaceChildren(article);
  applyAnnotationHighlights(article, state.annotations, openAnnotationDrawer);
  documentPanel.buildDocumentOutline();
  documentPanel.renderAnnotationList();
  scrollContentShellTo(els, "top", "auto");
}

async function generateAiReadingInBackground(options = {}) {
  if (!state.currentFile) return;
  const key = getAiCacheKey(state.currentFile);
  if (state.aiPendingKey === key) {
    return;
  }

  try {
    state.aiPendingKey = key;
    state.aiPendingPath = state.currentFile.path;
    state.aiErrorPath = "";
    state.aiErrorMessage = "";
    updateViewButtons();
    const pendingFile = state.currentFile;
    const pendingMarkdown = state.currentMarkdown;

    const payload = await generateAiReading({
      path: pendingFile.path,
      lastModified: pendingFile.lastModified,
      markdown: pendingMarkdown,
      readingMode: state.readingMode,
    });

    setAiCache(key, payload.result);
    state.aiErrorPath = "";
    state.aiErrorMessage = "";
    if (state.currentFile && state.currentFile.path === pendingFile.path) {
      els.status.textContent = "AI 阅读版已就绪";
      showToast("AI 阅读版已生成完成。", "切换查看", () => {
        setViewMode("ai");
        renderAiReading(payload.result);
        els.status.textContent = "AI 阅读版";
      });
    }
  } catch (error) {
    els.status.textContent = "AI 失败";
    if (state.currentFile && state.currentFile.path === state.aiPendingPath) {
      state.aiErrorPath = state.currentFile.path;
      state.aiErrorMessage = error.message || "无法生成 AI 阅读版。";
      showToast(state.aiErrorMessage, "知道了", null, { tone: "error" });
    }
  } finally {
    state.aiPendingKey = "";
    state.aiPendingPath = "";
    updateViewButtons();
  }
}

function renderAiReading(result) {
  updateCurrentDocumentHeader();
  els.contentShell.replaceChildren(createAiReadingArticle(result, state.currentFile.name));
  documentPanel.buildDocumentOutline();
  documentPanel.renderAnnotationList();
  scrollContentShellTo(els, "top", "auto");
}

function renderTerminalModule() {
  setActiveModule("terminal");
  hideSelectionRecord();
  closeAnnotationDrawer();
  documentPanel.clearDocumentOutline();
  els.docName.textContent = "AI 终端";
  els.docPath.textContent = state.rootPath ? `${state.rootPath} · 交互会话` : "项目目录 · 交互会话";
  els.status.textContent = "AI 终端";
  terminalController.render(els.contentShell);
}

function renderFeedbackModule() {
  setActiveModule("feedback");
  hideSelectionRecord();
  closeAnnotationDrawer();
  documentPanel.clearDocumentOutline();
  els.docName.textContent = "测试反馈";
  els.docPath.textContent = "安装 Bookmarklet 到浏览器书签栏";
  els.status.textContent = "测试反馈";
  els.contentShell.replaceChildren();
  renderBookmarkletPage(els.contentShell, {
    readAgentStatus,
    readBookmarkletConfig,
    serviceOrigin: window.location.origin,
    showToast,
  });
  scrollContentShellTo(els, "top", "auto");
}

function updateCurrentDocumentHeader() {
  if (!state.currentFile) return;
  els.docName.textContent = state.currentFile.name;
  els.docPath.textContent = `${state.currentFile.path} · ${formatDate(state.currentFile.lastModified)} · ${formatSize(state.currentFile.size)}`;
}

async function loadAnnotations(path) {
  if (!state.rootPath || !path) {
    state.annotations = [];
    return;
  }

  state.annotations = await readAnnotations(state.rootPath, path);
}

function handleTextSelection() {
  if (!state.currentFile || state.viewMode !== "raw") {
    hideSelectionRecord();
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
    hideSelectionRecord();
    return;
  }

  const range = selection.getRangeAt(0);
  const article = els.contentShell.querySelector(".markdown-body");
  if (!article || !article.contains(range.commonAncestorContainer)) {
    hideSelectionRecord();
    return;
  }

  const quote = selection.toString().trim();
  if (!quote) {
    hideSelectionRecord();
    return;
  }

  const offsets = getSelectionOffsets(article, range);
  const fullText = article.textContent || "";
  state.annotationDraft = {
    quote,
    note: "",
    contextBefore: fullText.slice(Math.max(0, offsets.start - 80), offsets.start),
    contextAfter: fullText.slice(offsets.end, offsets.end + 80),
  };

  const rect = range.getBoundingClientRect();
  els.selectionRecord.style.left = `${Math.min(window.innerWidth - 84, Math.max(12, rect.left + rect.width / 2 - 28))}px`;
  els.selectionRecord.style.top = `${Math.max(12, rect.top - 44)}px`;
  els.selectionRecord.style.display = "block";
}

function getSelectionOffsets(root, range) {
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { start, end: start + range.toString().length };
}

function hideSelectionRecord() {
  els.selectionRecord.style.display = "none";
}

function openAnnotationDrawer(annotation) {
  if (!annotation) return;
  state.annotationDraft = { ...annotation };
  els.annotationQuote.textContent = annotation.quote || "";
  els.annotationText.value = annotation.note || "";
  els.annotationDelete.style.display = annotation.id ? "" : "none";
  els.annotationDrawer.classList.add("visible");
  updateAnnotationActionState();
  hideSelectionRecord();
  window.getSelection()?.removeAllRanges();
  els.annotationText.focus();
}

function closeAnnotationDrawer() {
  els.annotationDrawer.classList.remove("visible");
  state.annotationDraft = null;
  state.annotationDispatchPending = false;
  updateAnnotationActionState();
}

async function saveCurrentAnnotation({ forceDispatch = false } = {}) {
  if (!state.currentFile || !state.annotationDraft) return;
  if (state.annotationDispatchPending) return;
  const note = els.annotationText.value.trim();
  if (!note) {
    showToast("记录内容不能为空。", "知道了", null, { tone: "error" });
    return;
  }

  state.annotationDispatchPending = true;
  updateAnnotationActionState();
  let payload;
  let savedAnnotation;
  const target = {
    rootPath: state.rootPath,
    path: state.currentFile.path,
    fileName: state.currentFile.name,
    rootName: state.rootPath.split(/[\\/]/).filter(Boolean).at(-1) || state.rootPath,
  };
  try {
    payload = await saveAnnotationRecord(
      state.rootPath,
      state.currentFile.path,
      { ...state.annotationDraft, note },
    );
    savedAnnotation = payload.annotation || { ...state.annotationDraft, note };
  } catch (error) {
    state.annotationDispatchPending = false;
    updateAnnotationActionState();
    showToast(error.message || "保存记录失败。", "知道了", null, { tone: "error" });
    return;
  }

  state.annotations = payload.annotations || [];
  closeAnnotationDrawer();
  renderCurrentViewAfterAnnotationChange();

  const shouldDispatch = forceDispatch || state.annotationAutoSend;
  if (!shouldDispatch) {
    showToast("记录已保存。");
    return;
  }

  const result = dispatchAnnotationToAgent({ historyDocument: target, annotation: savedAnnotation });
  if (result.ok) {
    showToast(
      forceDispatch ? "记录已保存，并已发送给 Agent。" : "记录已保存，并已发送给 Agent。",
      "查看终端",
      () => switchModule("terminal"),
    );
  } else {
    showToast(`记录已保存，但${dispatchFailureMessage(result)}，未发送。`, "知道了", null, { tone: "error" });
  }
}

function updateAnnotationActionState() {
  const pending = state.annotationDispatchPending;
  if (els.annotationSave) els.annotationSave.disabled = pending;
  if (els.annotationSend) els.annotationSend.disabled = pending;
  if (els.annotationDelete) els.annotationDelete.disabled = pending;
  if (els.annotationClose) els.annotationClose.disabled = pending;
}

async function deleteCurrentAnnotation() {
  if (!state.currentFile || !state.annotationDraft?.id) return;
  let payload;
  try {
    payload = await deleteAnnotationRecord(
      state.rootPath,
      state.currentFile.path,
      state.annotationDraft.id,
    );
  } catch (error) {
    showToast(error.message || "删除记录失败。", "知道了", null, { tone: "error" });
    return;
  }

  state.annotations = payload.annotations || [];
  closeAnnotationDrawer();
  renderCurrentViewAfterAnnotationChange();
  showToast("记录已删除。");
}

function renderCurrentViewAfterAnnotationChange() {
  if (state.viewMode === "ai" && state.currentFile) {
    const cached = getAiCache(getAiCacheKey(state.currentFile));
    if (cached) {
      renderAiReading(cached);
      return;
    }
  }

  setViewMode("raw");
  renderRawMarkdown();
}

async function renderAnnotationHistory() {
  setActiveModule("markdown");
  setViewMode("history");
  hideSelectionRecord();
  closeAnnotationDrawer();
  els.status.textContent = "读取历史注释";
  els.docName.textContent = "历史注释";
  els.docPath.textContent = "正在读取全局记录";
  documentPanel.clearDocumentOutline();

  try {
    const payload = await readAnnotationHistory();

    state.annotationHistory = payload.documents || [];
    pruneHistoryFileFilter();
    pruneHistorySelection();
    state.annotationStorePath = payload.storePath || "~/.markdown-viewer/annotations.json";
    renderAnnotationHistoryPage(payload.count || 0);
    els.docPath.textContent = `${state.annotationStorePath} · ${payload.count || 0} 条记录`;
    els.status.textContent = "历史注释";
    scrollContentShellTo(els, "top", "auto");
  } catch (error) {
    els.historyToolbarSlot.replaceChildren();
    els.contentShell.replaceChildren(renderAnnotationHistoryError(error.message));
    els.docPath.textContent = error.message || "无法读取历史注释。";
    els.status.textContent = "读取失败";
  }
}

function renderAnnotationHistoryPage(count) {
  const visibleDocuments = filteredHistoryDocuments();
  const visibleCount = flattenedHistoryAnnotations(visibleDocuments).length;
  const page = createAnnotationHistoryPage({
    count: visibleCount || count,
    documents: visibleDocuments,
    mode: state.annotationHistoryMode,
    fileFilter: state.annotationHistoryFileFilter,
    filterDocuments: state.annotationHistory,
    selectedIds: state.selectedHistoryAnnotationIds,
    dispatchPending: state.historyDispatchPending,
    storePath: state.annotationStorePath,
    onCopy: copyHistoryNotes,
    onFileFilterChange: (fileFilter) => {
      state.annotationHistoryFileFilter = fileFilter;
      clearHistorySelection();
      renderAnnotationHistoryPage(count);
    },
    onModeChange: (mode) => {
      if (mode === "flat") clearHistorySelection();
      state.annotationHistoryMode = mode;
      renderAnnotationHistoryPage(count);
    },
    onOpen: openHistoryAnnotation,
    onSend: sendHistoryAnnotation,
    onDelete: deleteHistoryAnnotation,
    onSendSelected: sendSelectedHistoryAnnotations,
    onDeleteSelected: deleteSelectedHistoryAnnotations,
    onToggleSelection: toggleHistoryAnnotationSelection,
  });
  const historyHeader = page.querySelector(".history-header");
  if (historyHeader) {
    els.historyToolbarSlot.replaceChildren(historyHeader);
  } else {
    els.historyToolbarSlot.replaceChildren();
  }
  els.contentShell.replaceChildren(page);
}

function filteredHistoryDocuments() {
  if (state.annotationHistoryFileFilter === "all") return state.annotationHistory;
  return state.annotationHistory.filter((historyDocument) =>
    historyDocumentFilterKey(historyDocument) === state.annotationHistoryFileFilter,
  );
}

function pruneHistoryFileFilter() {
  if (state.annotationHistoryFileFilter === "all") return;
  const valid = state.annotationHistory.some((historyDocument) =>
    historyDocumentFilterKey(historyDocument) === state.annotationHistoryFileFilter,
  );
  if (!valid) state.annotationHistoryFileFilter = "all";
}

async function openHistoryAnnotation(historyDocument, annotation) {
  if (state.rootPath !== historyDocument.rootPath) {
    showToast("请先选择这条记录所在的目录。", "知道了", null, { tone: "error" });
    return;
  }

  const file = state.files.find((item) => item.path === historyDocument.path);
  if (!file) {
    showToast("当前目录里没有找到这篇文档。", "知道了", null, { tone: "error" });
    return;
  }

  await openFile(file);
  setTimeout(() => {
    documentPanel.scrollAnnotationIntoView(annotation.id);
    openAnnotationDrawer(state.annotations.find((item) => item.id === annotation.id) || annotation);
  }, 80);
}

async function copyHistoryNotes() {
  const text = historyNotesText(filteredHistoryDocuments());
  if (!text) {
    showToast("没有可复制的注释。", "知道了");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast("已复制全部注释。");
  } catch {
    state.annotationHistoryMode = "flat";
    renderAnnotationHistoryPage(flattenedHistoryAnnotations(filteredHistoryDocuments()).length);
    const textarea = els.contentShell.querySelector(".history-flat-textarea");
    if (textarea) {
      textarea.focus();
      textarea.select();
    }
    showToast("已选中注释内容，可直接复制。");
  }
}

function toggleHistoryAnnotationSelection(historyDocument, annotation, selected) {
  const key = historyAnnotationKey(historyDocument, annotation);
  if (selected) {
    state.selectedHistoryAnnotationIds.add(key);
  } else {
    state.selectedHistoryAnnotationIds.delete(key);
  }
  renderAnnotationHistoryPage(flattenedHistoryAnnotations(state.annotationHistory).length);
}

function clearHistorySelection() {
  state.selectedHistoryAnnotationIds.clear();
}

function pruneHistorySelection() {
  const valid = new Set(
    flattenedHistoryAnnotations(state.annotationHistory)
      .map(({ historyDocument, annotation }) => historyAnnotationKey(historyDocument, annotation)),
  );
  for (const key of state.selectedHistoryAnnotationIds) {
    if (!valid.has(key)) state.selectedHistoryAnnotationIds.delete(key);
  }
}

async function sendHistoryAnnotation(historyDocument, annotation) {
  if (state.historyDispatchPending) return;
  state.historyDispatchPending = true;
  renderAnnotationHistoryPage(flattenedHistoryAnnotations(state.annotationHistory).length);
  try {
    const result = dispatchAnnotationToAgent({ historyDocument, annotation });
    if (result.ok) {
      showToast("已发送给 Agent。", "查看终端", () => switchModule("terminal"));
    } else {
      showToast(dispatchFailureMessage(result), "知道了", null, { tone: "error" });
    }
  } finally {
    state.historyDispatchPending = false;
    renderAnnotationHistoryPage(flattenedHistoryAnnotations(state.annotationHistory).length);
  }
}

async function deleteHistoryAnnotation(historyDocument, annotation) {
  if (state.historyDispatchPending || !annotation?.id) return;

  try {
    await deleteAnnotationRecord(historyDocument.rootPath, historyDocument.path, annotation.id);
    state.selectedHistoryAnnotationIds.delete(historyAnnotationKey(historyDocument, annotation));
    const payload = await readAnnotationHistory();
    state.annotationHistory = payload.documents || [];
    state.annotationStorePath = payload.storePath || state.annotationStorePath;
    pruneHistoryFileFilter();
    pruneHistorySelection();
    renderAnnotationHistoryPage(payload.count || 0);
    els.docPath.textContent = `${state.annotationStorePath} · ${payload.count || 0} 条记录`;
    showToast("历史注释已删除。");
  } catch (error) {
    showToast(error.message || "删除历史注释失败。", "知道了", null, { tone: "error" });
  }
}

async function sendSelectedHistoryAnnotations() {
  if (state.historyDispatchPending) return;
  const selected = selectedHistoryAnnotations();
  if (!selected.length) {
    showToast("请先选择至少一条历史注释。", "知道了", null, { tone: "error" });
    return;
  }
  if (selected.length > HISTORY_BATCH_LIMIT) {
    showToast(`一次最多发送 ${HISTORY_BATCH_LIMIT} 条注释，请减少选择后重试。`, "知道了", null, { tone: "error" });
    return;
  }

  state.historyDispatchPending = true;
  renderAnnotationHistoryPage(flattenedHistoryAnnotations(state.annotationHistory).length);
  try {
    const result = dispatchHistoryBatchToAgent(selected);
    if (result.ok) {
      selected.forEach(({ historyDocument, annotation }) => {
        state.selectedHistoryAnnotationIds.delete(historyAnnotationKey(historyDocument, annotation));
      });
      showToast(`已将选中的 ${selected.length} 条注释发送给 Agent。`, "查看终端", () => switchModule("terminal"));
    } else {
      showToast(dispatchFailureMessage(result), "知道了", null, { tone: "error" });
    }
  } finally {
    state.historyDispatchPending = false;
    renderAnnotationHistoryPage(flattenedHistoryAnnotations(state.annotationHistory).length);
  }
}

async function deleteSelectedHistoryAnnotations() {
  if (state.historyDispatchPending) return;
  const selected = selectedHistoryAnnotations();
  if (!selected.length) {
    showToast("请先选择至少一条历史注释。", "知道了", null, { tone: "error" });
    return;
  }

  state.historyDispatchPending = true;
  renderAnnotationHistoryPage(flattenedHistoryAnnotations(state.annotationHistory).length);
  let deletedCount = 0;
  try {
    for (const { historyDocument, annotation } of selected) {
      await deleteAnnotationRecord(historyDocument.rootPath, historyDocument.path, annotation.id);
      state.selectedHistoryAnnotationIds.delete(historyAnnotationKey(historyDocument, annotation));
      deletedCount += 1;
    }
    const payload = await readAnnotationHistory();
    state.annotationHistory = payload.documents || [];
    state.annotationStorePath = payload.storePath || state.annotationStorePath;
    pruneHistoryFileFilter();
    pruneHistorySelection();
    els.docPath.textContent = `${state.annotationStorePath} · ${payload.count || 0} 条记录`;
    showToast(`已删除 ${deletedCount} 条历史注释。`);
    renderAnnotationHistoryPage(payload.count || 0);
  } catch (error) {
    showToast(error.message || `已删除 ${deletedCount} 条，部分历史注释删除失败。`, "知道了", null, { tone: "error" });
  } finally {
    state.historyDispatchPending = false;
    renderAnnotationHistoryPage(flattenedHistoryAnnotations(state.annotationHistory).length);
  }
}

function selectedHistoryAnnotations() {
  return flattenedHistoryAnnotations(state.annotationHistory)
    .filter(({ historyDocument, annotation }) =>
      state.selectedHistoryAnnotationIds.has(historyAnnotationKey(historyDocument, annotation)),
    );
}

function dispatchAnnotationToAgent({ annotation }) {
  const prompt = buildSingleAnnotationPrompt(annotation);
  return terminalController.dispatchPrompt(prompt);
}

function dispatchHistoryBatchToAgent(items) {
  const prompt = buildBatchAnnotationPrompt(items);
  return terminalController.dispatchPrompt(prompt);
}

function buildSingleAnnotationPrompt(annotation) {
  return String(annotation?.note || "").trim();
}

function buildBatchAnnotationPrompt(items) {
  return items
    .map(({ annotation }) => String(annotation?.note || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function dispatchFailureMessage(result = {}) {
  if (result.reason === "no-session") return "当前没有可用的 Agent";
  if (result.reason === "starting") return "Agent 正在启动，请稍后再试";
  if (result.reason === "unsupported-agent") return "当前终端会话不可用于评论派发";
  if (result.reason === "socket-not-open") return "Agent 连接不可用";
  return result.message || "发送给 Agent 失败";
}

function getAiCacheKey(file) {
  return `ai-reading:${AI_CACHE_VERSION}:${state.readingMode}:${file.path}:${file.lastModified}:${file.size}`;
}

function getAiCache(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function setAiCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 缓存失败不影响阅读。
  }
}

function restoreAnnotationAutoSendPreference() {
  state.annotationAutoSend = readAnnotationAutoSendPreference();
  if (els.annotationAutoSend) {
    els.annotationAutoSend.checked = state.annotationAutoSend;
  }
}

function readAnnotationAutoSendPreference() {
  try {
    return localStorage.getItem(ANNOTATION_AUTO_SEND_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function saveAnnotationAutoSendPreference(enabled) {
  try {
    localStorage.setItem(ANNOTATION_AUTO_SEND_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // 偏好保存失败不影响本次使用。
  }
}

function readRememberedDirectory() {
  try {
    const payload = JSON.parse(localStorage.getItem(LAST_DIRECTORY_STORAGE_KEY));
    const rootPath = typeof payload?.rootPath === "string" ? payload.rootPath.trim() : "";
    if (!rootPath) return null;

    return {
      rootPath,
      rootName: typeof payload.rootName === "string" ? payload.rootName : "",
    };
  } catch {
    return null;
  }
}

function saveRememberedDirectory(snapshot) {
  const rootPath = typeof snapshot?.rootPath === "string" ? snapshot.rootPath.trim() : "";
  if (!rootPath) return;

  try {
    localStorage.setItem(LAST_DIRECTORY_STORAGE_KEY, JSON.stringify({
      rootPath,
      rootName: snapshot.rootName || "",
    }));
  } catch {
    // 目录记忆失败不影响当前浏览。
  }
}

function clearRememberedDirectory() {
  try {
    localStorage.removeItem(LAST_DIRECTORY_STORAGE_KEY);
  } catch {
    // 清理失败不影响手动重新选择目录。
  }
}

function startDirectoryRefreshLoop() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
  }
  state.refreshTimer = setInterval(() => {
    if (!document.hidden) refreshDirectoryIfNeeded();
  }, 30000);
}

function stopDirectoryRefreshLoop() {
  if (!state.refreshTimer) return;
  clearInterval(state.refreshTimer);
  state.refreshTimer = null;
}

function connectDirectoryEvents() {
  if (state.eventSource) return;

  const source = new EventSource("/api/events");
  state.eventSource = source;

  source.addEventListener("directory-changed", (event) => {
    const payload = JSON.parse(event.data || "{}");
    if (!state.rootPath || payload.rootPath !== state.rootPath) return;
    if (state.activeModule !== "markdown") return;

    els.status.textContent = "检测到目录更新";
    if (state.eventRefreshTimer) clearTimeout(state.eventRefreshTimer);
    state.eventRefreshTimer = setTimeout(() => {
      state.eventRefreshTimer = null;
      refreshDirectoryIfNeeded();
    }, 300);
  });

  source.addEventListener("directory-watch-error", (event) => {
    const payload = JSON.parse(event.data || "{}");
    if (!state.rootPath || payload.rootPath !== state.rootPath) return;
    if (state.activeModule !== "markdown") return;
    showToast(payload.message || "目录监听失败，将继续使用定时同步。", "知道了", null, { tone: "error" });
  });
}

async function refreshDirectoryIfNeeded() {
  if (state.activeModule !== "markdown") return;
  if (!state.rootPath || state.refreshInFlight) return;
  state.refreshInFlight = true;

  try {
    const snapshot = await readDirectorySnapshot(state.rootPath);

    const nextSignature = snapshot.files.map((file) => `${file.path}:${file.lastModified}:${file.size}`).join("|");
    const currentSignature = state.files.map((file) => `${file.path}:${file.lastModified}:${file.size}`).join("|");

    if (nextSignature === currentSignature) return;

    state.files = snapshot.files;
    state.tree = snapshot.tree || createTreeNode(snapshot.rootName || "已选择目录");
    renderNavigation();
    els.status.textContent = `${state.files.length} 个 Markdown 文件，已同步更新`;

    if (!state.currentFile) return;

    const matched = state.files.find((file) => file.path === state.currentFile.path);
    if (!matched) {
      renderEmpty("当前文档已移除", "目录刷新后，当前打开的 Markdown 文件不存在了。");
      showToast("目录已更新，当前文档已不存在。", "知道了");
      return;
    }

    if (
      matched.lastModified !== state.currentFile.lastModified ||
      matched.size !== state.currentFile.size
    ) {
      if (state.viewMode === "history") {
        state.currentFile = matched;
        return;
      }

      const wasAi = state.viewMode === "ai";
      await openFile(matched);
      showToast(
        "当前文档已检测到更新，页面内容已同步刷新。",
        wasAi ? "生成新版 AI 阅读版" : "知道了",
        wasAi ? () => switchView("ai", { regenerate: true }) : null,
      );
    }
  } catch {
    els.status.textContent = "自动同步失败";
  } finally {
    state.refreshInFlight = false;
  }
}
