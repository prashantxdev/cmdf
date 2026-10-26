import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import { runDoctorChecks } from "../src/utils/doctor.js";
import { GeminiAIProvider } from "../src/ai/gemini.js";
import {
  getResolvedConfig,
  DEFAULT_CONFIG,
  validateTimeoutMs,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  parseTimeoutMs,
} from "../src/config/index.js";
import {
  loadHistory,
  saveHistoryEntry,
  clearHistory,
} from "../src/history/index.js";
import {
  detectOS,
  detectShell,
  getEnvironmentInfo,
} from "../src/utils/env-detect.js";

describe("CLI Utilities, Diagnostics & Config", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("runs doctor checks and returns structured health report", async () => {
    const checks = await runDoctorChecks({ provider: "mock" });
    expect(checks.length).toBeGreaterThanOrEqual(6);

    const nodeCheck = checks.find((c) => c.name === "Node.js");
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck?.passed).toBe(true);

    const wsCheck = checks.find((c) => c.name === "Approved Workspace");
    expect(wsCheck).toBeDefined();
    expect(wsCheck?.passed).toBe(true);
  });

  it("runDoctorChecks passes configured 60000ms timeout to GeminiAIProvider and does not revert to 15000ms", async () => {
    let observedTimeout: number | undefined;
    const connSpy = vi
      .spyOn(GeminiAIProvider.prototype, "testConnectivity")
      .mockImplementation(function (this: unknown) {
        observedTimeout = (this as { timeoutMs: number }).timeoutMs;
        return Promise.resolve({
          ok: true,
          latencyMs: 50,
          model: "gemini-3.5-flash-lite",
          message: "Connected",
        });
      });

    vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      if (String(p).includes("config.json")) return true;
      return false;
    });
    vi.spyOn(fs, "readFileSync").mockImplementation((p) => {
      if (String(p).includes("config.json")) {
        return JSON.stringify({
          geminiApiKey: "AQ.TestKeyMocked12345",
          model: "gemini-3.5-flash-lite",
          timeoutMs: 60000,
        });
      }
      return "";
    });

    try {
      const results = await runDoctorChecks();
      expect(connSpy).toHaveBeenCalled();
      expect(observedTimeout).toBe(60000);
      expect(observedTimeout).not.toBe(15000);

      const liveCheck = results.find((c) => c.name === "Live API Connectivity");
      expect(liveCheck).toBeDefined();
      expect(liveCheck?.passed).toBe(true);
    } finally {
      connSpy.mockRestore();
    }
  });

  it("runDoctorChecks respects environment variable timeout over saved user config", async () => {
    let observedTimeout: number | undefined;
    const connSpy = vi
      .spyOn(GeminiAIProvider.prototype, "testConnectivity")
      .mockImplementation(function (this: unknown) {
        observedTimeout = (this as { timeoutMs: number }).timeoutMs;
        return Promise.resolve({
          ok: true,
          latencyMs: 50,
          model: "gemini-3.5-flash-lite",
          message: "Connected",
        });
      });

    process.env.GEMINI_TIMEOUT_MS = "45000";
    vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      if (String(p).includes("config.json")) return true;
      return false;
    });
    vi.spyOn(fs, "readFileSync").mockImplementation((p) => {
      if (String(p).includes("config.json")) {
        return JSON.stringify({
          geminiApiKey: "AQ.TestKeyMocked12345",
          timeoutMs: 60000,
        });
      }
      return "";
    });

    try {
      await runDoctorChecks();
      expect(observedTimeout).toBe(45000);
    } finally {
      delete process.env.GEMINI_TIMEOUT_MS;
      connSpy.mockRestore();
    }
  });

  it("runDoctorChecks respects custom timeout override (CLI option) over saved config", async () => {
    let observedTimeout: number | undefined;
    const connSpy = vi
      .spyOn(GeminiAIProvider.prototype, "testConnectivity")
      .mockImplementation(function (this: unknown) {
        observedTimeout = (this as { timeoutMs: number }).timeoutMs;
        return Promise.resolve({
          ok: true,
          latencyMs: 50,
          model: "gemini-3.5-flash-lite",
          message: "Connected",
        });
      });

    vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      if (String(p).includes("config.json")) return true;
      return false;
    });
    vi.spyOn(fs, "readFileSync").mockImplementation((p) => {
      if (String(p).includes("config.json")) {
        return JSON.stringify({
          geminiApiKey: "AQ.TestKeyMocked12345",
          timeoutMs: 60000,
        });
      }
      return "";
    });

    try {
      await runDoctorChecks({ timeoutMs: 90000 });
      expect(observedTimeout).toBe(90000);
    } finally {
      connSpy.mockRestore();
    }
  });

  it("detects OS and shell correctly", () => {
    const osType = detectOS();
    expect(["windows", "macos", "linux"]).toContain(osType);

    const shell = detectShell();
    expect(["powershell", "cmd", "zsh", "bash", "sh", "unknown"]).toContain(
      shell,
    );

    const envInfo = getEnvironmentInfo();
    expect(envInfo.isNodeAvailable).toBe(true);
    expect(envInfo.nodeVersion).toBe(process.version);
  });

  it("resolves default config and applies overrides", () => {
    const config = getResolvedConfig({
      workspace: process.cwd(),
      model: "gemini-3.8-flash",
      provider: "mock",
    });

    expect(config.workspace).toBe(process.cwd());
    expect(config.model).toBe("gemini-3.8-flash");
    expect(config.provider).toBe("mock");
  });

  it("records, loads, and clears history entries", () => {
    clearHistory();
    expect(loadHistory()).toHaveLength(0);

    saveHistoryEntry({
      prompt: "test prompt",
      plan: {
        intent: "test",
        assumptions: [],
        steps: [],
        overallRisk: "read-only",
        summary: "test",
      },
      approved: true,
    });

    const entries = loadHistory();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].prompt).toBe("test prompt");

    clearHistory();
    expect(loadHistory()).toHaveLength(0);
  });
});

