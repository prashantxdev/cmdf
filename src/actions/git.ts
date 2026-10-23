import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateWorkspacePath } from "../security/path-guard.js";

const execFileAsync = promisify(execFile);

export interface GitActionResult {
  success: boolean;
  message: string;
  output: string;
}

/**
 * Initialize a git repository at the given path within workspace.
 */
export async function gitInit(
  workspaceRoot: string,
  targetPath: string = ".",
): Promise<GitActionResult> {
  const check = validateWorkspacePath(targetPath, workspaceRoot);
  if (!check.isValid) throw new Error(check.error);

  try {
    const { stdout, stderr } = await execFileAsync("git", ["init"], {
      cwd: check.resolvedPath,
      timeout: 10000,
    });
    return {
      success: true,
      message: "Initialized Git repository",
      output: (stdout || stderr).trim(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to initialize git repository: ${msg}`);
  }
}

/**
 * Get git status within workspace.
 */
export async function gitStatus(
  workspaceRoot: string,
  targetPath: string = ".",
): Promise<GitActionResult> {
  const check = validateWorkspacePath(targetPath, workspaceRoot);
  if (!check.isValid) throw new Error(check.error);

  try {
    const { stdout, stderr } = await execFileAsync(
      "git",
      ["status", "--short"],
      {
        cwd: check.resolvedPath,
        timeout: 10000,
      },
    );
    const output = (stdout || stderr).trim();
    return {
      success: true,
      message: output ? "Git status retrieved" : "Working tree clean",
      output: output || "Nothing to commit, working tree clean",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to get git status: ${msg}`);
  }
}

/**
 * Get recent git commits within workspace.
 */
export async function gitLog(
  workspaceRoot: string,
  targetPath: string = ".",
  count: number = 5,
): Promise<GitActionResult> {
  const check = validateWorkspacePath(targetPath, workspaceRoot);
  if (!check.isValid) throw new Error(check.error);

  try {
    const { stdout, stderr } = await execFileAsync(
      "git",
      ["log", `-${count}`, "--oneline", "--decorate"],
      {
        cwd: check.resolvedPath,
        timeout: 10000,
      },
    );
    return {
      success: true,
      message: `Retrieved last ${count} commits`,
      output: (stdout || stderr).trim(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to get git log: ${msg}`);
  }
}
