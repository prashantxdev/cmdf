import { describe, it, expect } from "vitest";
import { runDoctorChecks } from "../src/utils/doctor.js";
import { getResolvedConfig } from "../src/config/index.js";
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
  it("runs doctor checks and returns structured health report", async () => {
    const checks = await runDoctorChecks();
    expect(checks.length).toBeGreaterThanOrEqual(6);

    const nodeCheck = checks.find((c) => c.name === "Node.js");
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck?.passed).toBe(true);

    const wsCheck = checks.find((c) => c.name === "Approved Workspace");
    expect(wsCheck).toBeDefined();
    expect(wsCheck?.passed).toBe(true);
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
