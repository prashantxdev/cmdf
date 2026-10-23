import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import dotenv from "dotenv";
import type { CmdfConfig, PartialCmdfConfig } from "./types.js";

// Load .env from current working directory
dotenv.config();

const CONFIG_DIR_NAME = ".cmdf";
const CONFIG_FILE_NAME = "config.json";

export function getConfigDir(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

export function getConfigFilePath(): string {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

// Also check for a user-level ~/.cmdf/.env if not found in cwd
const userEnvPath = path.join(getConfigDir(), ".env");
if (!process.env.GEMINI_API_KEY && fs.existsSync(userEnvPath)) {
  dotenv.config({ path: userEnvPath });
}

function parseTimeoutMs(val?: string, defaultVal: number = 45000): number {
  if (!val) return defaultVal;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) || parsed < 5000 ? defaultVal : parsed;
}

function sanitizeString(val?: string): string | undefined {
  if (!val) return undefined;
  const trimmed = val.trim();
  // Strip surrounding single or double quotes
  return trimmed.replace(/^['"]|['"]$/g, "");
}

export function getDefaultConfig(): CmdfConfig {
  const timeoutFromEnv =
    process.env.CMDF_TIMEOUT_MS || process.env.GEMINI_TIMEOUT_MS;

  return {
    workspace:
      sanitizeString(process.env.CMDF_WORKSPACE) ||
      sanitizeString(process.env.ASKTERM_WORKSPACE) ||
      process.cwd(),
    provider: (process.env.CMDF_PROVIDER as "gemini" | "mock") || "gemini",
    model: sanitizeString(process.env.GEMINI_MODEL) || "gemini-3.8-flash",
    shell: undefined,
    timeoutMs: parseTimeoutMs(timeoutFromEnv, 45000),
    outputFormat: "text",
    historyLimit: 100,
    autoApproveReadOnly: false,
    geminiApiKey: sanitizeString(process.env.GEMINI_API_KEY),
  };
}

export function loadUserConfig(): PartialCmdfConfig {
  const filePath = getConfigFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as PartialCmdfConfig;
    }
  } catch {
    // Gracefully ignore corrupt or missing config
  }
  return {};
}

export function saveUserConfig(updates: PartialCmdfConfig): void {
  const dir = getConfigDir();
  const filePath = getConfigFilePath();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const current = loadUserConfig();
  const merged = { ...current, ...updates };
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), "utf-8");
}

export function getResolvedConfig(
  overrides: PartialCmdfConfig = {},
): CmdfConfig {
  const defaults = getDefaultConfig();
  const userConfig = loadUserConfig();

  // Strip undefined values from overrides so they do not overwrite defaults
  const cleanedOverrides: PartialCmdfConfig = {};
  for (const [key, val] of Object.entries(overrides)) {
    if (val !== undefined) {
      (cleanedOverrides as Record<string, unknown>)[key] = val;
    }
  }

  const resolved: CmdfConfig = {
    ...defaults,
    ...userConfig,
    ...cleanedOverrides,
  };

  // Environment variables take precedence for API keys, model, workspace, and timeout
  if (process.env.GEMINI_API_KEY) {
    resolved.geminiApiKey = sanitizeString(process.env.GEMINI_API_KEY);
  }
  if (process.env.GEMINI_MODEL) {
    resolved.model = sanitizeString(process.env.GEMINI_MODEL) || resolved.model;
  }
  if (process.env.CMDF_WORKSPACE || process.env.ASKTERM_WORKSPACE) {
    resolved.workspace =
      sanitizeString(
        process.env.CMDF_WORKSPACE || process.env.ASKTERM_WORKSPACE,
      ) || resolved.workspace;
  }
  if (process.env.CMDF_TIMEOUT_MS || process.env.GEMINI_TIMEOUT_MS) {
    resolved.timeoutMs = parseTimeoutMs(
      process.env.CMDF_TIMEOUT_MS || process.env.GEMINI_TIMEOUT_MS,
      resolved.timeoutMs,
    );
  }

  // Normalize workspace path
  resolved.workspace = path.resolve(resolved.workspace);

  return resolved;
}
