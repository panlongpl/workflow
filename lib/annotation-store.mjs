import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

export const annotationStoreRoot = join(homedir(), ".markdown-viewer");
export const annotationStoreFile = join(annotationStoreRoot, "annotations.json");

export function normalizeAnnotationTarget(payload) {
  const rawRootPath = String(payload.rootPath || "").trim();
  const filePath = String(payload.path || "").trim();
  if (!rawRootPath || !filePath) {
    throwBadRequest("文件路径无效");
  }

  const rootPath = resolve(rawRootPath);
  const absolutePath = resolve(rootPath, filePath);
  if (!isPathInside(rootPath, absolutePath)) {
    throwBadRequest("文件路径无效");
  }

  return { rootPath, filePath };
}

export async function listAnnotations(rootPath, filePath) {
  const { store, importedLegacy } = await readAnnotationStoreWithLegacy(rootPath);
  if (importedLegacy) {
    await writeAnnotationStore(store);
  }

  const document = getAnnotationDocument(store, rootPath, filePath);
  return document?.annotations || [];
}

export async function saveAnnotation(rootPath, filePath, incoming = {}) {
  const quote = String(incoming.quote || "").trim();
  const note = String(incoming.note || "").trim();

  if (!quote) {
    throwBadRequest("请选择要记录的文字");
  }

  if (!note) {
    throwBadRequest("记录内容不能为空");
  }

  const { store } = await readAnnotationStoreWithLegacy(rootPath);
  const document = ensureAnnotationDocument(store, rootPath, filePath);
  const annotations = document.annotations;
  const now = new Date().toISOString();
  const existing = incoming.id ? annotations.find((item) => item.id === incoming.id) : null;
  const annotation = {
    id: existing?.id || randomUUID(),
    quote,
    note,
    contextBefore: String(incoming.contextBefore || existing?.contextBefore || ""),
    contextAfter: String(incoming.contextAfter || existing?.contextAfter || ""),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  if (existing) {
    Object.assign(existing, annotation);
  } else {
    annotations.push(annotation);
  }

  document.updatedAt = now;
  await writeAnnotationStore(store);
  return { annotation, annotations };
}

export async function deleteAnnotation(rootPath, filePath, annotationId) {
  const store = await readAnnotationStore();
  const key = annotationDocumentKey(rootPath, filePath);
  const document = store.documents[key];
  const annotations = (document?.annotations || []).filter((item) => item.id !== annotationId);

  if (document) {
    if (annotations.length) {
      document.annotations = annotations;
      document.updatedAt = new Date().toISOString();
    } else {
      delete store.documents[key];
    }
  }

  await writeAnnotationStore(store);
  return annotations;
}

export async function listAnnotationHistory() {
  const store = await readAnnotationStore();
  const documents = annotationDocuments(store);
  const count = documents.reduce((total, document) => total + document.annotations.length, 0);
  return {
    storePath: annotationStoreFile,
    count,
    documents,
  };
}

async function readAnnotationStoreWithLegacy(rootPath) {
  const store = await readAnnotationStore();
  const importedLegacy = await importLegacyAnnotationStore(store, rootPath);
  return { store, importedLegacy };
}

async function readAnnotationStore() {
  try {
    const content = await readFile(annotationStoreFile, "utf8");
    const parsed = JSON.parse(content);
    return normalizeAnnotationStore(parsed);
  } catch (error) {
    if (error.code === "ENOENT") return createAnnotationStore();
    if (error instanceof SyntaxError) {
      await backupCorruptAnnotationStore();
      return createAnnotationStore();
    }
    throw error;
  }
}

async function writeAnnotationStore(store) {
  await mkdir(annotationStoreRoot, { recursive: true });
  const tempPath = join(annotationStoreRoot, `annotations.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(normalizeAnnotationStore(store), null, 2)}\n`, "utf8");
  await rename(tempPath, annotationStoreFile);
}

async function backupCorruptAnnotationStore() {
  const suffix = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir(annotationStoreRoot, { recursive: true });
  await copyFile(annotationStoreFile, join(annotationStoreRoot, `annotations.corrupt-${suffix}.json`)).catch(() => {});
}

function createAnnotationStore() {
  return { version: 2, documents: {}, legacyImports: {} };
}

function normalizeAnnotationStore(value) {
  const store = createAnnotationStore();
  const documents = value?.documents && typeof value.documents === "object" ? value.documents : {};

  Object.values(documents).forEach((document) => {
    if (Array.isArray(document)) {
      return;
    }

    const rootPath = typeof document?.rootPath === "string" ? resolve(document.rootPath) : "";
    const filePath = typeof document?.path === "string" ? document.path : "";
    if (!rootPath || !filePath) return;

    const normalizedKey = annotationDocumentKey(rootPath, filePath);
    store.documents[normalizedKey] = {
      rootPath,
      rootName: document.rootName || basename(rootPath) || rootPath,
      path: filePath,
      fileName: document.fileName || basename(filePath),
      annotations: normalizeAnnotations(document.annotations || []),
      updatedAt: document.updatedAt || latestAnnotationTime(document.annotations || []),
    };
  });

  store.legacyImports = value?.legacyImports && typeof value.legacyImports === "object"
    ? value.legacyImports
    : {};

  return store;
}

function normalizeAnnotations(annotations) {
  return (Array.isArray(annotations) ? annotations : [])
    .map((annotation) => ({
      id: String(annotation?.id || randomUUID()),
      quote: String(annotation?.quote || ""),
      note: String(annotation?.note || ""),
      contextBefore: String(annotation?.contextBefore || ""),
      contextAfter: String(annotation?.contextAfter || ""),
      createdAt: String(annotation?.createdAt || annotation?.updatedAt || new Date().toISOString()),
      updatedAt: String(annotation?.updatedAt || annotation?.createdAt || new Date().toISOString()),
    }))
    .filter((annotation) => annotation.quote && annotation.note);
}

async function importLegacyAnnotationStore(store, rootPath) {
  if (!rootPath || store.legacyImports[rootPath]) return false;

  const legacyPath = join(rootPath, ".markdown-viewer", "annotations.json");
  let imported = false;
  try {
    const content = await readFile(legacyPath, "utf8");
    const parsed = JSON.parse(content);
    const documents = parsed.documents && typeof parsed.documents === "object" ? parsed.documents : {};

    Object.entries(documents).forEach(([filePath, annotations]) => {
      const normalizedAnnotations = normalizeAnnotations(annotations);
      if (!normalizedAnnotations.length) return;

      const document = ensureAnnotationDocument(store, rootPath, filePath);
      const knownIds = new Set(document.annotations.map((annotation) => annotation.id));
      normalizedAnnotations.forEach((annotation) => {
        if (!knownIds.has(annotation.id)) {
          document.annotations.push(annotation);
          knownIds.add(annotation.id);
          imported = true;
        }
      });
      document.updatedAt = latestAnnotationTime(document.annotations);
    });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  store.legacyImports[rootPath] = new Date().toISOString();
  return imported;
}

function ensureAnnotationDocument(store, rootPath, filePath) {
  const key = annotationDocumentKey(rootPath, filePath);
  if (!store.documents[key]) {
    store.documents[key] = {
      rootPath,
      rootName: basename(rootPath) || rootPath,
      path: filePath,
      fileName: basename(filePath),
      annotations: [],
      updatedAt: "",
    };
  }
  return store.documents[key];
}

function getAnnotationDocument(store, rootPath, filePath) {
  return store.documents[annotationDocumentKey(rootPath, filePath)];
}

function annotationDocuments(store) {
  return Object.values(store.documents)
    .map((document) => ({
      ...document,
      annotations: normalizeAnnotations(document.annotations),
      updatedAt: document.updatedAt || latestAnnotationTime(document.annotations),
    }))
    .filter((document) => document.annotations.length)
    .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
}

function annotationDocumentKey(rootPath, filePath) {
  return JSON.stringify([resolve(rootPath), filePath]);
}

function latestAnnotationTime(annotations) {
  return normalizeAnnotations(annotations)
    .map((annotation) => annotation.updatedAt || annotation.createdAt || "")
    .sort()
    .at(-1) || "";
}

function isPathInside(rootPath, targetPath) {
  const relation = relative(rootPath, targetPath);
  return Boolean(relation) && !relation.startsWith("..") && !isAbsolute(relation);
}

function throwBadRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}
