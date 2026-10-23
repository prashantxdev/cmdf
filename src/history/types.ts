import type { ActionPlan } from "../ai/types.js";
import type { PlanExecutionResult } from "../executor/result.js";

export interface HistoryEntry {
  id: string;
  timestamp: string;
  prompt: string;
  plan: ActionPlan;
  approved: boolean;
  executionResult?: PlanExecutionResult;
}
