import { select, input } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";
import type { ActionPlan } from "../ai/types.js";
import type { CmdfConfig } from "../config/types.js";
import { getEnvironmentInfo } from "../utils/env-detect.js";
import {
  formatBanner,
  formatPlan,
  formatExecutionResult,
  formatFirstRunSetup,
} from "../utils/formatters.js";
import { AIPlanner } from "../ai/planner.js";
import { PlanExecutor } from "../executor/index.js";
import { saveHistoryEntry } from "../history/index.js";

export async function runInteractiveSession(
  config: CmdfConfig,
  version: string = "1.0.5",
): Promise<void> {
  const env = getEnvironmentInfo(config.shell);
  console.log(formatBanner(version, env, config.workspace));

  if (config.provider === "gemini" && !config.geminiApiKey) {
    console.log(formatFirstRunSetup());
    return;
  }

  console.log(
    chalk.dim(
      'Type your requests in natural language. Type "exit" or press Ctrl+C to quit.\n',
    ),
  );

  const planner = AIPlanner.fromConfig(config);

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
    let plan: ActionPlan | null = null;

    // Planning and Revision Loop
    let executionApproved = false;
    while (true) {
      const isRevision = currentPrompt !== trimmed;
      const spinnerText = isRevision
        ? "Revising action plan..."
        : "Generating action plan...";
      const spinner = ora(spinnerText).start();

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
        plan = null;
        break;
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
          console.log(
            chalk.yellow("\nRequest cancelled due to empty input.\n"),
          );
          plan = null;
          break;
        }

        currentPrompt = `${currentPrompt} (Detail: ${clarificationAnswer.trim()})`;
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
        break;
      }

      // Display formatted plan
      console.log(formatPlan(plan));

      // Interactive 3-way choice: Approve, Revise, Cancel
      let userChoice: "approve" | "revise" | "cancel" = "cancel";
      try {
        userChoice = await select({
          message: chalk.bold("How would you like to proceed?"),
          choices: [
            { name: "✅ Approve and execute", value: "approve" as const },
            { name: "📝 Revise with instruction", value: "revise" as const },
            { name: "❌ Cancel", value: "cancel" as const },
          ],
          default: plan.overallRisk === "destructive" ? "cancel" : "approve",
        });
      } catch {
        userChoice = "cancel";
      }

      if (userChoice === "cancel") {
        console.log(
          chalk.yellow(
            "\nOperation cancelled. No files or commands were executed.\n",
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
        break;
      }

      if (userChoice === "approve") {
        executionApproved = true;
        break;
      }

      if (userChoice === "revise") {
        let revisionPrompt = "";
        try {
          revisionPrompt = await input({
            message: chalk.cyan.bold("How would you like to revise this?"),
          });
        } catch {
          console.log(chalk.yellow("\nOperation cancelled.\n"));
          break;
        }

        const trimmedRev = revisionPrompt.trim();
        if (!trimmedRev) {
          console.log(
            chalk.yellow("No revision entered. Showing options again."),
          );
          continue;
        }

        currentPrompt = `${currentPrompt} [Revision: ${trimmedRev}]`;
        continue;
      }
    }

    if (!executionApproved || !plan) {
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