describe("Configuration Defaults, Precedence & Validation", () => {
  it("defines DEFAULT_CONFIG with 60000ms timeout and gemini-3.5-flash model", () => {
    expect(DEFAULT_CONFIG.timeoutMs).toBe(60000);
    expect(DEFAULT_CONFIG.model).toBe("gemini-3.5-flash");
    expect(DEFAULT_CONFIG.provider).toBe("gemini");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves default model to gemini-3.5-flash and timeout to 60000ms when not specified", () => {
    const originalModel = process.env.GEMINI_MODEL;
    const originalTimeout = process.env.CMDF_TIMEOUT_MS;
    const originalGeminiTimeout = process.env.GEMINI_TIMEOUT_MS;
    delete process.env.GEMINI_MODEL;
    delete process.env.CMDF_TIMEOUT_MS;
    delete process.env.GEMINI_TIMEOUT_MS;

    vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      if (String(p).includes("config.json") || String(p).endsWith(".env")) {
        return false;
      }
      return true;
    });

    try {
      const config = getResolvedConfig();
      expect(config.model).toBe("gemini-3.5-flash");
      expect(config.timeoutMs).toBe(60000);
    } finally {
      if (originalModel !== undefined) process.env.GEMINI_MODEL = originalModel;
      if (originalTimeout !== undefined)
        process.env.CMDF_TIMEOUT_MS = originalTimeout;
      if (originalGeminiTimeout !== undefined)
        process.env.GEMINI_TIMEOUT_MS = originalGeminiTimeout;
    }
  });

  it("assigns new defaults to missing settings while preserving existing settings and API key", () => {
    const originalModel = process.env.GEMINI_MODEL;
    const originalTimeout = process.env.CMDF_TIMEOUT_MS;
    delete process.env.GEMINI_MODEL;
    delete process.env.CMDF_TIMEOUT_MS;

    vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      if (String(p).includes("config.json")) return true;
      return false;
    });
    vi.spyOn(fs, "readFileSync").mockImplementation((p) => {
      if (String(p).includes("config.json")) {
        return JSON.stringify({
          geminiApiKey: "AQ.PreservedKey123456789",
          autoApproveReadOnly: true,
          // Note: model and timeoutMs are missing
        });
      }
      return "";
    });

    try {
      const config = getResolvedConfig();
      expect(config.geminiApiKey).toBe("AQ.PreservedKey123456789");
      expect(config.autoApproveReadOnly).toBe(true);
      expect(config.model).toBe("gemini-3.5-flash");
      expect(config.timeoutMs).toBe(60000);
    } finally {
      if (originalModel !== undefined) process.env.GEMINI_MODEL = originalModel;
      if (originalTimeout !== undefined)
        process.env.CMDF_TIMEOUT_MS = originalTimeout;
    }
  });

  it("preserves explicit user-selected model and timeout from user config without overwriting", () => {
    const originalModel = process.env.GEMINI_MODEL;
    const originalTimeout = process.env.CMDF_TIMEOUT_MS;
    delete process.env.GEMINI_MODEL;
    delete process.env.CMDF_TIMEOUT_MS;

    vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      if (String(p).includes("config.json")) return true;
      return false;
    });
    vi.spyOn(fs, "readFileSync").mockImplementation((p) => {
      if (String(p).includes("config.json")) {
        return JSON.stringify({
          model: "gemini-3.8-flash",
          timeoutMs: 90000,
        });
      }
      return "";
    });

    try {
      const config = getResolvedConfig();
      expect(config.model).toBe("gemini-3.8-flash");
      expect(config.timeoutMs).toBe(90000);
    } finally {
      if (originalModel !== undefined) process.env.GEMINI_MODEL = originalModel;
      if (originalTimeout !== undefined)
        process.env.CMDF_TIMEOUT_MS = originalTimeout;
    }
  });

  it("applies explicit timeout and model overrides over defaults", () => {
    const config = getResolvedConfig({
      model: "custom-user-model",
      timeoutMs: 90000,
    });

    expect(config.model).toBe("custom-user-model");
    expect(config.timeoutMs).toBe(90000);
  });

  it("applies environment variable overrides over defaults", () => {
    process.env.GEMINI_MODEL = "gemini-3.8-flash";
    process.env.CMDF_TIMEOUT_MS = "120000";

    try {
      const config = getResolvedConfig();
      expect(config.model).toBe("gemini-3.8-flash");
      expect(config.timeoutMs).toBe(120000);
    } finally {
      delete process.env.GEMINI_MODEL;
      delete process.env.CMDF_TIMEOUT_MS;
    }
  });

  it("validateTimeoutMs accepts positive integers within [1000, 600000]", () => {
    expect(validateTimeoutMs("60000").valid).toBe(true);
    expect(validateTimeoutMs("60000").value).toBe(60000);
    expect(validateTimeoutMs(90000).valid).toBe(true);
    expect(validateTimeoutMs(90000).value).toBe(90000);
    expect(validateTimeoutMs("1000").valid).toBe(true);
    expect(validateTimeoutMs(MIN_TIMEOUT_MS).valid).toBe(true);
    expect(validateTimeoutMs(MAX_TIMEOUT_MS).valid).toBe(true);
  });

  it("validateTimeoutMs rejects zero, negative, floats, and non-numeric values", () => {
    expect(validateTimeoutMs("0").valid).toBe(false);
    expect(validateTimeoutMs("0").error).toContain("must be between");

    expect(validateTimeoutMs("-500").valid).toBe(false);
    expect(validateTimeoutMs("-500").error).toContain("not a positive integer");

    expect(validateTimeoutMs("abc").valid).toBe(false);
    expect(validateTimeoutMs("abc").error).toContain("not a positive integer");

    expect(validateTimeoutMs("60.5").valid).toBe(false);
    expect(validateTimeoutMs("60.5").error).toContain("not a positive integer");

    expect(validateTimeoutMs("700000").valid).toBe(false);
    expect(validateTimeoutMs("700000").error).toContain("must be between");

    expect(validateTimeoutMs("").valid).toBe(false);
  });

  it("parseTimeoutMs falls back to default timeout when given invalid values", () => {
    expect(parseTimeoutMs(undefined)).toBe(60000);
    expect(parseTimeoutMs("")).toBe(60000);
    expect(parseTimeoutMs("invalid")).toBe(60000);
    expect(parseTimeoutMs("-100")).toBe(60000);
    expect(parseTimeoutMs(0)).toBe(60000);
    expect(parseTimeoutMs(45000)).toBe(45000);
    expect(parseTimeoutMs("90000")).toBe(90000);
  });
});
