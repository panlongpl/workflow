export function createToastController({ state, els }) {
  function showToast(message, actionLabel = "知道了", action = null, options = {}) {
    if (state.toastTimer) {
      clearTimeout(state.toastTimer);
    }
    els.toastMessage.textContent = message;
    els.toastAction.textContent = actionLabel;
    els.toastAction.style.display = action ? "" : "none";
    state.toastAction = action;
    els.toast.classList.toggle("error", options.tone === "error");
    els.toast.classList.add("visible");
    state.toastTimer = setTimeout(() => {
      hideToast();
    }, 3000);
  }

  function hideToast() {
    if (state.toastTimer) {
      clearTimeout(state.toastTimer);
      state.toastTimer = null;
    }
    state.toastAction = null;
    els.toast.classList.remove("visible");
    els.toast.classList.remove("error");
  }

  return { showToast, hideToast };
}

export function setLoading(els, isLoading, text = "正在处理") {
  els.loadingText.textContent = text;
  els.app.classList.toggle("loading", isLoading);
}

export function scrollContentTo(els, position, behavior = "smooth") {
  const top =
    position === "bottom"
      ? Math.max(0, els.contentShell.scrollHeight - els.contentShell.clientHeight)
      : 0;
  els.contentShell.scrollTo({ top, behavior });
}

export function initResizableSidebar(els) {
  const savedWidth = Number(localStorage.getItem("markdown-viewer-sidebar-width"));
  if (savedWidth) {
    setSidebarWidth(savedWidth);
  }

  els.resizer.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    els.app.classList.add("resizing");
    els.resizer.setPointerCapture(event.pointerId);
  });

  els.resizer.addEventListener("pointermove", (event) => {
    if (!els.app.classList.contains("resizing")) return;
    const appLeft = els.app.getBoundingClientRect().left;
    const width = setSidebarWidth(event.clientX - appLeft);
    localStorage.setItem("markdown-viewer-sidebar-width", String(width));
  });

  const stopResize = (event) => {
    if (!els.app.classList.contains("resizing")) return;
    els.app.classList.remove("resizing");
    if (els.resizer.hasPointerCapture(event.pointerId)) {
      els.resizer.releasePointerCapture(event.pointerId);
    }
  };

  els.resizer.addEventListener("pointerup", stopResize);
  els.resizer.addEventListener("pointercancel", stopResize);
}

function setSidebarWidth(width) {
  const maxWidth = Math.min(620, Math.round(window.innerWidth * 0.55));
  const nextWidth = Math.max(300, Math.min(width, maxWidth));
  document.documentElement.style.setProperty("--sidebar-width", `${nextWidth}px`);
  return nextWidth;
}
