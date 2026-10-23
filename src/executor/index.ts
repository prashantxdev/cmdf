import fs from "node:fs";
import path from "node:path";
import type { ActionPlan, PlanStep } from "../ai/types.js";
import type { StepExecutionResult, PlanExecutionResult } from "./result.js";
import { executeAction } from "../actions/registry.js";
import { validateWorkspacePath } from "../security/path-guard.js";

export interface ExecutorOptions {
  workspace: string;
  dryRun?: boolean;
}

export class PlanExecutor {
  private workspace: string;
  private isDryRun: boolean;

  constructor(options: ExecutorOptions) {
    this.workspace = options.workspace;
    this.isDryRun = options.dryRun ?? false;
  }

  /**
   * Verifies the actual physical result of a step after execution.
   */
  private verifyStep(step: PlanStep): { verified: boolean; message: string } {
    const action = step.action;

    switch (action.type) {
      case "create_directory": {
        const check = validateWorkspacePath(action.path, this.workspace);
        const exists =
          fs.existsSync(check.resolvedPath) &&
          fs.statSync(check.resolvedPath).isDirectory();
        return {
          verified: exists,
          message: exists
            ? `Verified: Directory exists at "${check.relativePath}"`
            : `Verification failed: Directory "${check.relativePath}" was not found after creation.`,
        };
      }
      case "create_file": {
        const check = validateWorkspacePath(action.path, this.workspace);
        const exists =
          fs.existsSync(check.resolvedPath) &&
          fs.statSync(check.resolvedPath).isFile();
        return {
          verified: exists,
          message: exists
            ? `Verified: File exists at "${check.relativePath}"`
            : `Verification failed: File "${check.relativePath}" was not found after creation.`,
        };
      }
      case "delete_file": {
        const check = validateWorkspacePath(action.path, this.workspace);
        const deleted = !fs.existsSync(check.resolvedPath);
        return {
          verified: deleted,
          message: deleted
            ? `Verified: File at "${check.relativePath}" successfully removed`
            : `Verification failed: File "${check.relativePath}" still exists on disk.`,
        };
      }
      case "move":
      case "rename": {
        const dstCheck = validateWorkspacePath(
          action.destination,
          this.workspace,
        );
        const exists = fs.existsSync(dstCheck.resolvedPath);
        return {
          verified: exists,
          message: exists
            ? `Verified: Destination exists at "${dstCheck.relativePath}"`
            : `Verification failed: Destination "${dstCheck.relativePath}" does not exist.`,
        };
      }
      case "copy": {
        const dstCheck = validateWorkspacePath(
          action.destination,
          this.workspace,
        );
        const exists = fs.existsSync(dstCheck.resolvedPath);
        return {
          verified: exists,
          message: exists
            ? `Verified: Copy exists at "${dstCheck.relativePath}"`
            : `Verification failed: Destination copy "${dstCheck.relativePath}" was not found.`,
        };
      }
      case "git_init": {
        const check = validateWorkspacePath(action.path, this.workspace);
        const gitDir = path.join(check.resolvedPath, ".git");
        const exists = fs.existsSync(gitDir);
        return {
          verified: exists,
          message: exists
            ? `Verified: .git repository initialized at "${check.relativePath}"`
            : "Verification failed: .git directory not found after git init.",
        };
      }
      default:
        return {
          verified: true,
          message: "Operation completed successfully.",
        };
    }
  }

  /**
   * Execute an entire action plan step-by-step.
   */
  async executePlan(plan: ActionPlan): Promise<PlanExecutionResult> {
    const startTime = Date.now();
    const completedSteps: StepExecutionResult[] = [];
    const remainingSteps: PlanStep[] = [...plan.steps];

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const stepStartTime = Date.now();

      if (this.isDryRun) {
        // Dry-run mode: do NOT modify any files or execute commands
        const stepResult: StepExecutionResult = {
          stepId: step.id,
          step,
          success: true,
          skipped: true,
          verified: false,
          message: `[Dry Run] Would execute: ${step.explanation}`,
          durationMs: 0,
        };
        completedSteps.push(stepResult);
        remainingSteps.shift();
        continue;
      }

      try {
        const data = await executeAction(step.action, this.workspace);
        const verifyCheck = this.verifyStep(step);

        if (!verifyCheck.verified) {
          const failedResult: StepExecutionResult = {
            stepId: step.id,
            step,
            success: false,
            verified: false,
            message: verifyCheck.message,
            durationMs: Date.now() - stepStartTime,
            error: verifyCheck.message,
          };
          return {
            planIntent: plan.intent,
            totalSteps: plan.steps.length,
            completedSteps,
            failedStep: failedResult,
            remainingSteps: plan.steps.slice(i + 1),
            success: false,
            isDryRun: this.isDryRun,
            totalDurationMs: Date.now() - startTime,
          };
        }

        const stepResult: StepExecutionResult = {
          stepId: step.id,
          step,
          success: true,
          verified: true,
          message:
            (data as { message?: string })?.message || verifyCheck.message,
          data,
          durationMs: Date.now() - stepStartTime,
        };

        completedSteps.push(stepResult);
        remainingSteps.shift();
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const failedResult: StepExecutionResult = {
          stepId: step.id,
          step,
          success: false,
          verified: false,
          message: `Failed at step ${step.id}: ${errorMsg}`,
          durationMs: Date.now() - stepStartTime,
          error: errorMsg,
        };

        return {
          planIntent: plan.intent,
          totalSteps: plan.steps.length,
          completedSteps,
          failedStep: failedResult,
          remainingSteps: plan.steps.slice(i + 1),
          success: false,
          isDryRun: this.isDryRun,
          totalDurationMs: Date.now() - startTime,
        };
      }
    }

    return {
      planIntent: plan.intent,
      totalSteps: plan.steps.length,
      completedSteps,
      remainingSteps: [],
      success: true,
      isDryRun: this.isDryRun,
      totalDurationMs: Date.now() - startTime,
    };
  }
}
