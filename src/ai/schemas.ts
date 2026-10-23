import { z } from "zod";

export const RiskLevelSchema = z.enum([
  "read-only",
  "modifying",
  "destructive",
]);

export const ListFilesActionSchema = z.object({
  type: z.literal("list_files"),
  description: z.string(),
  path: z.string().default("."),
  includeHidden: z.boolean().optional().default(false),
});

export const CreateDirectoryActionSchema = z.object({
  type: z.literal("create_directory"),
  description: z.string(),
  path: z.string(),
});

export const CreateFileActionSchema = z.object({
  type: z.literal("create_file"),
  description: z.string(),
  path: z.string(),
  content: z.string(),
  overwrite: z.boolean().optional().default(false),
});

export const ReadFileActionSchema = z.object({
  type: z.literal("read_file"),
  description: z.string(),
  path: z.string(),
  maxLines: z.number().optional().default(200),
});

export const MoveActionSchema = z.object({
  type: z.literal("move"),
  description: z.string(),
  source: z.string(),
  destination: z.string(),
});

export const RenameActionSchema = z.object({
  type: z.literal("rename"),
  description: z.string(),
  source: z.string(),
  destination: z.string(),
});

export const CopyActionSchema = z.object({
  type: z.literal("copy"),
  description: z.string(),
  source: z.string(),
  destination: z.string(),
});

export const DeleteFileActionSchema = z.object({
  type: z.literal("delete_file"),
  description: z.string(),
  path: z.string(),
});

export const SearchFilesActionSchema = z.object({
  type: z.literal("search_files"),
  description: z.string(),
  path: z.string().default("."),
  pattern: z.string(),
});

export const SearchContentActionSchema = z.object({
  type: z.literal("search_content"),
  description: z.string(),
  path: z.string().default("."),
  query: z.string(),
  extension: z.string().optional(),
});

export const GitInitActionSchema = z.object({
  type: z.literal("git_init"),
  description: z.string(),
  path: z.string().default("."),
});

export const GitStatusActionSchema = z.object({
  type: z.literal("git_status"),
  description: z.string(),
  path: z.string().default("."),
});

export const GitLogActionSchema = z.object({
  type: z.literal("git_log"),
  description: z.string(),
  path: z.string().default("."),
  count: z.number().optional().default(5),
});

export const NpmInstallActionSchema = z.object({
  type: z.literal("npm_install"),
  description: z.string(),
  packages: z.array(z.string()),
  dev: z.boolean().optional().default(false),
});

export const NpmRunActionSchema = z.object({
  type: z.literal("npm_run"),
  description: z.string(),
  script: z.string(),
});

export const ShellCommandActionSchema = z.object({
  type: z.literal("shell_command"),
  description: z.string(),
  command: z.string(),
  explanation: z.string(),
});

export const ActionSchema = z.discriminatedUnion("type", [
  ListFilesActionSchema,
  CreateDirectoryActionSchema,
  CreateFileActionSchema,
  ReadFileActionSchema,
  MoveActionSchema,
  RenameActionSchema,
  CopyActionSchema,
  DeleteFileActionSchema,
  SearchFilesActionSchema,
  SearchContentActionSchema,
  GitInitActionSchema,
  GitStatusActionSchema,
  GitLogActionSchema,
  NpmInstallActionSchema,
  NpmRunActionSchema,
  ShellCommandActionSchema,
]);

export const PlanStepSchema = z.object({
  id: z.number(),
  action: ActionSchema,
  risk: RiskLevelSchema,
  explanation: z.string(),
  affectsData: z.boolean(),
  targetPaths: z.array(z.string()).default([]),
});

export const ActionPlanSchema = z.object({
  intent: z.string(),
  assumptions: z.array(z.string()).default([]),
  steps: z.array(PlanStepSchema),
  overallRisk: RiskLevelSchema,
  summary: z.string(),
  requiresClarification: z.boolean().optional().default(false),
  clarificationQuestion: z.string().optional(),
});
