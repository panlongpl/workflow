export function createBookmarkletHref(serviceOrigin, token = "") {
  const origin = String(serviceOrigin || "").replace(/\/+$/, "");
  const accessToken = String(token || "");
  const payload = `(() => {
  const existing = window.__workflowFeedbackTool;
  if (existing && typeof existing.toggle === "function") {
    existing.toggle();
    return;
  }

  const serviceOrigin = ${JSON.stringify(origin)};
  const bookmarkletToken = ${JSON.stringify(accessToken)};
  const fallbackMessage = "当前页面安全策略可能阻止了反馈工具运行，请手动复制页面信息给 Agent。";
  const errors = [];
  const rejections = [];
  const apiRequests = [];
  const originalConsoleError = console.error;
  const originalFetch = window.fetch;
  const originalXhrOpen = window.XMLHttpRequest?.prototype?.open;
  const originalXhrSend = window.XMLHttpRequest?.prototype?.send;
  let host;
  let metaText;
  let statusText;
  let apiTitle;
  let apiList;
  let descriptionInput;
  let isClosed = false;
  let cleanupPageChangeWatchers = null;
  let currentPageHref = location.href;
  let pageVersion = 0;

  try {
    host = document.createElement("div");
    host.id = "workflow-feedback-tool-root";
    host.style.position = "fixed";
    host.style.right = "24px";
    host.style.bottom = "24px";
    host.style.zIndex = "2147483647";
    host.style.width = "min(380px, calc(100vw - 32px))";
    host.style.maxWidth = "calc(100vw - 32px)";
    if (!host.attachShadow) throw new Error("Shadow DOM unavailable");
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = ` + JSON.stringify(`
      :host { all: initial; color-scheme: light; }
      *, *::before, *::after { box-sizing: border-box; }
      .workflow-feedback-panel {
        width: 100%;
        border: 1px solid rgba(42, 111, 151, 0.24);
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.98);
        color: #14212b;
        box-shadow: 0 18px 48px rgba(15, 35, 50, 0.24);
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow: hidden;
      }
      .workflow-feedback-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px;
        background: linear-gradient(135deg, #2a6f97, #3a8bb5);
        color: #fff;
        font-weight: 800;
      }
      .workflow-feedback-close {
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.18);
        color: #fff;
        cursor: pointer;
        font: inherit;
        padding: 4px 9px;
      }
      .workflow-feedback-body { padding: 16px; display: grid; gap: 12px; }
      .workflow-feedback-meta,
      .workflow-feedback-status {
        border-radius: 12px;
        padding: 10px 12px;
        background: #eef6fa;
        color: #334e5d;
        font-size: 12px;
        word-break: break-word;
        white-space: pre-wrap;
      }
      .workflow-feedback-status { background: #fff7dc; color: #705000; min-height: 38px; }
      .workflow-feedback-api {
        border: 1px solid #d8e5ec;
        border-radius: 12px;
        background: #fbfdfe;
        padding: 10px 12px;
        color: #334e5d;
        font-size: 12px;
      }
      .workflow-feedback-api-title { font-weight: 800; color: #17465f; margin-bottom: 6px; }
      .workflow-feedback-api-empty { color: #6d8290; }
      .workflow-feedback-api-list { display: grid; gap: 6px; max-height: 132px; overflow: auto; }
      .workflow-feedback-api-item { display: flex; align-items: flex-start; gap: 7px; line-height: 1.35; }
      .workflow-feedback-api-item input { margin-top: 2px; accent-color: #2a6f97; }
      .workflow-feedback-api-item span { word-break: break-all; }
      .workflow-feedback-textarea {
        width: 100%;
        min-height: 112px;
        resize: vertical;
        border: 1px solid #c8d8e1;
        border-radius: 12px;
        padding: 10px 12px;
        color: #14212b;
        background: #fff;
        font: inherit;
      }
      .workflow-feedback-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      .workflow-feedback-button {
        border: 0;
        border-radius: 999px;
        background: #e7f1f7;
        color: #17465f;
        cursor: pointer;
        font: 700 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: 9px 12px;
      }
      .workflow-feedback-button.primary { background: #2a6f97; color: #fff; }
      .workflow-feedback-button:disabled { cursor: not-allowed; opacity: 0.62; }
    `) + `;

    const panel = document.createElement("section");
    panel.className = "workflow-feedback-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Workflow 测试反馈");

    const header = document.createElement("div");
    header.className = "workflow-feedback-header";
    const title = document.createElement("span");
    title.textContent = "Workflow 测试反馈";
    const closeButton = document.createElement("button");
    closeButton.className = "workflow-feedback-close";
    closeButton.type = "button";
    closeButton.textContent = "关闭";
    closeButton.addEventListener("click", () => window.__workflowFeedbackTool.close());
    header.append(title, closeButton);

    const body = document.createElement("div");
    body.className = "workflow-feedback-body";

    metaText = document.createElement("div");
    metaText.className = "workflow-feedback-meta";
    updatePageSnapshot();

    descriptionInput = document.createElement("textarea");
    descriptionInput.className = "workflow-feedback-textarea";
    descriptionInput.placeholder = "请描述你看到的问题、期望结果、复现步骤，Agent 会自动附带当前页面信息。需要接口信息时，请在下方手动勾选。";
    descriptionInput.value = loadFeedbackState().description || "";
    descriptionInput.addEventListener("input", saveFeedbackState);

    const apiBox = document.createElement("div");
    apiBox.className = "workflow-feedback-api";
    apiTitle = document.createElement("div");
    apiTitle.className = "workflow-feedback-api-title";
    updateApiTitle();
    apiList = document.createElement("div");
    apiList.className = "workflow-feedback-api-list";
    renderApiList();
    apiBox.append(apiTitle, apiList);

    statusText = document.createElement("div");
    statusText.className = "workflow-feedback-status";
    statusText.setAttribute("role", "status");
    setStatus("准备就绪。请填写问题描述后发送给 Agent。");

    const actions = document.createElement("div");
    actions.className = "workflow-feedback-actions";
    const checkButton = createButton("检查 Agent", false);
    const sendButton = createButton("发送给 Agent", true);
    const openButton = createButton("打开 Workflow Cockpit", false);
    checkButton.addEventListener("click", () => checkAgent(checkButton));
    sendButton.addEventListener("click", () => sendFeedback(sendButton));
    openButton.addEventListener("click", () => window.open(serviceOrigin || "/", "_blank", "noopener"));
    actions.append(checkButton, sendButton, openButton);

    body.append(metaText, descriptionInput, apiBox, statusText, actions);
    panel.append(header, body);
    shadow.append(style, panel);
    document.documentElement.appendChild(host);
    saveFeedbackState();
  } catch (error) {
    cleanupPartialHost();
    alert(fallbackMessage);
    return;
  }

  function createButton(label, primary) {
    const button = document.createElement("button");
    button.className = primary ? "workflow-feedback-button primary" : "workflow-feedback-button";
    button.type = "button";
    button.textContent = label;
    return button;
  }

  function getPageMetaText() {
    return [
      "Title: " + (document.title || "未命名页面"),
      "Host: " + (location.host || "未知"),
      "URL: " + (location.href || "未知"),
    ].join("\\n");
  }

  function getApiTitleText() {
    return "后端接口（已捕获 " + apiRequests.length + " 个，默认不发送）";
  }

  function updateApiTitle() {
    if (apiTitle) apiTitle.textContent = getApiTitleText();
  }

  function updatePageSnapshot() {
    if (metaText) metaText.textContent = getPageMetaText();
  }

  function setStatus(message) {
    if (statusText) statusText.textContent = message;
  }

  function pushLatest(list, entry) {
    list.push(entry);
    while (list.length > 20) list.shift();
  }

  function pushApiRequest(entry) {
    if (!shouldCaptureApiRequest(entry?.url)) return;
    apiRequests.push({ id: String(Date.now()) + "-" + Math.random().toString(16).slice(2), selected: false, ...entry });
    while (apiRequests.length > 20) apiRequests.shift();
    updateApiTitle();
    renderApiList();
  }

  function clearApiRequests() {
    apiRequests.length = 0;
    updateApiTitle();
    renderApiList();
  }

  function shouldCaptureApiRequest(url) {
    const text = String(url || "");
    if (!text || text === "未知接口") return false;
    try {
      const requestUrl = new URL(text, location.href);
      const workflowApiPaths = new Set(["/api/agent-status", "/api/bookmarklet-feedback", "/api/bookmarklet-config"]);
      if (workflowApiPaths.has(requestUrl.pathname) && !serviceOrigin) return false;
      if (serviceOrigin) {
        const workflowUrl = new URL(serviceOrigin);
        if (requestUrl.origin === workflowUrl.origin && workflowApiPaths.has(requestUrl.pathname)) return false;
      }
      return requestUrl.hostname === location.hostname;
    } catch {
      if (!serviceOrigin) return false;
      return !text.startsWith(serviceOrigin + "/api/agent-status") && !text.startsWith(serviceOrigin + "/api/bookmarklet-feedback");
    }
  }

  function getFeedbackStorageKey() {
    return "workflow-feedback-state:" + serviceOrigin + ":" + location.href;
  }

  function loadFeedbackState() {
    try {
      return JSON.parse(localStorage.getItem(getFeedbackStorageKey()) || "{}");
    } catch {
      return {};
    }
  }

  function saveFeedbackState() {
    try {
      localStorage.setItem(getFeedbackStorageKey(), JSON.stringify({
        description: descriptionInput ? descriptionInput.value || "" : "",
        visible: host ? !host.hidden : true,
      }));
    } catch {
      // 忽略隐私模式或站点禁用 localStorage 的情况。
    }
  }

  function renderApiList() {
    if (!apiList) return;
    apiList.replaceChildren();
    if (!apiRequests.length) {
      const empty = document.createElement("div");
      empty.className = "workflow-feedback-api-empty";
      empty.textContent = "尚未捕获接口。打开面板后操作页面，可选择要发送的接口。";
      apiList.appendChild(empty);
      return;
    }

    apiRequests.slice().reverse().forEach((request) => {
      const label = document.createElement("label");
      label.className = "workflow-feedback-api-item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(request.selected);
      checkbox.addEventListener("change", () => {
        request.selected = checkbox.checked;
      });
      const text = document.createElement("span");
      text.textContent = formatApiRequestLabel(request);
      label.append(checkbox, text);
      apiList.appendChild(label);
    });
  }

  function formatApiRequestLabel(request) {
    const status = request.status ? " · " + request.status : "";
    const duration = typeof request.durationMs === "number" ? " · " + Math.round(request.durationMs) + "ms" : "";
    return request.method + " " + request.url + status + duration;
  }

  function stringifyValue(value) {
    if (value instanceof Error) return value.message || value.name || "Error";
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function stackFrom(value) {
    return value && typeof value.stack === "string" ? value.stack : "";
  }

  function onError(event) {
    pushLatest(errors, {
      message: event.message || stringifyValue(event.error) || "页面脚本错误",
      source: event.filename || location.href,
      lineno: event.lineno || 0,
      colno: event.colno || 0,
      stack: stackFrom(event.error),
      timestamp: new Date().toISOString(),
    });
  }

  function onUnhandledRejection(event) {
    const reason = event.reason;
    pushLatest(rejections, {
      message: stringifyValue(reason) || "Unhandled promise rejection",
      reason: stringifyValue(reason),
      stack: stackFrom(reason),
      source: location.href,
      timestamp: new Date().toISOString(),
    });
  }

  console.error = function workflowFeedbackConsoleErrorHook(...args) {
    pushLatest(errors, {
      message: args.map(stringifyValue).join(" "),
      source: "console.error",
      lineno: 0,
      colno: 0,
      stack: args.map(stackFrom).filter(Boolean).join("\\n"),
      timestamp: new Date().toISOString(),
    });
    return originalConsoleError.apply(this, args);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  installNetworkCapture();

  window.__workflowFeedbackTool = {
    host,
    errors,
    rejections,
    toggle() {
      if (host) host.hidden = !host.hidden;
      saveFeedbackState();
    },
    close() {
      if (isClosed) return;
      isClosed = true;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      cleanupPageChangeWatchers?.();
      restoreNetworkCapture();
      console.error = originalConsoleError;
      saveFeedbackState();
      if (host) host.remove();
      delete window.__workflowFeedbackTool;
    },
  };

  async function fetchJsonWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const requestFetch = typeof originalFetch === "function" ? originalFetch : fetch;
      const response = await requestFetch.call(window, url, { ...options, signal: controller.signal });
      let data = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }
      return { response, data };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function checkAgent(button) {
    if (!serviceOrigin) {
      setStatus("不可用：未配置 Workflow Cockpit 服务地址。");
      return;
    }
    button.disabled = true;
    setStatus("正在检查 Agent...");
    try {
      const { response, data } = await fetchJsonWithTimeout(serviceOrigin + "/api/agent-status", {
        method: "GET",
        headers: createRequestHeaders(),
      });
      if (response.ok && data && data.ok) {
        setStatus("Agent 可用");
      } else {
        setStatus("Agent 不可用" + (data && data.message ? "：" + data.message : ""));
      }
    } catch {
      setStatus("Agent 连接失败");
    } finally {
      button.disabled = false;
    }
  }

  function buildFeedbackPayload(description) {
    return {
      source: "bookmarklet-feedback",
      version: 1,
      token: bookmarkletToken,
      page: {
        url: location.href,
        title: document.title || "",
        host: location.host || "",
        referrer: document.referrer || "",
        viewport: {
          width: window.innerWidth || 0,
          height: window.innerHeight || 0,
          devicePixelRatio: window.devicePixelRatio || 1,
        },
        userAgent: navigator.userAgent || "",
        timestamp: new Date().toISOString(),
      },
      feedback: {
        description,
      },
      console: {
        errors: errors.slice(-20),
        rejections: rejections.slice(-20),
      },
      api: {
        selectedRequests: apiRequests.filter((request) => request.selected).slice(-10).map((request) => ({
          method: request.method,
          url: request.url,
          status: request.status,
          ok: request.ok,
          durationMs: request.durationMs,
          type: request.type,
        })),
      },
    };
  }

  async function sendFeedback(button) {
    const description = (descriptionInput.value || "").trim();
    if (!description) {
      setStatus("请先填写问题描述");
      descriptionInput.focus();
      return;
    }
    if (!serviceOrigin) {
      setStatus("无法连接 Workflow Cockpit。请先运行本项目服务，然后重试。");
      return;
    }

    button.disabled = true;
    setStatus("正在发送给 Agent...");
    try {
      const { response, data } = await fetchJsonWithTimeout(serviceOrigin + "/api/bookmarklet-feedback", {
        method: "POST",
        headers: createRequestHeaders({ "content-type": "application/json" }),
        body: JSON.stringify(buildFeedbackPayload(description)),
      });
      if (response.status === 403 || (data && data.reason === "invalid-bookmarklet-token")) {
        setStatus(data && data.message ? data.message : "反馈工具授权无效，请回到 Workflow Cockpit 重新安装书签。");
        return;
      }
      if (response.status === 409 || (data && data.reason === "no-agent")) {
        setStatus(data && data.message ? data.message : "当前没有可用 Agent，请先启动 Agent");
        return;
      }
      if (!response.ok || (data && data.ok === false)) {
        setStatus(data && data.message ? data.message : "发送失败，请稍后重试。");
        return;
      }
      setStatus("已发送给 Agent");
    } catch {
      setStatus("无法连接 Workflow Cockpit。请先运行本项目服务，然后重试。");
    } finally {
      button.disabled = false;
    }
  }

  function cleanupPartialHost() {
    if (host && host.remove) host.remove();
  }

  function installNetworkCapture() {
    if (typeof originalFetch === "function") {
      window.fetch = async function workflowFeedbackFetch(input, init = {}) {
        const startedAt = performance.now();
        const request = normalizeFetchRequest(input, init);
        const requestPageVersion = pageVersion;
        try {
          const response = await originalFetch.apply(this, arguments);
          if (requestPageVersion === pageVersion) {
            pushApiRequest({
              ...request,
              status: response.status,
              ok: response.ok,
              durationMs: performance.now() - startedAt,
              type: "fetch",
              timestamp: new Date().toISOString(),
            });
          }
          return response;
        } catch (error) {
          if (requestPageVersion === pageVersion) {
            pushApiRequest({
              ...request,
              status: 0,
              ok: false,
              durationMs: performance.now() - startedAt,
              type: "fetch",
              timestamp: new Date().toISOString(),
            });
          }
          throw error;
        }
      };
    }

    if (originalXhrOpen && originalXhrSend && window.XMLHttpRequest?.prototype) {
      window.XMLHttpRequest.prototype.open = function workflowFeedbackXhrOpen(method, url) {
        this.__workflowFeedbackRequest = { method: String(method || "GET").toUpperCase(), url: absoluteUrl(url) };
        return originalXhrOpen.apply(this, arguments);
      };

      window.XMLHttpRequest.prototype.send = function workflowFeedbackXhrSend() {
        const startedAt = performance.now();
        const request = this.__workflowFeedbackRequest || { method: "GET", url: "未知接口" };
        const requestPageVersion = pageVersion;
        const record = () => {
          if (requestPageVersion !== pageVersion) return;
          pushApiRequest({
            ...request,
            status: this.status || 0,
            ok: this.status >= 200 && this.status < 400,
            durationMs: performance.now() - startedAt,
            type: "xhr",
            timestamp: new Date().toISOString(),
          });
        };
        this.addEventListener("loadend", record, { once: true });
        return originalXhrSend.apply(this, arguments);
      };
    }
  }

  function restoreNetworkCapture() {
    if (typeof originalFetch === "function" && window.fetch?.name === "workflowFeedbackFetch") {
      window.fetch = originalFetch;
    }
    if (window.XMLHttpRequest?.prototype) {
      if (originalXhrOpen && window.XMLHttpRequest.prototype.open?.name === "workflowFeedbackXhrOpen") {
        window.XMLHttpRequest.prototype.open = originalXhrOpen;
      }
      if (originalXhrSend && window.XMLHttpRequest.prototype.send?.name === "workflowFeedbackXhrSend") {
        window.XMLHttpRequest.prototype.send = originalXhrSend;
      }
    }
  }

  function normalizeFetchRequest(input, init = {}) {
    const method = String(init?.method || input?.method || "GET").toUpperCase();
    const url = typeof input === "string" ? input : input?.url;
    return { method, url: absoluteUrl(url) };
  }

  function absoluteUrl(url) {
    try {
      return new URL(String(url || ""), location.href).href;
    } catch {
      return String(url || "未知接口");
    }
  }

  function installPageChangeWatchers() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    let updateTimer = 0;
    let titleObserver = null;

    function scheduleUpdate() {
      if (location.href !== currentPageHref) {
        currentPageHref = location.href;
        pageVersion += 1;
        clearApiRequests();
        saveFeedbackState();
      }
      clearTimeout(updateTimer);
      updateTimer = setTimeout(() => updatePageSnapshot(), 80);
    }

    const patchedPushState = function workflowFeedbackPushState(...args) {
      const result = originalPushState.apply(this, args);
      scheduleUpdate();
      return result;
    };
    history.pushState = patchedPushState;

    const patchedReplaceState = function workflowFeedbackReplaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      scheduleUpdate();
      return result;
    };
    history.replaceState = patchedReplaceState;

    window.addEventListener("popstate", scheduleUpdate);
    window.addEventListener("hashchange", scheduleUpdate);

    const titleElement = document.querySelector("title");
    if (titleElement && window.MutationObserver) {
      titleObserver = new MutationObserver(scheduleUpdate);
      titleObserver.observe(titleElement, { childList: true, characterData: true, subtree: true });
    }

    return () => {
      clearTimeout(updateTimer);
      if (history.pushState === patchedPushState) history.pushState = originalPushState;
      if (history.replaceState === patchedReplaceState) history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", scheduleUpdate);
      window.removeEventListener("hashchange", scheduleUpdate);
      titleObserver?.disconnect();
    };
  }

  function createRequestHeaders(extra = {}) {
    return {
      accept: "application/json",
      "x-workflow-bookmarklet-token": bookmarkletToken,
      ...extra,
    };
  }

  cleanupPageChangeWatchers = installPageChangeWatchers();
})();`;

  return `javascript:${encodeURIComponent(payload)}`;
}

