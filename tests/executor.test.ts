import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PlanExecutor } from "../src/executor/index.js";
import { SecurityPolicy } from "../src/security/policy.js";
import type { ActionPlan } from "../src/ai/types.js";

describe("PlanExecutor & Verification", () => {
  let testWorkspace: string;

  beforeEach(() => {
    testWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "cmdf-exec-"));
  });

  afterEach(() => {
    if (fs.existsSync(testWorkspace)) {
      fs.rmSync(testWorkspace, { recursive: true, force: true });
    }
  });

  it("executes and verifies a multi-step filesystem plan", async () => {
    const plan: ActionPlan = {
      intent: "Set up folder structure and create files",
      assumptions: [],
      overallRisk: "modifying",
      summary: "Creates folders and files",
      steps: [
        {
          id: 1,
          action: {
            type: "create_directory",
            path: "src",
            description: "Create directory src",
          },
          risk: "modifying",
          explanation: "Create src",
          affectsData: true,
          targetPaths: ["src"],
        },
        {
          id: 2,
          action: {
            type: "create_file",
            path: "src/main.ts",
            content: 'console.log("cmdf");',
            description: "Create main.ts",
          },
          risk: "modifying",
          explanation: "Create main.ts",
          affectsData: true,
          targetPaths: ["src/main.ts"],
        },
      ],
    };

    const executor = new PlanExecutor({
      workspace: testWorkspace,
      dryRun: false,
    });

    const result = await executor.executePlan(plan);
    expect(result.success).toBe(true);
    expect(result.completedSteps).toHaveLength(2);
    expect(result.completedSteps[0].verified).toBe(true);
    expect(result.completedSteps[1].verified).toBe(true);

    // Verify on disk
    expect(fs.existsSync(path.join(testWorkspace, "src"))).toBe(true);
    expect(fs.existsSync(path.join(testWorkspace, "src/main.ts"))).toBe(true);
  });

  it("dry-run mode does not create or modify files", async () => {
    const plan: ActionPlan = {
      intent: "Create folder in dry run",
      assumptions: [],
      overallRisk: "modifying",
      summary: "Dry run test",
      steps: [
        {
          id: 1,
          action: {
            type: "create_directory",
            path: "dry-folder",
            description: "Create dry-folder",
          },
          risk: "modifying",
          explanation: "Creates folder",
          affectsData: true,
          targetPaths: ["dry-folder"],
        },
      ],
    };

    const executor = new PlanExecutor({
      workspace: testWorkspace,
      dryRun: true,
    });

    const result = await executor.executePlan(plan);
    expect(result.success).toBe(true);
    expect(result.isDryRun).toBe(true);
    expect(result.completedSteps[0].skipped).toBe(true);

    // Verify folder was NOT created
    expect(fs.existsSync(path.join(testWorkspace, "dry-folder"))).toBe(false);
  });

  it("stops on step failure and reports remaining steps", async () => {
    const plan: ActionPlan = {
      intent: "Plan with invalid step",
      assumptions: [],
      overallRisk: "modifying",
      summary: "Failure test",
      steps: [
        {
          id: 1,
          action: {
            type: "create_directory",
            path: "valid-dir",
            description: "Create valid directory",
          },
          risk: "modifying",
          explanation: "Creates dir",
          affectsData: true,
          targetPaths: ["valid-dir"],
        },
        {
          id: 2,
          action: {
            type: "read_file",
            path: "non-existent-file.txt",
            description: "Read non-existent file",
          },
          risk: "read-only",
          explanation: "Reads file",
          affectsData: false,
          targetPaths: ["non-existent-file.txt"],
        },
        {
          id: 3,
          action: {
            type: "create_directory",
            path: "should-never-run",
            description: "Step 3",
          },
          risk: "modifying",
          explanation: "Step 3",
          affectsData: true,
          targetPaths: ["should-never-run"],
        },
      ],
    };

    const executor = new PlanExecutor({
      workspace: testWorkspace,
      dryRun: false,
    });

    const result = await executor.executePlan(plan);
    expect(result.success).toBe(false);
    expect(result.completedSteps).toHaveLength(1);
    expect(result.failedStep).toBeDefined();
    expect(result.failedStep?.stepId).toBe(2);
    expect(result.remainingSteps).toHaveLength(1);
    expect(result.remainingSteps[0].id).toBe(3);

    // Verify step 3 was never run
    expect(fs.existsSync(path.join(testWorkspace, "should-never-run"))).toBe(
      false,
    );
  });
});

describe("SecurityPolicy confirmation levels", () => {
  it("defaults modifying and destructive actions to require confirmation with default No", () => {
    const policy = new SecurityPolicy();

    expect(policy.requiresConfirmation("read-only")).toBe(true);
    expect(policy.requiresConfirmation("modifying")).toBe(true);
    expect(policy.requiresConfirmation("destructive")).toBe(true);

    const modPrompt = policy.getConfirmationPrompt("modifying");
    expect(modPrompt.defaultAnswer).toBe(false);

    const destPrompt = policy.getConfirmationPrompt("destructive");
    expect(destPrompt.defaultAnswer).toBe(false);
    expect(destPrompt.requiresStrongConfirmation).toBe(true);
  });

  it("allows autoApproveReadOnly configuration for non-modifying tasks", () => {
    const policy = new SecurityPolicy({ autoApproveReadOnly: true });

    expect(policy.requiresConfirmation("read-only")).toBe(false);
    expect(policy.requiresConfirmation("modifying")).toBe(true);
  });
});
