import { Terminal } from "../node_modules/@xterm/xterm/lib/xterm.mjs";
import { FitAddon } from "../node_modules/@xterm/addon-fit/lib/addon-fit.mjs";

const agents = {
  codex: {
    label: "Codex",
    description: "代码任务、修改和自动执行",
  },
  claude: {
    label: "Claude Code",
    description: "长上下文分析和协作",
  },
  custom: {
    label: "自定义 Agent",
    description: "输入一条本地启动命令",
  },
};

const dispatchSubmitDelayMs = 40;

export function createTerminalController({ getCwd, fullscreenButton, setStatus, onAvailabilityChange }) {
  let page = null;
  let selectView = null;
  let sessionView = null;
  let terminalMount = null;
  let customForm = null;
  let customCommandInput = null;
  let cocoCaret = null;
  let terminal = null;
  let fitAddon = null;
  let socket = null;
  let resizeObserver = null;
  let sessionState = null;
  let selectedAgent = "";
  let customCommand = "";
  let lastLaunchTarget = null;
  let showCocoCaret = false;
  let cocoInputEditing = false;
  let cocoCaretUpdateId = 0;
  let cocoSlashCommandSelectionIndex = 0;
  let cocoSlashCommandSelectedCommand = "";

  function render(container) {
    if (!page) {
      page = createPage();
    }

    container.replaceChildren(page);
    syncCwd();
    renderCurrentState();
    if (sessionState) scheduleFit();
    notifyAvailabilityChange();
  }

  function createPage() {
    const element = document.createElement("article");
    element.className = "ai-terminal-page";
    element.innerHTML = `
      <section class="agent-start-panel" data-agent-select>
        <div class="agent-start-copy">
          <h2>选择 AI Agent</h2>
          <p>选择后会在后台启动对应 CLI，页面用真实终端承载交互。</p>
          <div class="agent-start-cwd"></div>
        </div>
        <div class="agent-choice-grid">
          <button class="agent-choice" type="button" data-agent="codex">
            <span>Codex</span>
            <small>代码任务、修改和自动执行</small>
          </button>
          <button class="agent-choice" type="button" data-agent="claude">
            <span>Claude Code</span>
            <small>长上下文分析和协作</small>
          </button>
          <button class="agent-choice" type="button" data-agent="custom">
            <span>自定义</span>
            <small>输入启动命令后进入会话</small>
          </button>
        </div>
        <form class="custom-agent-form" data-custom-agent-form hidden>
          <label for="customAgentCommand">启动命令</label>
          <div class="custom-agent-row">
            <input id="customAgentCommand" class="custom-agent-input" type="text" placeholder="例如：codex --no-alt-screen -C ." autocomplete="off" spellcheck="false" />
            <button class="custom-agent-submit" type="submit">启动</button>
          </div>
        </form>
      </section>

      <section class="agent-session-panel" data-agent-session hidden>
        <div class="agent-terminal-card">
          <div class="agent-terminal-mount" data-terminal-mount>
            <div class="agent-coco-caret" data-coco-caret hidden></div>
          </div>
        </div>
      </section>
    `;

    selectView = element.querySelector("[data-agent-select]");
    sessionView = element.querySelector("[data-agent-session]");
    terminalMount = element.querySelector("[data-terminal-mount]");
    customForm = element.querySelector("[data-custom-agent-form]");
    customCommandInput = element.querySelector("#customAgentCommand");
    cocoCaret = element.querySelector("[data-coco-caret]");

    element.querySelectorAll("[data-agent]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.agent === "custom") {
          showCustomCommandForm();
          return;
        }
        startSession(button.dataset.agent);
      });
    });
    customForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const command = customCommandInput.value.trim();
      if (!command) {
        customCommandInput.focus();
        return;
      }
      startSession("custom", { command });
    });
    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener("keydown", handleFullscreenKeydown, true);

    return element;
  }

  function syncCwd() {
    const cwd = getCwd();
    page?.querySelectorAll(".agent-start-cwd").forEach((element) => {
      element.textContent = cwd;
    });
  }

  function renderCurrentState() {
    if (sessionState) {
      selectView.hidden = true;
      sessionView.hidden = false;
      return;
    }

    selectView.hidden = false;
    sessionView.hidden = true;
  }

  function showCustomCommandForm() {
    customForm.hidden = false;
    customCommandInput.focus();
  }

  function startSession(agent, options = {}) {
    if (!agents[agent]) return;

    const command = agent === "custom" ? String(options.command || "").trim() : "";
    stopSocket();
    selectedAgent = agent;
    customCommand = command;
    lastLaunchTarget = { agent, command };
    showCocoCaret = shouldUseCocoCaret(agent, command);
    cocoInputEditing = false;
    cocoSlashCommandSelectionIndex = 0;
    cocoSlashCommandSelectedCommand = "";
    clearCocoSlashCommandHighlight();
    hideCocoCaret();
    sessionState = "starting";
    selectView.hidden = true;
    sessionView.hidden = false;
    setSessionStatus("启动中");
    setStatus("AI 终端连接中");
    ensureTerminal();
    terminal.reset();
    terminal.writeln(`正在启动 ${agents[agent].label}...`);
    if (command) {
      terminal.writeln(`启动命令: ${command}`);
    }
    terminal.writeln(`工作目录: ${getCwd()}`);
    terminal.writeln("");
    notifyAvailabilityChange();
    connectSocket(agent, { command });
    scheduleFit();
  }

  function ensureTerminal() {
    if (terminal) return;

    terminal = new Terminal({
      allowProposedApi: false,
      cursorBlink: true,
      cursorInactiveStyle: "block",
      cursorStyle: "block",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 14,
      lineHeight: 1.25,
      scrollback: 8000,
      tabStopWidth: 4,
      theme: {
        background: "#090d18",
        foreground: "#e5edf7",
        cursor: "#5eead4",
        selectionBackground: "#31556b",
        black: "#0b1020",
        red: "#fb7185",
        green: "#34d399",
        yellow: "#facc15",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e5edf7",
        brightBlack: "#64748b",
        brightRed: "#fda4af",
        brightGreen: "#86efac",
        brightYellow: "#fde68a",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#ffffff",
      },
    });
    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalMount);
    terminal.onData((data) => {
      sendSocket({ type: "terminal_input", data });
      requestCursorRestore();
      updateCocoEditingState(data);
      scheduleCocoCaretUpdate();
      window.setTimeout(scheduleCocoCaretUpdate, 60);
    });

    resizeObserver = new ResizeObserver(() => {
      fitAndResize();
    });
    resizeObserver.observe(terminalMount);
  }

  function connectSocket(agent, options = {}) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${window.location.host}/api/agent`);
    const currentSocket = socket;

    socket.addEventListener("open", () => {
      if (socket !== currentSocket) return;
      const dimensions = getTerminalDimensions();
      socket.send(JSON.stringify({
        type: "start_session",
        agent,
        command: options.command || "",
        cwd: getCwd(),
        cols: dimensions.cols,
        rows: dimensions.rows,
      }));
    });

    socket.addEventListener("message", (event) => {
      if (socket !== currentSocket) return;
      handleSocketMessage(event.data);
    });

    socket.addEventListener("close", () => {
      if (socket !== currentSocket) return;
      sessionState = "closed";
      setSessionStatus("已断开");
      setStatus("AI 终端已断开");
      terminal?.writeln("\r\n[连接已断开]");
      notifyAvailabilityChange();
    });

    socket.addEventListener("error", () => {
      if (socket !== currentSocket) return;
      sessionState = "closed";
      setSessionStatus("连接失败");
      setStatus("AI 终端连接失败");
      terminal?.writeln("\r\n[WebSocket 连接失败，请确认本地服务已启动]");
      notifyAvailabilityChange();
    });
  }

  function handleSocketMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.type === "connected") return;

    if (message.type === "session_started") {
      sessionState = "running";
      setSessionStatus("运行中");
      setStatus(`${message.label || agents[selectedAgent].label} 已启动`);
      fitAndResize();
      terminal?.focus();
      requestCursorRestore();
      scheduleCocoCaretUpdate();
      notifyAvailabilityChange();
      return;
    }

    if (message.type === "terminal_output") {
      writeTerminalOutput(message.data || "");
      return;
    }

    if (message.type === "agent_output") {
      writeTerminalOutput(message.data || message.text || "");
      return;
    }

    if (message.type === "status") {
      setSessionStatus(message.message || message.status || "运行中");
      return;
    }

    if (message.type === "session_closed") {
      sessionState = "closed";
      setSessionStatus("已结束");
      setStatus("AI 终端已结束");
      terminal?.writeln("\r\n[会话已结束]");
      notifyAvailabilityChange();
      return;
    }

    if (message.type === "error") {
      sessionState = "closed";
      setSessionStatus("错误");
      setStatus("AI 终端错误");
      terminal?.writeln(`\r\n[错误] ${message.message || "Agent 运行失败。"}`);
      notifyAvailabilityChange();
    }
  }

  function clearSession() {
    terminal?.clear();
    cocoInputEditing = false;
    hideCocoCaret();
    requestCursorRestore();
    terminal?.focus();
  }

  function interruptSession() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    cocoInputEditing = false;
    hideCocoCaret();
    sendSocket({ type: "terminal_input", data: "\x03" });
    setSessionStatus("已发送停止信号");
    terminal?.focus();
  }

  function reconnectSession() {
    if (sessionState === "running" && socket?.readyState === WebSocket.OPEN) {
      setStatus("AI 终端已连接");
      terminal?.writeln("\r\n[重新连接] 当前会话仍在运行。");
      terminal?.focus();
      notifyAvailabilityChange();
      return;
    }

    if (sessionState === "starting") {
      setStatus("AI 终端连接中");
      terminal?.writeln("\r\n[重新连接] 当前会话正在启动。");
      terminal?.focus();
      notifyAvailabilityChange();
      return;
    }

    if (!lastLaunchTarget?.agent || !agents[lastLaunchTarget.agent]) {
      setStatus("没有可重新连接的 Agent");
      sessionState = null;
      renderCurrentState();
      notifyAvailabilityChange();
      return;
    }

    if (lastLaunchTarget.agent === "custom" && !lastLaunchTarget.command) {
      setStatus("缺少自定义 Agent 命令");
      sessionState = null;
      renderCurrentState();
      customForm.hidden = false;
      customCommandInput.focus();
      notifyAvailabilityChange();
      return;
    }

    terminal?.writeln("\r\n[重新连接] 正在重新启动上一次 Agent 会话...");
    startSession(lastLaunchTarget.agent, { command: lastLaunchTarget.command });
  }

  function restartSession() {
    stopSocket();
    selectedAgent = "";
    customCommand = "";
    lastLaunchTarget = null;
    sessionState = null;
    showCocoCaret = false;
    cocoInputEditing = false;
    cocoSlashCommandSelectionIndex = 0;
    cocoSlashCommandSelectedCommand = "";
    clearCocoSlashCommandHighlight();
    hideCocoCaret();
    if (customForm) customForm.hidden = true;
    setFullscreen(false);
    setStatus("AI 终端");
    setSessionStatus("-");
    terminal?.reset();
    renderCurrentState();
    notifyAvailabilityChange();
  }

  function canDispatchToAgent() {
    if (!sessionState) {
      return { ok: false, reason: "no-session", message: "当前没有可用的 Agent" };
    }
    if (sessionState === "starting") {
      return { ok: false, reason: "starting", message: "Agent 正在启动，请稍后再试" };
    }
    if (sessionState !== "running") {
      return { ok: false, reason: "closed", message: "当前 Agent 会话不可用" };
    }
    if (!isDispatchableAgent(selectedAgent)) {
      return { ok: false, reason: "unsupported-agent", message: "当前终端会话不可用于评论派发" };
    }
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return { ok: false, reason: "socket-not-open", message: "Agent 连接不可用" };
    }
    return { ok: true, agent: selectedAgent, label: getAgentDisplayLabel() };
  }

  function dispatchPrompt(prompt) {
    const availability = canDispatchToAgent();
    if (!availability.ok) return availability;

    const text = String(prompt || "").trim();
    if (!text) {
      return { ok: false, reason: "empty-prompt", message: "发送内容为空" };
    }

    const dispatchSocket = socket;
    sendSocket({ type: "terminal_input", data: text });
    window.setTimeout(() => {
      if (socket !== dispatchSocket || socket?.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "terminal_input", data: "\r" }));
      requestCursorRestore();
    }, dispatchSubmitDelayMs);
    requestCursorRestore();
    return { ok: true, agent: availability.agent, label: availability.label };
  }

  function getDispatchStatus() {
    const availability = canDispatchToAgent();
    const selectedLabel = getAgentDisplayLabel();
    const title = getAgentStatusTitle(selectedLabel);
    if (availability.ok) {
      return {
        ...availability,
        tone: "available",
        text: `${availability.label} 可用`,
        ariaLabel: `Agent 状态：${availability.label} 可用`,
        title,
      };
    }

    if (availability.reason === "starting") {
      return {
        ...availability,
        tone: "starting",
        label: selectedLabel,
        text: `${selectedLabel} 启动中`,
        ariaLabel: `Agent 状态：${selectedLabel} 启动中`,
        title,
      };
    }

    if (availability.reason === "unsupported-agent") {
      return {
        ...availability,
        tone: "unsupported",
        label: selectedLabel,
        text: `${selectedLabel} 不可派发`,
        ariaLabel: `Agent 状态：${selectedLabel} 不可用于评论派发`,
        title,
      };
    }

    if (availability.reason === "socket-not-open") {
      return {
        ...availability,
        tone: "error",
        label: selectedLabel,
        text: `${selectedLabel} 连接不可用`,
        ariaLabel: `Agent 状态：${selectedLabel} 连接不可用`,
        title,
      };
    }

    if (availability.reason === "closed") {
      return {
        ...availability,
        tone: "unavailable",
        label: selectedLabel,
        text: `${selectedLabel} 不可用`,
        ariaLabel: `Agent 状态：${selectedLabel} 不可用`,
        title,
      };
    }

    return {
      ...availability,
      tone: "idle",
      text: "无可用 Agent",
      ariaLabel: "Agent 状态：无可用 Agent",
    };
  }

  function notifyAvailabilityChange() {
    onAvailabilityChange?.(getDispatchStatus());
  }

  function stopSocket() {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "stop_session" }));
      socket.close();
    }
    socket = null;
  }

  function closeSession() {
    stopSocket();
    sessionState = null;
    selectedAgent = "";
    customCommand = "";
    lastLaunchTarget = null;
    showCocoCaret = false;
    cocoInputEditing = false;
    cocoSlashCommandSelectionIndex = 0;
    cocoSlashCommandSelectedCommand = "";
    clearCocoSlashCommandHighlight();
    hideCocoCaret();
    setFullscreen(false);
    notifyAvailabilityChange();
  }

  function fitAndResize() {
    if (!terminal || !fitAddon || sessionView.hidden) return;

    try {
      fitAddon.fit();
    } catch {
      return;
    }

    const dimensions = getTerminalDimensions();
    sendSocket({ type: "resize", cols: dimensions.cols, rows: dimensions.rows });
    scheduleCocoCaretUpdate();
  }

  function writeTerminalOutput(data) {
    terminal?.write(keepCursorVisible(data), () => {
      requestCursorRestore();
      scheduleCocoCaretUpdate();
    });
  }

  function keepCursorVisible(data) {
    return String(data)
      .replace(/\x1b\[\?25l/g, "")
      .replace(/\x1b\[\?12l/g, "");
  }

  function requestCursorRestore() {
    requestAnimationFrame(() => {
      if (!terminal) return;
      terminal.write("\x1b[?25h", () => {
        terminal.refresh(0, terminal.rows - 1);
        terminal.focus();
      });
    });
  }

  function scheduleFit(afterFit) {
    requestAnimationFrame(() => {
      fitAndResize();
      afterFit?.();
    });
  }

  function scheduleCocoCaretUpdate() {
    if (!showCocoCaret) {
      hideCocoCaret();
      return;
    }

    cancelAnimationFrame(cocoCaretUpdateId);
    cocoCaretUpdateId = requestAnimationFrame(updateCocoCaret);
  }

  function updateCocoCaret() {
    if (!showCocoCaret || !terminalMount || !cocoCaret || !terminal) {
      hideCocoCaret();
      return;
    }

    const target = findCocoCaretTarget();
    if (!target) {
      clearCocoSlashCommandHighlight();
      if (hasCocoSelectionPanel()) {
        suppressCocoTerminalCursor();
        return;
      }
      hideCocoCaret();
      return;
    }

    if (target.kind === "slash-command") {
      updateCocoSlashCommandHighlight();
    } else {
      clearCocoSlashCommandHighlight();
    }

    if (!target.isPlaceholder && !cocoInputEditing) {
      hideCocoCaret();
      return;
    }

    const caretColumn = stringCellWidth(target.textBeforeCaret);
    const rowBox = target.row.getBoundingClientRect();
    const mountBox = terminalMount.getBoundingClientRect();
    const cellWidth = terminal.cols ? rowBox.width / terminal.cols : 8;

    cocoCaret.hidden = false;
    cocoCaret.style.left = `${rowBox.left - mountBox.left + caretColumn * cellWidth}px`;
    cocoCaret.style.top = `${rowBox.top - mountBox.top + 1}px`;
    cocoCaret.style.height = `${Math.max(12, rowBox.height - 2)}px`;
    terminalMount.classList.add("coco-caret-active");
  }

  function findCocoCaretTarget() {
    const rows = Array.from(terminalMount?.querySelectorAll(".xterm-rows > div") || []);
    for (const row of rows.reverse()) {
      const text = row.textContent || "";
      const promptTarget = getCocoPromptCaretTarget(row, text);
      if (promptTarget) return promptTarget;

      const slashTarget = getCocoSlashCommandCaretTarget(row, text);
      if (slashTarget) return slashTarget;
    }
    return null;
  }

  function getCocoPromptCaretTarget(row, text) {
    const inputMarker = "│ > ";
    const markerIndex = text.indexOf(inputMarker);
    if (markerIndex < 0) return null;

    const rightBorderIndex = text.lastIndexOf("│");
    if (rightBorderIndex <= markerIndex) return null;

    const isPlaceholder = text.includes("Ask anything...");
    const textBeforeBorder = text.slice(0, rightBorderIndex).replace(/\s+$/, "");
    const markerPrefix = text.slice(0, markerIndex + inputMarker.length);
    return {
      row,
      kind: "prompt",
      isPlaceholder,
      textBeforeCaret: isPlaceholder ? markerPrefix : textBeforeBorder,
    };
  }

  function getCocoSlashCommandCaretTarget(row, text) {
    const leftBorderIndex = text.indexOf("│");
    if (leftBorderIndex < 0) return null;

    const afterBorder = text.slice(leftBorderIndex + 1);
    const slashMatch = afterBorder.match(/^(\s*\/[^│\s]*)/);
    if (!slashMatch) return null;

    return {
      row,
      kind: "slash-command",
      isPlaceholder: false,
      textBeforeCaret: text.slice(0, leftBorderIndex + 1) + slashMatch[1],
    };
  }

  function updateCocoSlashCommandHighlight() {
    const optionGroups = getCocoSlashCommandOptionGroups();
    clearCocoSlashCommandHighlight();
    if (!optionGroups.length) return;

    const selectedIndex = getCocoSlashCommandSelectedIndex(optionGroups);
    cocoSlashCommandSelectionIndex = selectedIndex;
    cocoSlashCommandSelectedCommand = getCocoSlashCommandFromGroup(optionGroups[selectedIndex]) || cocoSlashCommandSelectedCommand;
    optionGroups[selectedIndex]?.forEach((row, index) => {
      row.classList.add("coco-slash-command-active");
      if (index === 0) row.classList.add("coco-slash-command-active-start");
    });
  }

  function getCocoSlashCommandSelectedIndex(optionGroups) {
    if (cocoSlashCommandSelectedCommand) {
      const matchedIndex = optionGroups.findIndex((group) => getCocoSlashCommandFromGroup(group) === cocoSlashCommandSelectedCommand);
      if (matchedIndex >= 0) return matchedIndex;
    }

    return clamp(cocoSlashCommandSelectionIndex, 0, optionGroups.length - 1);
  }

  function clearCocoSlashCommandHighlight() {
    terminalMount?.querySelectorAll(".coco-slash-command-active").forEach((row) => {
      row.classList.remove("coco-slash-command-active");
      row.classList.remove("coco-slash-command-active-start");
    });
  }

  function getCocoSlashCommandOptionGroups() {
    const rows = Array.from(terminalMount?.querySelectorAll(".xterm-rows > div") || []);
    const groups = [];
    let currentGroup = null;

    for (const row of rows) {
      const text = row.textContent || "";
      if (isCocoSlashCommandOptionRow(text)) {
        currentGroup = [row];
        groups.push(currentGroup);
        continue;
      }

      if (currentGroup && isCocoSlashCommandContinuationRow(text)) {
        currentGroup.push(row);
        continue;
      }

      currentGroup = null;
    }

    return groups;
  }

  function getCocoSlashCommandFromGroup(group) {
    const text = group?.[0]?.textContent || "";
    return text.match(/^\s*(\/[^\s│]+)/)?.[1] || "";
  }

  function isCocoSlashCommandOptionRow(text) {
    return /^\s*\/[^\s│]+\s+\S/.test(text);
  }

  function isCocoSlashCommandContinuationRow(text) {
    return /^\s+\S/.test(text) && !/^\s*\//.test(text) && !text.includes("│");
  }

  function hideCocoCaret() {
    if (cocoCaret) cocoCaret.hidden = true;
    terminalMount?.classList.remove("coco-caret-active");
  }

  function suppressCocoTerminalCursor() {
    if (cocoCaret) cocoCaret.hidden = true;
    terminalMount?.classList.add("coco-caret-active");
  }

  function hasCocoSelectionPanel() {
    const rows = Array.from(terminalMount?.querySelectorAll(".xterm-rows > div") || []);
    const hasSelection = rows.some((row) => isCocoSelectionPanelRow(row.textContent || ""));
    if (!hasSelection) return false;

    return rows.some((row) => isCocoSelectionPanelFrameRow(row.textContent || ""));
  }

  function hasCocoBackMenuPanel() {
    const rows = Array.from(terminalMount?.querySelectorAll(".xterm-rows > div") || []);
    const hasBackHint = rows.some((row) => /\bEsc\b.*\bBackspace\b.*\bgo back\b/.test(row.textContent || ""));
    if (!hasBackHint) return false;

    return rows.some((row) => /^\s*[❯›>]?\s*\d+\.\s+\S/.test(row.textContent || ""));
  }

  function isCocoSelectionPanelRow(text) {
    return /(?:^|\s)[❯›>]\s+\d+\./.test(text);
  }

  function isCocoSelectionPanelFrameRow(text) {
    return text.includes("│") || /\(Esc or Backspace\b/.test(text);
  }

  function updateCocoEditingState(data) {
    if (!showCocoCaret) return;

    const value = String(data || "");
    if (value.includes("\x03")) {
      cocoInputEditing = false;
      cocoSlashCommandSelectionIndex = 0;
      cocoSlashCommandSelectedCommand = "";
      clearCocoSlashCommandHighlight();
      hideCocoCaret();
      return;
    }

    if (/[\r\n]/.test(value)) {
      const target = findCocoCaretTarget();
      const keepCommandCaret = target?.kind === "slash-command" || hasCocoSelectionPanel();
      cocoInputEditing = keepCommandCaret;
      cocoSlashCommandSelectionIndex = 0;
      cocoSlashCommandSelectedCommand = "";
      clearCocoSlashCommandHighlight();
      if (!keepCommandCaret) hideCocoCaret();
      window.setTimeout(scheduleCocoCaretUpdate, 120);
      return;
    }

    if (value) {
      cocoInputEditing = true;
      updateCocoSlashCommandSelection(value);
    }
  }

  function updateCocoSlashCommandSelection(value) {
    const optionGroups = getCocoSlashCommandOptionGroups();
    if (value.includes("/")) {
      cocoSlashCommandSelectionIndex = 0;
      cocoSlashCommandSelectedCommand = getCocoSlashCommandFromGroup(optionGroups[0]);
      return;
    }

    const optionCount = optionGroups.length;
    if (!optionCount) return;

    const currentIndex = getCocoSlashCommandSelectedIndex(optionGroups);

    if (value.includes("\x1b[B") || value.includes("\x1bOB") || value.includes("\t")) {
      cocoSlashCommandSelectionIndex = (currentIndex + 1) % optionCount;
      cocoSlashCommandSelectedCommand = getCocoSlashCommandFromGroup(optionGroups[cocoSlashCommandSelectionIndex]);
      return;
    }

    if (value.includes("\x1b[A") || value.includes("\x1bOA")) {
      cocoSlashCommandSelectionIndex = (currentIndex - 1 + optionCount) % optionCount;
      cocoSlashCommandSelectedCommand = getCocoSlashCommandFromGroup(optionGroups[cocoSlashCommandSelectionIndex]);
    }
  }

  function getTerminalDimensions() {
    return {
      cols: terminal?.cols || 120,
      rows: terminal?.rows || 36,
    };
  }

  function sendSocket(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function setSessionStatus(status) {
    const statusElement = page?.querySelector(".agent-session-state");
    if (statusElement) statusElement.textContent = status;
  }

  function toggleFullscreen() {
    setFullscreen(!document.body.classList.contains("terminal-view-fullscreen"));
  }

  function setFullscreen(active) {
    document.body.classList.toggle("terminal-view-fullscreen", active);
    if (fullscreenButton) {
      fullscreenButton.textContent = active ? "退出全屏" : "全屏";
    }
    if (active) {
      const target = sessionView || page || document.documentElement;
      const request = target.requestFullscreen?.();
      if (request?.then) {
        request.then(lockFullscreenEscape).catch(() => {});
      } else {
        lockFullscreenEscape();
      }
    } else if (document.fullscreenElement) {
      unlockFullscreenEscape();
      const request = document.exitFullscreen?.();
      if (request?.catch) request.catch(() => {});
    } else {
      unlockFullscreenEscape();
    }
    scheduleFit();
  }

  function syncFullscreenState() {
    const isFullscreen = Boolean(document.fullscreenElement);
    if (!isFullscreen && document.body.classList.contains("terminal-view-fullscreen")) {
      document.body.classList.remove("terminal-view-fullscreen");
      if (fullscreenButton) fullscreenButton.textContent = "全屏";
      unlockFullscreenEscape();
      scheduleFit();
    }
  }

  function handleFullscreenKeydown(event) {
    if (!document.body.classList.contains("terminal-view-fullscreen")) return;
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (shouldRouteEscapeToTerminal()) {
      sendSocket({ type: "terminal_input", data: "\x1b" });
      terminal?.focus();
      scheduleCocoCaretUpdate();
      return;
    }
    setFullscreen(false);
  }

  function shouldRouteEscapeToTerminal() {
    if (!terminalMount) return false;
    return hasCocoSelectionPanel() || hasCocoBackMenuPanel();
  }

  function lockFullscreenEscape() {
    const lock = navigator.keyboard?.lock?.(["Escape"]);
    if (lock?.catch) lock.catch(() => {});
  }

  function unlockFullscreenEscape() {
    navigator.keyboard?.unlock?.();
  }

  function isDispatchableAgent(agent) {
    return agent === "codex" || agent === "claude" || agent === "custom";
  }

  function getAgentDisplayLabel() {
    if (selectedAgent === "custom") {
      const summary = summarizeCustomCommand(customCommand);
      return summary ? `${agents.custom.label} · ${summary}` : agents.custom.label;
    }
    return selectedAgent && agents[selectedAgent] ? agents[selectedAgent].label : "Agent";
  }

  function getAgentStatusTitle(label) {
    if (selectedAgent === "custom" && customCommand) {
      return `${label}\n启动命令：${customCommand}`;
    }
    return label;
  }

  return {
    render,
    clear: clearSession,
    canDispatchToAgent,
    getDispatchStatus,
    dispatchPrompt,
    interrupt: interruptSession,
    toggleFullscreen,
    reconnect: reconnectSession,
    restart: restartSession,
    close: closeSession,
  };
}

function shouldUseCocoCaret(agent, command = "") {
  if (agent !== "custom") return false;
  return /(^|[\s/])(coco|trae|traecli|trae-agent|ta)(\s|$)/.test(String(command || ""));
}

function summarizeCustomCommand(command = "") {
  const text = String(command || "").trim();
  if (!text) return "";
  const firstToken = text.split(/\s+/)[0] || "";
  const commandName = firstToken.split(/[\\/]/).filter(Boolean).at(-1) || firstToken;
  return commandName.length > 24 ? `${commandName.slice(0, 24)}…` : commandName;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stringCellWidth(value) {
  return Array.from(value || "").reduce((width, char) => width + charCellWidth(char), 0);
}

function charCellWidth(char) {
  const code = char.codePointAt(0) || 0;

  if (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe00 && code <= 0xfe0f)
  ) {
    return 0;
  }

  if (
    code >= 0x1100 &&
    (
      code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x20000 && code <= 0x3fffd)
    )
  ) {
    return 2;
  }

  return 1;
}
