import type { RiskLevel } from "../ai/types.js";

export interface SecurityPolicyOptions {
  autoApproveReadOnly?: boolean;
}

export class SecurityPolicy {
  private autoApproveReadOnly: boolean;

  constructor(options: SecurityPolicyOptions = {}) {
    this.autoApproveReadOnly = options.autoApproveReadOnly ?? false;
  }

  /**
   * Determine if confirmation is needed before running this plan / action.
   */
  requiresConfirmation(risk: RiskLevel): boolean {
    if (risk === "read-only" && this.autoApproveReadOnly) {
      return false;
    }
    return true;
  }

  /**
   * Determine required confirmation message and strictness.
   */
  getConfirmationPrompt(risk: RiskLevel): {
    promptMessage: string;
    defaultAnswer: boolean;
    requiresStrongConfirmation: boolean;
  } {
    if (risk === "destructive") {
      return {
        promptMessage:
          "CAUTION: This plan contains DESTRUCTIVE or IRREVERSIBLE actions. Do you want to proceed?",
        defaultAnswer: false, // Security: Default to No
        requiresStrongConfirmation: true,
      };
    }

    if (risk === "modifying") {
      return {
        promptMessage:
          "This plan will make modifications to your files or workspace. Proceed?",
        defaultAnswer: false, // Security: Default to No
        requiresStrongConfirmation: false,
      };
    }

    return {
      promptMessage: "Execute read-only inspection?",
      defaultAnswer: true,
      requiresStrongConfirmation: false,
    };
  }

  /**
   * Verify process is not inappropriately running under root/admin when unexpected.
   */
  isElevated(): boolean {
    if (process.platform !== "win32" && process.getuid) {
      return process.getuid() === 0;
    }
    return false;
  }
}
