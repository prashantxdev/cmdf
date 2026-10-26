import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import dotenv from "dotenv";
import type { CmdfConfig, PartialCmdfConfig, ApiKeySource } from "./types.js";

const CONFIG_DIR_NAME = ".cmdf";
const CONFIG_FILE_NAME = "config.json";

/**
 * Loads project-local .env if present without polluting global process.env.
 */
export function loadProjectEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    try {
      const raw = fs.readFileSync(envPath, "utf-8");
      return dotenv.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

export function getConfigDir(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

export function getConfigFilePath(): string {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

export const DEFAULT_CONFIG = {
  model: "gemini-3.5-flash",
  timeoutMs: 60_000,
  provider: "gemini" as const,
  outputFormat: "text" as const,
  historyLimit: 100,
  autoApproveReadOnly: false,
};

export const MIN_TIMEOUT_MS = 1000;
export const MAX_TIMEOUT_MS = 600_000; // 10 minutes maximum

export function validateTimeoutMs(val: unknown): {
  valid: boolean;
  value?: number;
  error?: string;
} {
  if (val === undefined || val === null || val === "") {
    return { valid: false, error: "timeoutMs is required." };
  }
  const str = String(val).trim();
  if (!/^\d+$/.test(str)) {
    return {
      valid: false,
      error: `Invalid timeoutMs: "${str}" is not a positive integer.`,
    };
  }
  const num = parseInt(str, 10);
  if (num < MIN_TIMEOUT_MS || num > MAX_TIMEOUT_MS) {
    return {
      valid: false,
      error: `Invalid timeoutMs: Value must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} ms (got ${num}).`,
    };
  }
  return { valid: true, value: num };
}

export function parseTimeoutMs(
  val?: string | number,
  defaultVal: number = DEFAULT_CONFIG.timeoutMs,
): number {
  if (typeof val === "number") {
    return Number.isFinite(val) && val > 0 ? Math.floor(val) : defaultVal;
  }
  if (!val || typeof val !== "string") return defaultVal;
  const trimmed = val.trim();
  if (!/^\d+$/.test(trimmed)) return defaultVal;
  const parsed = parseInt(trimmed, 10);
  return parsed > 0 ? parsed : defaultVal;
}

export function sanitizeString(val?: string): string | undefined {
  if (!val) return undefined;
  const trimmed = val.trim();
  // Strip surrounding single or double quotes
  return trimmed.replace(/^['"]|['"]$/g, "");
}

/**
 * Masks an API key for safe terminal display.
 * Example: AQ.Ab8RN6Jl...0H1tM-_I5A -> AQ.A••••••••••••••••••••I5A
 */
export function maskApiKey(key?: string): string {
  if (!key || key.trim().length === 0) {
    return "(not configured)";
  }
  const clean = key.trim();
  if (clean.length < 10) {
    return "••••••••";
  }
  const prefix = clean.slice(0, 4);
  const suffix = clean.slice(-4);
  const maskLength = Math.max(6, Math.min(20, clean.length - 8));
  return `${prefix}${"•".repeat(maskLength)}${suffix}`;
}

/**
 * Checks file permissions on the user configuration file (~/.cmdf/config.json).
 * On Unix, checks for owner-only access (0600 / 0700).
 * On Windows, explains NTFS ACL behavior.
 */
export function checkConfigPermissions(): {
  isSecure: boolean;
  mode?: string;
  note: string;
} {
  const filePath = getConfigFilePath();
  if (!fs.existsSync(filePath)) {
    return {
      isSecure: true,
      note: "Configuration file does not exist yet.",
    };
  }

  if (process.platform === "win32") {
    return {
      isSecure: true,
      note: "Protected by Windows user profile NTFS Access Control Lists (ACLs). Only your Windows user account has access by default.",
    };
  }

  try {
    const stat = fs.statSync(filePath);
    const mode = (stat.mode & 0o777).toString(8);
    // Secure if group and other have no permissions (0600 or 0400)
    const isOwnerOnly = (stat.mode & 0o077) === 0;
    return {
      isSecure: isOwnerOnly,
      mode: `0${mode}`,
      note: isOwnerOnly
        ? `Permissions are secure (mode 0${mode}, owner-only access).`
        : `Warning: File permissions are 0${mode}. Recommended: chmod 600 ${filePath}`,
    };
  } catch {
    return {
      isSecure: true,
      note: "Unable to inspect file permissions.",
    };
  }
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

/**
 * Persists user configuration to ~/.cmdf/config.json with restrictive permissions (0600).
 */
export function saveUserConfig(updates: PartialCmdfConfig): void {
  const dir = getConfigDir();
  const filePath = getConfigFilePath();

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      if (process.platform !== "win32") {
        fs.chmodSync(dir, 0o700);
      }
    } catch {
      // Ignore on systems where chmod is unsupported
    }
  }

  const current = loadUserConfig();
  const merged = { ...current, ...updates };

  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });

  try {
    if (process.platform !== "win32") {
      fs.chmodSync(filePath, 0o600);
    }
  } catch {
    // Ignore on systems where chmod is unsupported
  }
}

/**
 * Securely stores the user's Gemini API key in ~/.cmdf/config.json with owner-only permissions.
 */
export function setStoredApiKey(key: string): void {
  const sanitized = sanitizeString(key);
  if (!sanitized || sanitized.length < 5) {
    throw new Error("Invalid Gemini API key: key must be a non-empty string.");
  }
  saveUserConfig({ geminiApiKey: sanitized });
}

/**
 * Removes the stored Gemini API key from ~/.cmdf/config.json.
 */
export function deleteStoredApiKey(): void {
  const current = loadUserConfig();
  delete current.geminiApiKey;
  const filePath = getConfigFilePath();
  if (fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(current, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
  }
}

/**
 * Resolves the active Gemini API key according to strict BYOK priority:
 * 1. Explicitly provided environment variable (GEMINI_API_KEY set in shell)
 * 2. Locally stored user configuration (~/.cmdf/config.json)
 * 3. Optional project-local .env file for development
 */
export function resolveApiKey(): {
  key: string | undefined;
  source: ApiKeySource;
} {
  // Priority 1: Explicitly provided environment variable in process environment
  if (
    process.env.GEMINI_API_KEY &&
    process.env.GEMINI_API_KEY.trim().length > 0
  ) {
    return {
      key: sanitizeString(process.env.GEMINI_API_KEY),
      source: "environment",
    };
  }

  // Priority 2: Locally stored user configuration key
  const userConfig = loadUserConfig();
  if (userConfig.geminiApiKey && userConfig.geminiApiKey.trim().length > 0) {
    return {
      key: sanitizeString(userConfig.geminiApiKey),
      source: "user_config",
    };
  }

  // Priority 3: Optional project-local .env file for development
  const projectEnv = loadProjectEnv();
  if (
    projectEnv.GEMINI_API_KEY &&
    projectEnv.GEMINI_API_KEY.trim().length > 0
  ) {
    return {
      key: sanitizeString(projectEnv.GEMINI_API_KEY),
      source: "project_env",
    };
  }

  return { key: undefined, source: "none" };
}

export function getDefaultConfig(): CmdfConfig {
  const { key: resolvedKey, source: resolvedSource } = resolveApiKey();
  const projectEnv = loadProjectEnv();
  const userConfig = loadUserConfig();

  const workspace =
    process.env.CMDF_WORKSPACE ||
    process.env.ASKTERM_WORKSPACE ||
    userConfig.workspace ||
    projectEnv.CMDF_WORKSPACE ||
    process.cwd();

  const model =
    process.env.GEMINI_MODEL ||
    userConfig.model ||
    projectEnv.GEMINI_MODEL ||
    DEFAULT_CONFIG.model;

  const timeoutMs = parseTimeoutMs(
    process.env.CMDF_TIMEOUT_MS ||
      process.env.GEMINI_TIMEOUT_MS ||
      userConfig.timeoutMs ||
      projectEnv.CMDF_TIMEOUT_MS ||
      projectEnv.GEMINI_TIMEOUT_MS,
    DEFAULT_CONFIG.timeoutMs,
  );

  return {
    workspace: path.resolve(sanitizeString(workspace) || process.cwd()),
    provider:
      (process.env.CMDF_PROVIDER as "gemini" | "mock") ||
      userConfig.provider ||
      DEFAULT_CONFIG.provider,
    model: sanitizeString(model) || DEFAULT_CONFIG.model,
    shell: undefined,
    timeoutMs,
    outputFormat: DEFAULT_CONFIG.outputFormat,
    historyLimit: userConfig.historyLimit ?? DEFAULT_CONFIG.historyLimit,
    autoApproveReadOnly:
      userConfig.autoApproveReadOnly ?? DEFAULT_CONFIG.autoApproveReadOnly,
    geminiApiKey: resolvedKey,
    apiKeySource: resolvedSource,
  };
}

export function getResolvedConfig(
  overrides: PartialCmdfConfig = {},
): CmdfConfig {
  const defaults = getDefaultConfig();
  const userConfig = loadUserConfig();
  const projectEnv = loadProjectEnv();

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

  // Re-verify API key and source using strict precedence:
  // CLI override > explicit shell env > user config > project .env
  if (overrides.geminiApiKey) {
    resolved.geminiApiKey = sanitizeString(overrides.geminiApiKey);
    resolved.apiKeySource = "user_config";
  } else {
    const { key, source } = resolveApiKey();
    resolved.geminiApiKey = key;
    resolved.apiKeySource = source;
  }

  // Model resolution priority: override > process.env > userConfig > projectEnv > default
  resolved.model =
    sanitizeString(overrides.model) ||
    sanitizeString(process.env.GEMINI_MODEL) ||
    sanitizeString(userConfig.model) ||
    sanitizeString(projectEnv.GEMINI_MODEL) ||
    DEFAULT_CONFIG.model;

  // Workspace resolution priority: override > process.env > userConfig > projectEnv > default
  const rawWorkspace =
    overrides.workspace ||
    process.env.CMDF_WORKSPACE ||
    process.env.ASKTERM_WORKSPACE ||
    userConfig.workspace ||
    projectEnv.CMDF_WORKSPACE ||
    process.cwd();
  resolved.workspace = path.resolve(
    sanitizeString(rawWorkspace) || process.cwd(),
  );

  // Timeout resolution priority: override > process.env > userConfig > projectEnv > default
  resolved.timeoutMs = parseTimeoutMs(
    overrides.timeoutMs ||
      process.env.CMDF_TIMEOUT_MS ||
      process.env.GEMINI_TIMEOUT_MS ||
      userConfig.timeoutMs ||
      projectEnv.CMDF_TIMEOUT_MS ||
      projectEnv.GEMINI_TIMEOUT_MS,
    DEFAULT_CONFIG.timeoutMs,
  );

  return resolved;
}
