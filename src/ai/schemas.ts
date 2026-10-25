import { z } from "zod";

export const RiskLevelSchema = z.enum([
  "read-only",
  "modifying",
  "destructive",
]);

export const ListFilesActionSchema = z.object({
  type: z.literal("list_files"),
  description: z
    .string()
    .nullish()
    .transform((val) => val ?? "")
    .default(""),
  path: z
    .string()
    .nullish()
    .transform((val) => (val && val.trim() ? val.trim() : "."))
    .default("."),
  includeHidden: z
    .boolean()
    .nullish()
    .transform((val) => Boolean(val))
    .default(false),
});

export const CreateDirectoryActionSchema = z.object({
  type: z.literal("create_directory"),
  description: z
    .string()
    .nullish()
    .transform((val) => val ?? "")
    .default(""),
  path: z.string(),
});

export const CreateFileActionSchema = z.object({
  type: z.literal("create_file"),
  description: z
    .string()
    .nullish()
    .transform((val) => val ?? "")
    .default(""),
  path: z.string(),
  content: z
    .string()
    .nullish()
    .transform((val) => val ?? "")
    .default(""),
  overwrite: z
    .boolean()
    .nullish()
    .transform((val) => Boolean(val))
    .default(false),
});

export const ReadFileActionSchema = z.object({
  type: z.literal("read_file"),
  description: z
    .string()
    .nullish()
    .transform((val) => val ?? "")
    .default(""),
  path: z.string(),
  maxLines: z
    .number()
    .nullish()
    .transform((val) => val ?? 200)
    .default(200),
});

export const MoveActionSchema = z.object({
  type: z.literal("move"),
  description: z
    .string()
    .nullish()
    .transform((val) => val ?? "")
    .default(""),
  source: z.string(),
  destination: z.string(),
});

export const RenameActionSchema = z.object({
  type: z.literal("rename"),
  description: z
    .string()
    .nullish()
    .transform((val) => val ?? "")
    .default(""),
  source: z.string(),
  destination: z.string(),
});

export const CopyActionSchema = z.object({
  type: z.literal("copy"),
  description: z
    .string()
    .nullish()
    .transform((val) => val ?? "")
    .default(""),
  source: z.string(),
  destination: z.string(),
});

export const DeleteFileActionSchema = z.object({
  type: z.literal("delete_file"),
  description: z
    .string()
    .nullish()
    .transform((val) => val ?? "")
    .default(""),
  path: z.string(),
});

export const SearchFilesActionSchema = z.object({
  type: z.literal("search_files"),
  description: z
    .string()
    .nullish()
    .transform((val) => val ?? "")
    .default(""),
  path: z
    .string()
    .nullish()
    .transform((val) => (val && val.trim() ? val.trim() : "."))
    .default("."),
  pattern: z.string(),
});

export const SearchContentActionSchema = z.object({
  type: z.literal("search_content"),
  description: z
    .string()
    .nullish()
    .transform((val) => val ?? "")
    .default(""),
  path: z
    .string()
    .nullish()
    .transform((val) => (val && val.trim() ? val.trim() : "."))
    .default("."),
  query: z.string(),
  extension: z
    .string()
    .nullish()
    .transform((val) => (val && val.trim() ? val.trim() : undefined)),
});

export const GitInitActionSchema = z.object({
  type: z.literal("git_init"),
  description: z
    .string()
    .nullish()
    .transform((val) => val ?? "")
    .default(""),
  path: z
    .string()
    .nullish()
    .transform((val) => (val && val.trim() ? val.trim() : "."))
    .default("."),
});

export const GitStatusActionSchema = z.object({
  type: z.literal("git_status"),
  description: z
    .string()
    .nullish()
    .transform((val) => val ?? "")
    .default(""),
  path: z
    .string()
    .nullish()
    .transform((val) => (val && val.trim() ? val.trim() : "."))
    .default("."),
});

export const GitLogActionSchema = z.object({
  type: z.literal("git_log"),
  description: z
    .string()
    .nullish()
    .transform((val) => val ?? "")
    .default(""),
  path: z
    .string()
    .nullish()
    .transform((val) => (val && val.trim() ? val.trim() : "."))
    .default("."),
  count: z
    .number()
    .nullish()
    .transform((val) => val ?? 5)
    .default(5),
});

export const NpmInstallActionSchema = z.object({
  type: z.literal("npm_install"),
  description: z
    .string()
    .nullish()
    .transform((val) => val ?? "")
    .default(""),
  packages: z
    .array(z.string())
    .nullish()
    .transform((val) => val ?? [])
    .default([]),
  dev: z
    .boolean()
    .nullish()
    .transform((val) => Boolean(val))
    .default(false),
});

export const NpmRunActionSchema = z.object({
  type: z.literal("npm_run"),
  description: z
    .string()
    .nullish()
    .transform((val) => val ?? "")
    .default(""),
  script: z.string(),
});

export const ShellCommandActionSchema = z.object({
  type: z.literal("shell_command"),
  description: z
    .string()
    .nullish()
    .transform((val) => val ?? "")
    .default(""),
  command: z.string(),
  explanation: z
    .string()
    .nullish()
    .transform((val) => val ?? "")
    .default(""),
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
  explanation: z
    .string()
    .nullish()
    .transform((val) => val ?? "")
    .default(""),
  affectsData: z
    .boolean()
    .nullish()
    .transform((val) => Boolean(val))
    .default(false),
  targetPaths: z
    .array(z.string())
    .nullish()
    .transform((val) => val ?? [])
    .default([]),
});

export const ActionPlanSchema = z
  .object({
    intent: z.string(),
    assumptions: z
      .array(z.string())
      .nullish()
      .transform((val) => val ?? [])
      .default([]),
    steps: z.array(PlanStepSchema),
    overallRisk: RiskLevelSchema,
    summary: z.string(),
    requiresClarification: z
      .boolean()
      .nullish()
      .transform((val) => Boolean(val))
      .default(false),
    clarificationQuestion: z
      .string()
      .nullable()
      .optional()
      .transform((val) => (val && val.trim().length > 0 ? val.trim() : null))
      .default(null),
  })
  .refine(
    (data) => {
      if (data.requiresClarification) {
        return (
          typeof data.clarificationQuestion === "string" &&
          data.clarificationQuestion.trim().length > 0
        );
      }
      return true;
    },
    {
      message:
        "A non-empty clarificationQuestion is required when requiresClarification is true",
      path: ["clarificationQuestion"],
    },
  );
