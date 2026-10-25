export type ApiKeySource =
  "environment" | "user_config" | "project_env" | "none";

export interface CmdfConfig {
  workspace: string;
  provider: "gemini" | "mock";
  model: string;
  shell?: string;
  timeoutMs: number;
  outputFormat: "text" | "json";
  historyLimit: number;
  autoApproveReadOnly: boolean;
  geminiApiKey?: string;
  apiKeySource?: ApiKeySource;
}

export type PartialCmdfConfig = Partial<CmdfConfig>;
