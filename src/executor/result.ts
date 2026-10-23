import type { PlanStep } from "../ai/types.js";

export interface StepExecutionResult {
  stepId: number;
  step: PlanStep;
  success: boolean;
  skipped?: boolean;
  verified: boolean;
  message: string;
  data?: unknown;
  durationMs: number;
  error?: string;
}

export interface PlanExecutionResult {
  planIntent: string;
  totalSteps: number;
  completedSteps: StepExecutionResult[];
  failedStep?: StepExecutionResult;
  remainingSteps: PlanStep[];
  success: boolean;
  isDryRun: boolean;
  totalDurationMs: number;
}
