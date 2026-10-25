import { describe, it, expect, beforeEach } from "vitest";
import { AIPlanner } from "../src/ai/planner.js";
import { MockAIProvider } from "../src/ai/mock.js";
import { ActionPlanSchema } from "../src/ai/schemas.js";

describe("AIPlanner & Structured Planning", () => {
  let mockProvider: MockAIProvider;
  let planner: AIPlanner;
  const workspace = process.cwd();

  beforeEach(() => {
    mockProvider = new MockAIProvider();
    planner = new AIPlanner(mockProvider);
  });

  it("generates a valid structured plan for creating a folder", async () => {
    const plan = await planner.plan("create a folder called my-project", {
      os: "windows",
      shell: "powershell",
      workspace,
    });

    expect(plan.intent).toContain("my-project");
    expect(plan.overallRisk).toBe("modifying");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].action.type).toBe("create_directory");
    if (plan.steps[0].action.type === "create_directory") {
      expect(plan.steps[0].action.path).toBe("my-project");
    }
    expect(plan.requiresClarification).toBeFalsy();
  });

  it("detects underspecified prompt and requests clarification", async () => {
    const plan = await planner.plan("create folder", {
      os: "windows",
      shell: "powershell",
      workspace,
    });

    expect(plan.requiresClarification).toBe(true);
    expect(plan.clarificationQuestion).toBe("What should the folder be named?");
  });

  it("generates multi-step plan for src, tests, and docs folders", async () => {
    const plan = await planner.plan("create src, tests, and docs folders", {
      os: "windows",
      shell: "powershell",
      workspace,
    });

    expect(plan.steps).toHaveLength(3);
    const paths = plan.steps.map((s) => (s.action as { path: string }).path);
    expect(paths).toEqual(["src", "tests", "docs"]);
  });

  it("generates read-only plan for listing files", async () => {
    const plan = await planner.plan("list all files with details", {
      os: "windows",
      shell: "powershell",
      workspace,
    });

    expect(plan.overallRisk).toBe("read-only");
    expect(plan.steps[0].action.type).toBe("list_files");
    expect(plan.steps[0].affectsData).toBe(false);
  });

  it("generates plan for search_files with pattern", async () => {
    const plan = await planner.plan("find all Java files in this project", {
      os: "windows",
      shell: "powershell",
      workspace,
    });

    expect(plan.steps[0].action.type).toBe("search_files");
    if (plan.steps[0].action.type === "search_files") {
      expect(plan.steps[0].action.pattern).toBe("*.java");
    }
  });

  it("generates plan for content search (TODO comments)", async () => {
    const plan = await planner.plan("find TODO comments in my source code", {
      os: "windows",
      shell: "powershell",
      workspace,
    });

    expect(plan.steps[0].action.type).toBe("search_content");
    if (plan.steps[0].action.type === "search_content") {
      expect(plan.steps[0].action.query).toBe("TODO");
    }
  });

  it("validates against ActionPlanSchema and rejects invalid schema data", () => {
    const invalidPlan = {
      intent: "Invalid Plan",
      steps: [
        {
          id: "not-a-number",
          action: { type: "unsupported_action" },
        },
      ],
    };

    expect(() => ActionPlanSchema.parse(invalidPlan)).toThrow();
  });

  it("accepts clarificationQuestion: null and normalizes it to null when requiresClarification is false", () => {
    const parsed = ActionPlanSchema.parse({
      intent: "Create folder DEMO",
      assumptions: null,
      steps: [
        {
          id: 1,
          action: {
            type: "create_directory",
            path: "DEMO",
            description: null,
          },
          risk: "modifying",
          explanation: null,
          affectsData: null,
          targetPaths: null,
        },
      ],
      overallRisk: "modifying",
      summary: "Create DEMO directory",
      requiresClarification: false,
      clarificationQuestion: null,
    });

    expect(parsed.requiresClarification).toBe(false);
    expect(parsed.clarificationQuestion).toBeNull();
    expect(parsed.assumptions).toEqual([]);
    expect(parsed.steps[0].targetPaths).toEqual([]);
    expect(parsed.steps[0].explanation).toBe("");
    expect(parsed.steps[0].affectsData).toBe(false);
  });

  it("accepts a valid non-empty clarificationQuestion when requiresClarification is true", () => {
    const parsed = ActionPlanSchema.parse({
      intent: "Create folder",
      assumptions: [],
      steps: [],
      overallRisk: "read-only",
      summary: "Need clarification",
      requiresClarification: true,
      clarificationQuestion: "What should the folder be named?",
    });

    expect(parsed.requiresClarification).toBe(true);
    expect(parsed.clarificationQuestion).toBe("What should the folder be named?");
  });

  it("rejects when requiresClarification is true but clarificationQuestion is null or empty", () => {
    expect(() =>
      ActionPlanSchema.parse({
        intent: "Create folder",
        assumptions: [],
        steps: [],
        overallRisk: "read-only",
        summary: "Need clarification",
        requiresClarification: true,
        clarificationQuestion: null,
      }),
    ).toThrow(/A non-empty clarificationQuestion is required/);

    expect(() =>
      ActionPlanSchema.parse({
        intent: "Create folder",
        assumptions: [],
        steps: [],
        overallRisk: "read-only",
        summary: "Need clarification",
        requiresClarification: true,
        clarificationQuestion: "   ",
      }),
    ).toThrow(/A non-empty clarificationQuestion is required/);
  });

  it("explains commands with security warnings", async () => {
    const explanation = await planner.explain("rm -rf build");
    expect(explanation).toContain("forcefully");
    expect(explanation).toContain("deletes");
  });
});