export function createAutoInjectUserscript(serviceOrigin, token = "", matchPattern = "") {
  const bookmarkletHref = createBookmarkletHref(serviceOrigin, token);
  const safeMatchPattern = validateUserscriptMatchPattern(matchPattern);
  return `// ==UserScript==
// @name         Workflow 测试反馈自动恢复
// @namespace    workflow-feedback
// @version      1.0.0
// @description  页面加载后自动打开 Workflow 测试反馈面板，刷新后无需再次点击书签栏。
// @match        ${safeMatchPattern}
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  "use strict";
  const bookmarkletHref = ${JSON.stringify(bookmarkletHref)};
  const runFeedbackTool = () => {
    if (window.__workflowFeedbackTool) return;
    const encodedCode = bookmarkletHref.replace(/^javascript:/, "");
    const code = decodeURIComponent(encodedCode);
    (0, eval)(code);
  };

  runFeedbackTool();
})();
`;
}

function validateUserscriptMatchPattern(pattern) {
  const text = String(pattern || "").trim();
  const match = text.match(/^https?:\/\/([^\s/]+)\/.*$/);
  if (!match) throw new Error("Invalid userscript @match pattern");
  const host = match[1];
  const isScopedWildcard = host.startsWith("*.") && host.slice(2).includes(".") && !host.slice(2).includes("*");
  const isExactHost = !host.includes("*");
  if (!isScopedWildcard && !isExactHost) throw new Error("Userscript @match host must be exact or scoped wildcard");
  return text;
}

