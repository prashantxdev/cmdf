export type ActionType =
  | "list_files"
  | "create_directory"
  | "create_file"
  | "read_file"
  | "move"
  | "rename"
  | "copy"
  | "delete_file"
  | "search_files"
  | "search_content"
  | "git_init"
  | "git_status"
  | "git_log"
  | "npm_install"
  | "npm_run"
  | "shell_command";

export type RiskLevel = "read-only" | "modifying" | "destructive";

export interface BaseAction {
  type: ActionType;
  description: string;
}

export interface ListFilesAction extends BaseAction {
  type: "list_files";
  path: string;
  includeHidden?: boolean;
}

export interface CreateDirectoryAction extends BaseAction {
  type: "create_directory";
  path: string;
}

export interface CreateFileAction extends BaseAction {
  type: "create_file";
  path: string;
  content: string;
  overwrite?: boolean;
}

export interface ReadFileAction extends BaseAction {
  type: "read_file";
  path: string;
  maxLines?: number;
}

export interface MoveAction extends BaseAction {
  type: "move";
  source: string;
  destination: string;
}

export interface RenameAction extends BaseAction {
  type: "rename";
  source: string;
  destination: string;
}

export interface CopyAction extends BaseAction {
  type: "copy";
  source: string;
  destination: string;
}

export interface DeleteFileAction extends BaseAction {
  type: "delete_file";
  path: string;
}

export interface SearchFilesAction extends BaseAction {
  type: "search_files";
  path: string;
  pattern: string;
}

export interface SearchContentAction extends BaseAction {
  type: "search_content";
  path: string;
  query: string;
  extension?: string;
}

export interface GitInitAction extends BaseAction {
  type: "git_init";
  path: string;
}

export interface GitStatusAction extends BaseAction {
  type: "git_status";
  path: string;
}

export interface GitLogAction extends BaseAction {
  type: "git_log";
  path: string;
  count?: number;
}

export interface NpmInstallAction extends BaseAction {
  type: "npm_install";
  packages: string[];
  dev?: boolean;
}

export interface NpmRunAction extends BaseAction {
  type: "npm_run";
  script: string;
}

export interface ShellCommandAction extends BaseAction {
  type: "shell_command";
  command: string;
  explanation: string;
}

export type Action =
  | ListFilesAction
  | CreateDirectoryAction
  | CreateFileAction
  | ReadFileAction
  | MoveAction
  | RenameAction
  | CopyAction
  | DeleteFileAction
  | SearchFilesAction
  | SearchContentAction
  | GitInitAction
  | GitStatusAction
  | GitLogAction
  | NpmInstallAction
  | NpmRunAction
  | ShellCommandAction;

export interface PlanStep {
  id: number;
  action: Action;
  risk: RiskLevel;
  explanation: string;
  affectsData: boolean;
  targetPaths: string[];
}

export interface ActionPlan {
  intent: string;
  assumptions: string[];
  steps: PlanStep[];
  overallRisk: RiskLevel;
  summary: string;
  requiresClarification?: boolean;
  clarificationQuestion?: string;
}

export interface AIPlanningContext {
  os: string;
  shell: string;
  workspace: string;
  filesInWorkspace?: string[];
  recentHistory?: string[];
}
