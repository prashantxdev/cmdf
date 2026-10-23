import path from "node:path";
import fs from "node:fs";

export interface PathValidationResult {
  isValid: boolean;
  resolvedPath: string;
  relativePath: string;
  error?: string;
}

/**
 * Validates that a target path resides strictly inside the configured workspace.
 * Prevents path traversal, drive jumping, and symlink escapes.
 */
export function validateWorkspacePath(
  targetPath: string,
  workspaceRoot: string,
): PathValidationResult {
  if (!targetPath || typeof targetPath !== "string") {
    return {
      isValid: false,
      resolvedPath: "",
      relativePath: "",
      error: "Path must be a non-empty string",
    };
  }

  const normalizedWorkspace = path.resolve(workspaceRoot);

  // If path is absolute or relative, resolve against workspaceRoot
  const resolved = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(normalizedWorkspace, targetPath);

  // Cross-platform check: case-insensitivity on Windows
  const isWindows = process.platform === "win32";
  const normResolved = isWindows ? resolved.toLowerCase() : resolved;
  const normWorkspace = isWindows
    ? normalizedWorkspace.toLowerCase()
    : normalizedWorkspace;

  // The resolved path must be the workspace root or inside the workspace folder
  const isInside =
    normResolved === normWorkspace ||
    normResolved.startsWith(
      normWorkspace.endsWith(path.sep)
        ? normWorkspace
        : normWorkspace + path.sep,
    );

  if (!isInside) {
    return {
      isValid: false,
      resolvedPath: resolved,
      relativePath: path.relative(normalizedWorkspace, resolved),
      error: `Path "${targetPath}" resolves to "${resolved}", which is outside the approved workspace "${normalizedWorkspace}"`,
    };
  }

  // Symlink escape validation: verify that real paths do not escape workspace
  try {
    if (fs.existsSync(resolved)) {
      const realResolved = fs.realpathSync(resolved);
      const realWorkspace = fs.realpathSync(normalizedWorkspace);
      const normRealResolved = isWindows
        ? realResolved.toLowerCase()
        : realResolved;
      const normRealWorkspace = isWindows
        ? realWorkspace.toLowerCase()
        : realWorkspace;

      const realIsInside =
        normRealResolved === normRealWorkspace ||
        normRealResolved.startsWith(
          normRealWorkspace.endsWith(path.sep)
            ? normRealWorkspace
            : normRealWorkspace + path.sep,
        );

      if (!realIsInside) {
        return {
          isValid: false,
          resolvedPath: resolved,
          relativePath: path.relative(normalizedWorkspace, resolved),
          error: `Symlink target "${realResolved}" escapes the workspace boundary`,
        };
      }
    }
  } catch {
    // If realpath fails on non-existent paths, that's fine for creation actions
    // but check parent directory if it exists
    let currentDir = path.dirname(resolved);
    while (currentDir && currentDir !== path.dirname(currentDir)) {
      if (fs.existsSync(currentDir)) {
        try {
          const realCurrent = fs.realpathSync(currentDir);
          const realWorkspace = fs.realpathSync(normalizedWorkspace);
          const normRealCurrent = isWindows
            ? realCurrent.toLowerCase()
            : realCurrent;
          const normRealWorkspace = isWindows
            ? realWorkspace.toLowerCase()
            : realWorkspace;

          const parentIsInside =
            normRealCurrent === normRealWorkspace ||
            normRealCurrent.startsWith(
              normRealWorkspace.endsWith(path.sep)
                ? normRealWorkspace
                : normRealWorkspace + path.sep,
            );

          if (!parentIsInside) {
            return {
              isValid: false,
              resolvedPath: resolved,
              relativePath: path.relative(normalizedWorkspace, resolved),
              error: `Ancestor directory "${currentDir}" resolves via symlink to outside the workspace`,
            };
          }
        } catch {
          // Ignore intermediate lookup errors
        }
        break;
      }
      currentDir = path.dirname(currentDir);
    }
  }

  const relative = path.relative(normalizedWorkspace, resolved) || ".";

  return {
    isValid: true,
    resolvedPath: resolved,
    relativePath: relative,
  };
}

/**
 * Checks if a path is considered a sensitive or protected location.
 */
export function isProtectedPath(
  targetPath: string,
  workspaceRoot: string,
): boolean {
  const { relativePath } = validateWorkspacePath(targetPath, workspaceRoot);
  const normalized = relativePath.replace(/\\/g, "/");

  // Protect sensitive files and folders
  if (
    normalized === ".git" ||
    normalized.startsWith(".git/") ||
    normalized === ".env" ||
    normalized.endsWith("/.env") ||
    normalized === ".env.local" ||
    normalized.endsWith("/.env.local") ||
    normalized.endsWith(".pem") ||
    normalized.endsWith(".key") ||
    normalized === "id_rsa" ||
    normalized.endsWith("/id_rsa")
  ) {
    return true;
  }

  return false;
}
