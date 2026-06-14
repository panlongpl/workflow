export function createDocumentPanel({ state, els }) {
  function buildDocumentOutline() {
    const article = els.contentShell.querySelector(".markdown-body");
    const headings = article
      ? [...article.querySelectorAll("h1, h2, h3, h4, h5, h6")]
      : [];

    if (!headings.length) {
      clearDocumentOutline();
      return;
    }

    const usedIds = new Set();
    els.outlineList.replaceChildren(
      ...headings.map((heading) => {
        const level = Number(heading.tagName.slice(1));
        const text = heading.textContent.trim() || "未命名标题";
        const id = uniqueSlug(text, usedIds);
        heading.id = id;

        const button = document.createElement("button");
        button.type = "button";
        button.className = `outline-link outline-level-${level}`;
        button.textContent = text;
        button.title = text;
        button.addEventListener("click", () => scrollHeadingIntoView(heading));
        return button;
      }),
    );
    updateSidePanelVisibility();
  }

  function clearDocumentOutline() {
    els.outlineList.replaceChildren();
    updateSidePanelVisibility();
  }

  function switchAnnotationPanel(tab) {
    state.annotationPanelTab = "outline";
    els.outlineTab.classList.toggle("active", tab === "outline");
    els.outlineList.hidden = false;
  }

  function renderAnnotationList() {
    updateSidePanelVisibility();
  }

  function scrollAnnotationIntoView(annotationId) {
    const mark = els.contentShell.querySelector(`.annotation-mark[data-annotation-id="${CSS.escape(annotationId)}"]`);
    if (!mark) return;
    mark.classList.add("active");
    mark.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => mark.classList.remove("active"), 1200);
  }

  function updateSidePanelVisibility() {
    if (state.viewMode === "history") {
      els.docOutline.classList.remove("visible");
      els.docOutline.closest(".viewer").classList.remove("outline-visible");
      return;
    }

    const hasOutline = els.outlineList.children.length > 0;
    els.docOutline.classList.toggle("visible", hasOutline);
    els.docOutline.closest(".viewer").classList.toggle("outline-visible", hasOutline);
    if (hasOutline) switchAnnotationPanel("outline");
  }

  function scrollHeadingIntoView(heading) {
    const shellRect = els.contentShell.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    els.contentShell.scrollTo({
      top: els.contentShell.scrollTop + headingRect.top - shellRect.top - 18,
      behavior: "smooth",
    });
  }

  return {
    buildDocumentOutline,
    clearDocumentOutline,
    renderAnnotationList,
    scrollAnnotationIntoView,
    switchAnnotationPanel,
    updateSidePanelVisibility,
  };
}

function uniqueSlug(text, usedIds) {
  const base =
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "heading";
  let id = base;
  let index = 2;
  while (usedIds.has(id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  usedIds.add(id);
  return id;
}
