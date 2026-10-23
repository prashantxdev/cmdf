import fs from "node:fs";
import path from "node:path";
import {
  validateWorkspacePath,
  isProtectedPath,
} from "../security/path-guard.js";

export interface FileEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  modified: Date;
  path: string;
}

export interface FileSystemResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/**
 * List files and directories within a target directory in workspace.
 */
export async function listFiles(
  workspaceRoot: string,
  targetDir: string = ".",
  includeHidden: boolean = false,
): Promise<FileSystemResult> {
  const check = validateWorkspacePath(targetDir, workspaceRoot);
  if (!check.isValid) {
    throw new Error(check.error);
  }

  if (!fs.existsSync(check.resolvedPath)) {
    throw new Error(`Directory not found: "${targetDir}"`);
  }

  const stat = fs.statSync(check.resolvedPath);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: "${targetDir}"`);
  }

  const dirents = fs.readdirSync(check.resolvedPath, { withFileTypes: true });
  const entries: FileEntry[] = [];

  for (const dirent of dirents) {
    if (!includeHidden && dirent.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(check.resolvedPath, dirent.name);
    try {
      const itemStat = fs.statSync(fullPath);
      entries.push({
        name: dirent.name,
        isDirectory: dirent.isDirectory(),
        size: itemStat.size,
        modified: itemStat.mtime,
        path: path.relative(workspaceRoot, fullPath),
      });
    } catch {
      // Ignore files that cannot be stated (e.g. broken symlinks or permission locks)
    }
  }

  // Sort directories first, then alphabetical
  entries.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  return {
    success: true,
    message: `Found ${entries.length} items in "${check.relativePath || "."}"`,
    data: entries,
  };
}

/**
 * Create a directory (and parents) safely inside workspace.
 */
export async function createDirectory(
  workspaceRoot: string,
  dirPath: string,
): Promise<FileSystemResult> {
  const check = validateWorkspacePath(dirPath, workspaceRoot);
  if (!check.isValid) {
    throw new Error(check.error);
  }

  if (fs.existsSync(check.resolvedPath)) {
    return {
      success: true,
      message: `Directory already exists: "${check.relativePath}"`,
    };
  }

  fs.mkdirSync(check.resolvedPath, { recursive: true });

  return {
    success: true,
    message: `Created directory "${check.relativePath}"`,
  };
}

/**
 * Create a file with content inside workspace.
 */
export async function createFile(
  workspaceRoot: string,
  filePath: string,
  content: string,
  overwrite: boolean = false,
): Promise<FileSystemResult> {
  const check = validateWorkspacePath(filePath, workspaceRoot);
  if (!check.isValid) {
    throw new Error(check.error);
  }

  if (isProtectedPath(filePath, workspaceRoot)) {
    throw new Error(
      `Cannot create or overwrite protected file: "${check.relativePath}"`,
    );
  }

  if (fs.existsSync(check.resolvedPath) && !overwrite) {
    throw new Error(
      `File already exists: "${check.relativePath}". Use overwrite option if intended.`,
    );
  }

  // Ensure parent directory exists
  const parentDir = path.dirname(check.resolvedPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  fs.writeFileSync(check.resolvedPath, content, "utf-8");

  return {
    success: true,
    message: `Successfully created file "${check.relativePath}" (${content.length} bytes)`,
  };
}

/**
 * Read text content from a file inside workspace.
 */
export async function readFile(
  workspaceRoot: string,
  filePath: string,
  maxLines: number = 200,
): Promise<FileSystemResult> {
  const check = validateWorkspacePath(filePath, workspaceRoot);
  if (!check.isValid) {
    throw new Error(check.error);
  }

  if (isProtectedPath(filePath, workspaceRoot)) {
    throw new Error(
      `Access to protected file is denied: "${check.relativePath}"`,
    );
  }

  if (!fs.existsSync(check.resolvedPath)) {
    throw new Error(`File not found: "${check.relativePath}"`);
  }

  const stat = fs.statSync(check.resolvedPath);
  if (stat.isDirectory()) {
    throw new Error(
      `Cannot read directory as text file: "${check.relativePath}"`,
    );
  }

  const content = fs.readFileSync(check.resolvedPath, "utf-8");
  const lines = content.split(/\r?\n/);
  const truncated = lines.slice(0, maxLines);
  const output = truncated.join("\n");

  return {
    success: true,
    message: `Read ${truncated.length} of ${lines.length} lines from "${check.relativePath}"`,
    data: output,
  };
}

/**
 * Move a file or directory within workspace.
 */
export async function movePath(
  workspaceRoot: string,
  source: string,
  destination: string,
): Promise<FileSystemResult> {
  const srcCheck = validateWorkspacePath(source, workspaceRoot);
  const dstCheck = validateWorkspacePath(destination, workspaceRoot);

  if (!srcCheck.isValid) throw new Error(srcCheck.error);
  if (!dstCheck.isValid) throw new Error(dstCheck.error);

  if (
    isProtectedPath(source, workspaceRoot) ||
    isProtectedPath(destination, workspaceRoot)
  ) {
    throw new Error("Cannot move protected paths");
  }

  if (!fs.existsSync(srcCheck.resolvedPath)) {
    throw new Error(`Source not found: "${srcCheck.relativePath}"`);
  }

  let finalDestination = dstCheck.resolvedPath;
  if (
    fs.existsSync(dstCheck.resolvedPath) &&
    fs.statSync(dstCheck.resolvedPath).isDirectory()
  ) {
    finalDestination = path.join(
      dstCheck.resolvedPath,
      path.basename(srcCheck.resolvedPath),
    );
  }

  // Ensure parent of destination exists
  const parent = path.dirname(finalDestination);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }

  fs.renameSync(srcCheck.resolvedPath, finalDestination);

  return {
    success: true,
    message: `Moved "${srcCheck.relativePath}" to "${path.relative(workspaceRoot, finalDestination)}"`,
  };
}

/**
 * Rename a file or directory within workspace.
 */
export async function renamePath(
  workspaceRoot: string,
  source: string,
  destination: string,
): Promise<FileSystemResult> {
  return movePath(workspaceRoot, source, destination);
}

/**
 * Copy a file or directory within workspace.
 */
export async function copyPath(
  workspaceRoot: string,
  source: string,
  destination: string,
): Promise<FileSystemResult> {
  const srcCheck = validateWorkspacePath(source, workspaceRoot);
  const dstCheck = validateWorkspacePath(destination, workspaceRoot);

  if (!srcCheck.isValid) throw new Error(srcCheck.error);
  if (!dstCheck.isValid) throw new Error(dstCheck.error);

  if (
    isProtectedPath(source, workspaceRoot) ||
    isProtectedPath(destination, workspaceRoot)
  ) {
    throw new Error("Cannot copy to or from protected paths");
  }

  if (!fs.existsSync(srcCheck.resolvedPath)) {
    throw new Error(`Source not found: "${srcCheck.relativePath}"`);
  }

  const stat = fs.statSync(srcCheck.resolvedPath);
  if (stat.isDirectory()) {
    fs.cpSync(srcCheck.resolvedPath, dstCheck.resolvedPath, {
      recursive: true,
    });
  } else {
    const parent = path.dirname(dstCheck.resolvedPath);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.copyFileSync(srcCheck.resolvedPath, dstCheck.resolvedPath);
  }

  return {
    success: true,
    message: `Copied "${srcCheck.relativePath}" to "${dstCheck.relativePath}"`,
  };
}

/**
 * Delete a file with strong safeguards.
 */
export async function deleteFile(
  workspaceRoot: string,
  filePath: string,
): Promise<FileSystemResult> {
  const check = validateWorkspacePath(filePath, workspaceRoot);
  if (!check.isValid) {
    throw new Error(check.error);
  }

  if (isProtectedPath(filePath, workspaceRoot)) {
    throw new Error(
      `Deleting protected path is forbidden: "${check.relativePath}"`,
    );
  }

  if (!fs.existsSync(check.resolvedPath)) {
    throw new Error(`File not found: "${check.relativePath}"`);
  }

  const stat = fs.statSync(check.resolvedPath);
  if (stat.isDirectory()) {
    throw new Error(
      `"${check.relativePath}" is a directory. Uncontrolled recursive deletion of directories is restricted for security.`,
    );
  }

  fs.unlinkSync(check.resolvedPath);

  return {
    success: true,
    message: `Deleted file "${check.relativePath}"`,
  };
}

/**
 * Search for files matching a wildcard or regex pattern.
 */
export async function searchFiles(
  workspaceRoot: string,
  searchDir: string = ".",
  pattern: string,
): Promise<FileSystemResult> {
  const check = validateWorkspacePath(searchDir, workspaceRoot);
  if (!check.isValid) throw new Error(check.error);

  const results: string[] = [];
  const regexPattern = new RegExp(
    pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, "."),
    "i",
  );

  function walk(currentDir: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === ".git" ||
        entry.name === "node_modules" ||
        entry.name === "dist"
      ) {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (regexPattern.test(entry.name)) {
        results.push(path.relative(workspaceRoot, fullPath));
      }
      if (entry.isDirectory()) {
        walk(fullPath);
      }
    }
  }

  if (fs.existsSync(check.resolvedPath)) {
    walk(check.resolvedPath);
  }

  return {
    success: true,
    message: `Found ${results.length} files matching "${pattern}"`,
    data: results,
  };
}

/**
 * Search file contents for a text query.
 */
export async function searchContent(
  workspaceRoot: string,
  searchDir: string = ".",
  query: string,
  extension?: string,
): Promise<FileSystemResult> {
  const check = validateWorkspacePath(searchDir, workspaceRoot);
  if (!check.isValid) throw new Error(check.error);

  interface MatchItem {
    file: string;
    line: number;
    text: string;
  }

  const matches: MatchItem[] = [];

  function walk(currentDir: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === ".git" ||
        entry.name === "node_modules" ||
        entry.name === "dist"
      ) {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (extension && !entry.name.endsWith(extension)) {
          continue;
        }
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const lines = content.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(query)) {
              matches.push({
                file: path.relative(workspaceRoot, fullPath),
                line: i + 1,
                text: lines[i].trim(),
              });
              if (matches.length >= 100) return; // Cap results for safety
            }
          }
        } catch {
          // Skip binary or unreadable files
        }
      }
    }
  }

  if (fs.existsSync(check.resolvedPath)) {
    walk(check.resolvedPath);
  }

  return {
    success: true,
    message: `Found ${matches.length} occurrences of "${query}"`,
    data: matches,
  };
}
