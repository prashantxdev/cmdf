import type { AIProvider } from "./provider.js";
import type { ActionPlan, AIPlanningContext, RiskLevel } from "./types.js";
import { GeminiAIProvider } from "./gemini.js";
import { MockAIProvider } from "./mock.js";
import { validateWorkspacePath } from "../security/path-guard.js";
import { validateCommand } from "../security/command-validator.js";
import type { CmdfConfig } from "../config/types.js";

export class AIPlanner {
  private provider: AIProvider;

  constructor(provider?: AIProvider) {
    if (provider) {
      this.provider = provider;
    } else {
      this.provider = new MockAIProvider();
    }
  }

  static fromConfig(config: CmdfConfig): AIPlanner {
    if (config.provider === "mock") {
      return new AIPlanner(new MockAIProvider());
    }
    if (!config.geminiApiKey) {
      throw new Error(
        "Gemini API key is not configured.\n" +
          "Please configure your personal key with: cmdf config set-key\n" +
          "Or set an environment variable: GEMINI_API_KEY=your_key\n" +
          "Get a free key from Google AI Studio at: https://aistudio.google.com/apikey",
      );
    }
    return new AIPlanner(
      new GeminiAIProvider(config.geminiApiKey, config.model, config.timeoutMs),
    );
  }

  setProvider(provider: AIProvider): void {
    this.provider = provider;
  }

  getProvider(): AIProvider {
    return this.provider;
  }

  async plan(prompt: string, context: AIPlanningContext): Promise<ActionPlan> {
    const rawPlan = await this.provider.generatePlan(prompt, context);

    // If clarification is requested by the AI, return immediately without further checks
    if (rawPlan.requiresClarification) {
      return rawPlan;
    }

    // Post-process and strictly audit each step locally
    let maxRisk: RiskLevel = "read-only";

    for (const step of rawPlan.steps) {
      // 1. Audit path-based actions for workspace safety
      if (
        step.action.type === "create_directory" ||
        step.action.type === "create_file" ||
        step.action.type === "read_file" ||
        step.action.type === "delete_file" ||
        step.action.type === "list_files" ||
        step.action.type === "search_files" ||
        step.action.type === "search_content"
      ) {
        const targetPath = step.action.path;
        const check = validateWorkspacePath(targetPath, context.workspace);
        if (!check.isValid) {
          throw new Error(
            `Security Violation in planned action "${step.action.type}": ${check.error}`,
          );
        }
      }

      if (
        step.action.type === "move" ||
        step.action.type === "rename" ||
        step.action.type === "copy"
      ) {
        const srcCheck = validateWorkspacePath(
          step.action.source,
          context.workspace,
        );
        const dstCheck = validateWorkspacePath(
          step.action.destination,
          context.workspace,
        );
        if (!srcCheck.isValid) {
          throw new Error(
            `Security Violation in source path for "${step.action.type}": ${srcCheck.error}`,
          );
        }
        if (!dstCheck.isValid) {
          throw new Error(
            `Security Violation in destination path for "${step.action.type}": ${dstCheck.error}`,
          );
        }
      }

      // 2. Audit shell commands against command validator
      if (step.action.type === "shell_command") {
        const cmdCheck = validateCommand(step.action.command);
        if (!cmdCheck.isAllowed) {
          throw new Error(
            `Security Block on shell command "${step.action.command}": ${cmdCheck.reason}`,
          );
        }
        if (cmdCheck.risk === "destructive") {
          step.risk = "destructive";
        }
      }

      // 3. Track max risk
      if (step.risk === "destructive") {
        maxRisk = "destructive";
      } else if (step.risk === "modifying" && maxRisk !== "destructive") {
        maxRisk = "modifying";
      }
    }

    rawPlan.overallRisk = maxRisk;
    return rawPlan;
  }

  async explain(command: string): Promise<string> {
    return this.provider.explainCommand(command);
  }
}
