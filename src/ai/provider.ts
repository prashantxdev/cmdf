import type { ActionPlan, AIPlanningContext } from "./types.js";

export interface AIProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  generatePlan(prompt: string, context: AIPlanningContext): Promise<ActionPlan>;
  explainCommand(command: string): Promise<string>;
}
