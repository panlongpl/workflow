import { readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export async function readDirectorySnapshot(directoryPath) {
  const rootPath = resolve(directoryPath);
  const info = await stat(rootPath);
  if (!info.isDirectory()) {
    throw new Error("路径不是目录");
  }

  const files = [];
  const tree = createTreeNode(basename(rootPath) || rootPath);
  await scanLocalDirectory(rootPath, rootPath, tree, files);
  files.sort((a, b) => b.lastModified - a.lastModified);
  return {
    rootPath,
    rootName: basename(rootPath) || rootPath,
    files,
    tree,
  };
}

export function createTreeNode(name) {
  return { name, dirs: [], files: [] };
}

export function isMarkdownFile(name) {
  return /\.(md|markdown)$/i.test(name);
}

export function shouldSkipDirectory(name) {
  return name === ".git" || name === "node_modules" || name === ".markdown-viewer";
}

export function isPathInside(rootPath, targetPath) {
  const relation = relative(rootPath, targetPath);
  return Boolean(relation) && !relation.startsWith("..") && !isAbsolute(relation);
}

async function scanLocalDirectory(rootPath, directoryPath, treeNode, files) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN");
  });

  for (const entry of entries) {
    const absolutePath = join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) continue;

      const child = createTreeNode(entry.name);
      treeNode.dirs.push(child);
      await scanLocalDirectory(rootPath, absolutePath, child, files);
      if (!child.dirs.length && !child.files.length) {
        treeNode.dirs = treeNode.dirs.filter((dir) => dir !== child);
      }
      continue;
    }

    if (!entry.isFile() || !isMarkdownFile(entry.name)) continue;

    const info = await stat(absolutePath);
    const item = {
      name: entry.name,
      path: relative(rootPath, absolutePath),
      lastModified: info.mtimeMs,
      size: info.size,
    };
    files.push(item);
    treeNode.files.push(item);
  }
}
