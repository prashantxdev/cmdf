import type { Action, ActionType, RiskLevel } from "../ai/types.js";
import * as fsActions from "./filesystem.js";
import * as gitActions from "./git.js";
import * as shellActions from "./shell.js";

export interface ActionMetadata {
  type: ActionType;
  category: "filesystem" | "git" | "package" | "shell";
  defaultRisk: RiskLevel;
  description: string;
}

export const ACTION_METADATA_MAP: Record<ActionType, ActionMetadata> = {
  list_files: {
    type: "list_files",
    category: "filesystem",
    defaultRisk: "read-only",
    description: "List directory contents",
  },
  create_directory: {
    type: "create_directory",
    category: "filesystem",
    defaultRisk: "modifying",
    description: "Create directory",
  },
  create_file: {
    type: "create_file",
    category: "filesystem",
    defaultRisk: "modifying",
    description: "Create text file",
  },
  read_file: {
    type: "read_file",
    category: "filesystem",
    defaultRisk: "read-only",
    description: "Read file contents",
  },
  move: {
    type: "move",
    category: "filesystem",
    defaultRisk: "modifying",
    description: "Move file or directory",
  },
  rename: {
    type: "rename",
    category: "filesystem",
    defaultRisk: "modifying",
    description: "Rename file or directory",
  },
  copy: {
    type: "copy",
    category: "filesystem",
    defaultRisk: "modifying",
    description: "Copy file or directory",
  },
  delete_file: {
    type: "delete_file",
    category: "filesystem",
    defaultRisk: "destructive",
    description: "Delete file with safeguards",
  },
  search_files: {
    type: "search_files",
    category: "filesystem",
    defaultRisk: "read-only",
    description: "Search filenames by pattern",
  },
  search_content: {
    type: "search_content",
    category: "filesystem",
    defaultRisk: "read-only",
    description: "Search text content in files",
  },
  git_init: {
    type: "git_init",
    category: "git",
    defaultRisk: "modifying",
    description: "Initialize Git repository",
  },
  git_status: {
    type: "git_status",
    category: "git",
    defaultRisk: "read-only",
    description: "Show Git status",
  },
  git_log: {
    type: "git_log",
    category: "git",
    defaultRisk: "read-only",
    description: "Show Git commit history",
  },
  npm_install: {
    type: "npm_install",
    category: "package",
    defaultRisk: "modifying",
    description: "Install npm packages",
  },
  npm_run: {
    type: "npm_run",
    category: "package",
    defaultRisk: "modifying",
    description: "Run project npm script",
  },
  shell_command: {
    type: "shell_command",
    category: "shell",
    defaultRisk: "modifying",
    description: "Execute approved shell command",
  },
};

export async function executeAction(
  action: Action,
  workspaceRoot: string,
): Promise<unknown> {
  switch (action.type) {
    case "list_files":
      return fsActions.listFiles(
        workspaceRoot,
        action.path,
        action.includeHidden,
      );
    case "create_directory":
      return fsActions.createDirectory(workspaceRoot, action.path);
    case "create_file":
      return fsActions.createFile(
        workspaceRoot,
        action.path,
        action.content || "",
        action.overwrite,
      );
    case "read_file":
      return fsActions.readFile(workspaceRoot, action.path, action.maxLines);
    case "move":
      return fsActions.movePath(
        workspaceRoot,
        action.source,
        action.destination,
      );
    case "rename":
      return fsActions.renamePath(
        workspaceRoot,
        action.source,
        action.destination,
      );
    case "copy":
      return fsActions.copyPath(
        workspaceRoot,
        action.source,
        action.destination,
      );
    case "delete_file":
      return fsActions.deleteFile(workspaceRoot, action.path);
    case "search_files":
      return fsActions.searchFiles(workspaceRoot, action.path, action.pattern);
    case "search_content":
      return fsActions.searchContent(
        workspaceRoot,
        action.path,
        action.query,
        action.extension,
      );
    case "git_init":
      return gitActions.gitInit(workspaceRoot, action.path);
    case "git_status":
      return gitActions.gitStatus(workspaceRoot, action.path);
    case "git_log":
      return gitActions.gitLog(workspaceRoot, action.path, action.count);
    case "npm_install":
      return shellActions.runNpmInstall(
        workspaceRoot,
        action.packages,
        action.dev,
      );
    case "npm_run":
      return shellActions.runNpmScript(workspaceRoot, action.script);
    case "shell_command":
      return shellActions.runValidatedShellCommand(
        action.command,
        workspaceRoot,
      );
    default: {
      const exhaustiveCheck: never = action;
      throw new Error(
        `Unsupported action type: ${(exhaustiveCheck as { type: string }).type}`,
      );
    }
  }
}
