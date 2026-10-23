import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import dotenv from "dotenv";
import type { CmdfConfig, PartialCmdfConfig } from "./types.js";

dotenv.config();

const CONFIG_DIR_NAME = ".cmdf";
const CONFIG_FILE_NAME = "config.json";

export function getConfigDir(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

export function getConfigFilePath(): string {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

export function getDefaultConfig(): CmdfConfig {
  return {
    workspace:
      process.env.CMDF_WORKSPACE ||
      process.env.ASKTERM_WORKSPACE ||
      process.cwd(),
    provider: (process.env.CMDF_PROVIDER as "gemini" | "mock") || "gemini",
    model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
    shell: undefined,
    timeoutMs: 30000,
    outputFormat: "text",
    historyLimit: 100,
    autoApproveReadOnly: false,
    geminiApiKey: process.env.GEMINI_API_KEY,
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
  // Never save API keys to config.json directly if we want to encourage .env usage,
  // but if explicitly requested, can save non-secret preferences.
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

  // Environment variables always override file config for API keys
  if (process.env.GEMINI_API_KEY) {
    resolved.geminiApiKey = process.env.GEMINI_API_KEY;
  }
  if (process.env.GEMINI_MODEL) {
    resolved.model = process.env.GEMINI_MODEL;
  }
  if (process.env.CMDF_WORKSPACE || process.env.ASKTERM_WORKSPACE) {
    resolved.workspace =
      process.env.CMDF_WORKSPACE ||
      process.env.ASKTERM_WORKSPACE ||
      resolved.workspace;
  }

  // Normalize workspace path
  resolved.workspace = path.resolve(resolved.workspace);

  return resolved;
}
