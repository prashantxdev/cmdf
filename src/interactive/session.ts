import { input, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";
import type { CmdfConfig } from "../config/types.js";
import { getEnvironmentInfo } from "../utils/env-detect.js";
import {
  formatBanner,
  formatPlan,
  formatExecutionResult,
} from "../utils/formatters.js";
import { AIPlanner } from "../ai/planner.js";
import { PlanExecutor } from "../executor/index.js";
import { SecurityPolicy } from "../security/policy.js";
import { saveHistoryEntry } from "../history/index.js";

export async function runInteractiveSession(
  config: CmdfConfig,
  version: string = "1.0.0",
): Promise<void> {
  const env = getEnvironmentInfo(config.shell);
  console.log(formatBanner(version, env, config.workspace));
  console.log(
    chalk.dim(
      'Type your requests in natural language. Type "exit" or press Ctrl+C to quit.\n',
    ),
  );

  const planner = AIPlanner.fromConfig(config);
  const security = new SecurityPolicy({
    autoApproveReadOnly: config.autoApproveReadOnly,
  });

  while (true) {
    let userInput = "";
    try {
      userInput = await input({
        message: chalk.cyan.bold("You:"),
      });
    } catch {
      // User pressed Ctrl+C or exited
      console.log(chalk.yellow("\nSession ended. Goodbye!\n"));
      break;
    }

    const trimmed = userInput.trim();
    if (!trimmed) continue;
    if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
      console.log(chalk.yellow("\nSession ended. Goodbye!\n"));
      break;
    }

    let currentPrompt = trimmed;
    let plan = null;

    // AI Planning with spinner
    const spinner = ora("Generating action plan...").start();
    try {
      plan = await planner.plan(currentPrompt, {
        os: env.os,
        shell: env.shell,
        workspace: config.workspace,
      });
      spinner.stop();
    } catch (err: unknown) {
      spinner.fail("Planning failed");
      const msg = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`\nError: ${msg}\n`));
      continue;
    }

    // Clarification loop if required
    while (plan && plan.requiresClarification) {
      console.log(
        chalk.yellow(
          `\ncmdf: ${plan.clarificationQuestion || "Please provide more details."}\n`,
        ),
      );
      let clarificationAnswer = "";
      try {
        clarificationAnswer = await input({
          message: chalk.cyan.bold("You:"),
        });
      } catch {
        console.log(chalk.yellow("\nCancelled request.\n"));
        plan = null;
        break;
      }

      if (!clarificationAnswer.trim()) {
        console.log(chalk.yellow("\nRequest cancelled due to empty input.\n"));
        plan = null;
        break;
      }

      currentPrompt = `${currentPrompt} called ${clarificationAnswer.trim()}`;
      const clarSpinner = ora("Updating action plan...").start();
      try {
        plan = await planner.plan(currentPrompt, {
          os: env.os,
          shell: env.shell,
          workspace: config.workspace,
        });
        clarSpinner.stop();
      } catch (err: unknown) {
        clarSpinner.fail("Planning update failed");
        const msg = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`\nError: ${msg}\n`));
        plan = null;
        break;
      }
    }

    if (!plan || plan.steps.length === 0) {
      if (plan && !plan.requiresClarification) {
        console.log(chalk.gray(`\nNo actions needed: ${plan.summary}\n`));
      }
      continue;
    }

    // Display formatted plan
    console.log(formatPlan(plan));

    // Determine if confirmation is needed
    const needsApproval = security.requiresConfirmation(plan.overallRisk);
    let approved = false;

    if (needsApproval) {
      const promptDetails = security.getConfirmationPrompt(plan.overallRisk);
      try {
        approved = await confirm({
          message: chalk.bold(promptDetails.promptMessage),
          default: promptDetails.defaultAnswer, // Security: default to false for modifying/destructive
        });
      } catch {
        console.log(chalk.yellow("\nOperation cancelled by user.\n"));
        approved = false;
      }
    } else {
      approved = true;
    }

    if (!approved) {
      console.log(
        chalk.yellow(
          "Operation cancelled. No files or commands were executed.\n",
        ),
      );
      saveHistoryEntry(
        {
          prompt: currentPrompt,
          plan,
          approved: false,
        },
        config.historyLimit,
      );
      continue;
    }

    // Execution
    const executor = new PlanExecutor({
      workspace: config.workspace,
      dryRun: false,
    });

    const execSpinner = ora("Executing actions...").start();
    try {
      const execResult = await executor.executePlan(plan);
      execSpinner.stop();

      console.log(formatExecutionResult(execResult));

      saveHistoryEntry(
        {
          prompt: currentPrompt,
          plan,
          approved: true,
          executionResult: execResult,
        },
        config.historyLimit,
      );
    } catch (err: unknown) {
      execSpinner.fail("Execution error");
      const msg = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`\nExecution error: ${msg}\n`));
    }
  }
}
