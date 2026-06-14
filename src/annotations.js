export function applyAnnotationHighlights(article, annotations, openAnnotationDrawer) {
  if (!annotations.length) return;

  const textNodes = collectTextNodes(article);
  const fullText = textNodes.map((node) => node.nodeValue).join("");
  const ranges = annotations
    .map((annotation) => ({
      annotation,
      index: locateAnnotationIndex(fullText, annotation),
    }))
    .filter((entry) => entry.index >= 0)
    .map(({ annotation, index }) => ({
      annotation,
      start: index,
      end: index + annotation.quote.length,
    }))
    .sort((a, b) => a.start - b.start);

  wrapAnnotationTextSegments(textNodes, ranges, openAnnotationDrawer);
}

function collectTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node);
    node = walker.nextNode();
  }
  return nodes;
}

function wrapAnnotationTextSegments(textNodes, ranges, openAnnotationDrawer) {
  const segmentsByNode = new Map();
  let cursor = 0;

  for (const node of textNodes) {
    const nodeStart = cursor;
    const nodeEnd = cursor + node.nodeValue.length;
    cursor = nodeEnd;

    for (const range of ranges) {
      if (range.end <= nodeStart) continue;
      if (range.start >= nodeEnd) break;

      const start = Math.max(range.start, nodeStart) - nodeStart;
      const end = Math.min(range.end, nodeEnd) - nodeStart;
      const text = node.nodeValue.slice(start, end);
      if (!text.trim()) continue;

      const segments = segmentsByNode.get(node) || [];
      segments.push({ start, end, annotation: range.annotation });
      segmentsByNode.set(node, segments);
    }
  }

  for (const [node, segments] of segmentsByNode) {
    wrapNodeSegments(node, segments, openAnnotationDrawer);
  }
}

function wrapNodeSegments(node, segments, openAnnotationDrawer) {
  if (!node.parentNode) return;
  const accepted = [];
  let nextStart = node.nodeValue.length + 1;

  segments
    .sort((a, b) => b.start - a.start || b.end - a.end)
    .forEach((segment) => {
      if (segment.end <= nextStart) {
        accepted.push(segment);
        nextStart = segment.start;
      }
    });

  let source = node;
  for (const segment of accepted) {
    if (!source.parentNode || segment.end > source.nodeValue.length) continue;

    source.splitText(segment.end);
    const target = source.splitText(segment.start);
    const mark = document.createElement("span");
    mark.className = "annotation-mark";
    mark.dataset.annotationId = segment.annotation.id;
    mark.title = segment.annotation.note;
    mark.addEventListener("click", () => openAnnotationDrawer(segment.annotation));
    mark.setAttribute("role", "button");
    mark.tabIndex = 0;
    target.parentNode.insertBefore(mark, target);
    mark.append(target);
  }
}

function locateAnnotationIndex(fullText, annotation) {
  const quote = annotation.quote || "";
  if (!quote) return -1;

  const indexes = [];
  let index = fullText.indexOf(quote);
  while (index >= 0) {
    indexes.push(index);
    index = fullText.indexOf(quote, index + quote.length);
  }
  if (!indexes.length) return -1;
  if (indexes.length === 1) return indexes[0];

  return indexes
    .map((candidate) => ({
      candidate,
      score:
        contextScore(fullText, candidate, annotation.contextBefore, "before") +
        contextScore(fullText, candidate + quote.length, annotation.contextAfter, "after"),
    }))
    .sort((a, b) => b.score - a.score)[0].candidate;
}

function contextScore(fullText, index, context, side) {
  if (!context) return 0;
  const sample = side === "before"
    ? fullText.slice(Math.max(0, index - context.length), index)
    : fullText.slice(index, index + context.length);
  let score = 0;
  const max = Math.min(sample.length, context.length);
  for (let i = 0; i < max; i += 1) {
    const sampleChar = side === "before" ? sample[sample.length - 1 - i] : sample[i];
    const contextChar = side === "before" ? context[context.length - 1 - i] : context[i];
    if (sampleChar !== contextChar) break;
    score += 1;
  }
  return score;
}