export function renderBookmarkletPage(container, options = {}) {
  const { readAgentStatus, readBookmarkletConfig, serviceOrigin = "", showToast } = options;
  let bookmarkletToken = "";
  const page = document.createElement("section");
  page.className = "bookmarklet-page";

  const hero = document.createElement("div");
  hero.className = "bookmarklet-card bookmarklet-hero";
  const eyebrow = document.createElement("div");
  eyebrow.className = "bookmarklet-eyebrow";
  eyebrow.textContent = "测试反馈 Bookmarklet";
  const title = document.createElement("h2");
  title.textContent = "把反馈工具安装到浏览器书签栏";
  const description = document.createElement("p");
  description.textContent = "将下面的按钮拖到书签栏后，在任意网页点击它即可注入 Workflow 测试反馈工具。";
  hero.append(eyebrow, title, description);

  const infoCard = document.createElement("div");
  infoCard.className = "bookmarklet-card bookmarklet-info-card";

  const serviceRow = createInfoRow("当前服务地址", serviceOrigin || "未检测到服务地址");

  const statusRow = document.createElement("div");
  statusRow.className = "bookmarklet-info-row";
  const statusLabel = document.createElement("span");
  statusLabel.textContent = "Agent 状态";
  const statusValue = document.createElement("span");
  statusValue.className = "bookmarklet-status is-loading";
  statusValue.textContent = "正在读取";
  statusRow.append(statusLabel, statusValue);

  const refreshButton = document.createElement("button");
  refreshButton.className = "jump-button bookmarklet-refresh-button";
  refreshButton.type = "button";
  refreshButton.textContent = "刷新状态";
  refreshButton.addEventListener("click", () => refreshStatus());

  infoCard.append(serviceRow, statusRow, refreshButton);

  const installCard = document.createElement("div");
  installCard.className = "bookmarklet-card bookmarklet-install-card";
  const installTitle = document.createElement("h3");
  installTitle.textContent = "安装入口";
  const installText = document.createElement("p");
  installText.textContent = "书签方式需要每次页面加载后手动点击，且无法捕获点击前的页面加载接口；如果希望刷新后自动恢复并尽早捕获接口，请填写被测页面匹配地址，再复制自动恢复脚本并安装到 Tampermonkey / Userscripts。";
  const installButton = document.createElement("a");
  installButton.className = "bookmarklet-install-button";
  installButton.href = "#";
  installButton.textContent = "正在准备反馈书签...";
  installButton.addEventListener("click", (event) => {
    event.preventDefault();
    if (typeof showToast === "function") {
      showToast("请将按钮拖到书签栏完成安装。", "知道了");
    }
  });
  const installActions = document.createElement("div");
  installActions.className = "bookmarklet-install-actions";
  const userscriptMatchInput = document.createElement("input");
  userscriptMatchInput.className = "bookmarklet-userscript-match";
  userscriptMatchInput.type = "text";
  userscriptMatchInput.placeholder = "自动恢复匹配地址，例如：https://example.com/*";
  userscriptMatchInput.setAttribute("aria-label", "自动恢复脚本匹配地址");
  const copyButton = document.createElement("button");
  copyButton.className = "jump-button bookmarklet-copy-button";
  copyButton.type = "button";
  copyButton.textContent = "复制 Bookmarklet";
  copyButton.addEventListener("click", async () => {
    const href = installButton.getAttribute("href") || "";
    if (!href || href === "#") {
      notify("反馈书签还没有准备好，请稍后再试。");
      return;
    }

    try {
      await copyText(href);
      notify("已复制 Bookmarklet。Dia 没有书签栏时，可以在目标页面地址栏粘贴并回车运行。");
    } catch {
      notify("复制失败，请右键按钮复制链接地址。");
    }
  });
  const copyUserscriptButton = document.createElement("button");
  copyUserscriptButton.className = "jump-button bookmarklet-copy-userscript-button";
  copyUserscriptButton.type = "button";
  copyUserscriptButton.textContent = "复制自动恢复脚本";
  copyUserscriptButton.addEventListener("click", async () => {
    if (!bookmarkletToken) {
      notify("反馈工具配置还没有准备好，请稍后再试。");
      return;
    }

    const matchPattern = userscriptMatchInput.value.trim();
    try {
      validateUserscriptMatchPattern(matchPattern);
    } catch {
      notify("请先填写精确的 http/https 匹配地址，例如：https://example.com/*，不要使用 https://*/* 这类全网匹配。");
      userscriptMatchInput.focus();
      return;
    }

    try {
      await copyText(createAutoInjectUserscript(serviceOrigin, bookmarkletToken, matchPattern));
      notify("已复制自动恢复脚本。安装后会在页面开始加载时自动打开面板，并尽早捕获 fetch/XHR 接口。");
    } catch {
      notify("复制失败，请稍后重试。");
    }
  });
  installActions.append(installButton, copyButton, userscriptMatchInput, copyUserscriptButton);
  installCard.append(installTitle, installText, installActions);

  const stepsCard = document.createElement("div");
  stepsCard.className = "bookmarklet-card bookmarklet-steps-card";
  const stepsTitle = document.createElement("h3");
  stepsTitle.textContent = "安装步骤";
  const steps = document.createElement("ol");
  [
    "优先方式：将“Workflow 测试反馈”按钮拖拽到浏览器书签栏。",
    "如果浏览器没有书签栏，点击“复制 Bookmarklet”。",
    "如果希望刷新后自动恢复并捕获页面加载阶段的 fetch/XHR，先填写被测页面匹配地址，再点击“复制自动恢复脚本”并安装到 Tampermonkey / Userscripts。",
    "页面右下角出现反馈面板后，复现问题并发送给 Agent。",
  ].forEach((step) => {
    const item = document.createElement("li");
    item.textContent = step;
    steps.appendChild(item);
  });
  stepsCard.append(stepsTitle, steps);

  page.append(hero, infoCard, installCard, stepsCard);
  container.replaceChildren(page);
  refreshBookmarkletConfig();
  refreshStatus();

  async function refreshBookmarkletConfig() {
    if (typeof readBookmarkletConfig !== "function") return;
    try {
      const config = await readBookmarkletConfig();
      bookmarkletToken = String(config?.token || "");
      installButton.href = createBookmarkletHref(serviceOrigin, bookmarkletToken);
      installButton.textContent = "Workflow 测试反馈";
    } catch (error) {
      installButton.textContent = "配置读取失败，请刷新页面";
      if (typeof showToast === "function") {
        showToast(error.message || "测试反馈工具配置读取失败，请刷新页面后重试。", "知道了");
      }
    }
  }

  async function refreshStatus() {
    if (typeof readAgentStatus !== "function") {
      setStatus("未配置", "is-unavailable");
      return;
    }

    refreshButton.disabled = true;
    setStatus("正在读取", "is-loading");
    try {
      const status = await readAgentStatus();
      setStatus(formatAgentStatus(status), status?.ok ? "is-available" : "is-unavailable");
    } catch (error) {
      setStatus(formatStatusReadError(error), "is-error");
    } finally {
      refreshButton.disabled = false;
    }
  }

  function setStatus(text, tone) {
    statusValue.className = `bookmarklet-status ${tone}`;
    statusValue.textContent = text;
  }

  function notify(message) {
    if (typeof showToast === "function") {
      showToast(message, "知道了");
      return;
    }
    window.alert(message);
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy failed");
}

function createInfoRow(label, value) {
  const row = document.createElement("div");
  row.className = "bookmarklet-info-row";
  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  const valueEl = document.createElement("strong");
  valueEl.textContent = value;
  row.append(labelEl, valueEl);
  return row;
}

function formatAgentStatus(status) {
  if (!status || typeof status !== "object") return "未知";
  if (typeof status.text === "string" && status.text) return status.text;
  if (typeof status.message === "string" && status.message) return status.message;
  if (typeof status.status === "string" && status.status) return status.status;
  return status.ok ? "可用" : "不可用";
}

function formatStatusReadError(error) {
  if (error?.status === 404 || error?.message === "Not found") {
    return "状态接口未加载，请重启 Workflow Cockpit 服务";
  }
  return error?.message || "读取失败";
}
