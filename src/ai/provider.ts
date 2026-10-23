import type { ActionPlan, AIPlanningContext } from "./types.js";

export interface ConnectivityResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  model: string;
  error?: string;
}

export interface AIProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  testConnectivity?(): Promise<ConnectivityResult>;
  generatePlan(prompt: string, context: AIPlanningContext): Promise<ActionPlan>;
  explainCommand(command: string): Promise<string>;
}
