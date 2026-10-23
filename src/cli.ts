#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { confirm } from "@inquirer/prompts";
import {
  getResolvedConfig,
  saveUserConfig,
  loadUserConfig,
} from "./config/index.js";
import { getEnvironmentInfo } from "./utils/env-detect.js";
import {
  formatBanner,
  formatPlan,
  formatExecutionResult,
} from "./utils/formatters.js";
import { AIPlanner } from "./ai/planner.js";
import { PlanExecutor } from "./executor/index.js";
import { SecurityPolicy } from "./security/policy.js";
import {
  loadHistory,
  clearHistory,
  saveHistoryEntry,
} from "./history/index.js";
import { runDoctorChecks, printDoctorResults } from "./utils/doctor.js";
import { runInteractiveSession } from "./interactive/session.js";

const VERSION = "1.0.0";

const program = new Command();

program
  .name("cmdf")
  .description(
    "AI-Powered Natural Language Terminal Assistant — Your intent. One command.",
  )
  .version(VERSION, "-v, --version", "Display version number")
  .argument("[instruction...]", "Natural language task description")
  .option("-w, --workspace <path>", "Approved workspace root directory")
  .option("-m, --model <name>", "Gemini model to use")
  .option("-p, --provider <name>", "AI provider (gemini or mock)")
  .option("-t, --timeout <ms>", "AI request timeout in milliseconds")
  .option(
    "-d, --dry-run",
    "Simulate plan without modifying files or executing commands",
  )
  .option("-y, --yes", "Automatically approve non-destructive actions")
  .action(async (instructionWords: string[], options) => {
    const config = getResolvedConfig({
      workspace: options.workspace,
      model: options.model,
      provider: options.provider,
      timeoutMs: options.timeout ? parseInt(options.timeout, 10) : undefined,
    });

    const env = getEnvironmentInfo(config.shell);

    // If no instruction provided, start interactive REPL mode
    if (!instructionWords || instructionWords.length === 0) {
      await runInteractiveSession(config, VERSION);
      return;
    }

    const instruction = instructionWords.join(" ").trim();
    console.log(formatBanner(VERSION, env, config.workspace));

    console.log(chalk.white(`Request: ${chalk.bold(instruction)}`));

    const planner = AIPlanner.fromConfig(config);
    const security = new SecurityPolicy({
      autoApproveReadOnly: options.yes || config.autoApproveReadOnly,
    });

    const spinner = ora("Generating action plan...").start();
    let plan;
    try {
      plan = await planner.plan(instruction, {
        os: env.os,
        shell: env.shell,
        workspace: config.workspace,
      });
      spinner.stop();
    } catch (err: unknown) {
      spinner.fail("Planning failed");
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`\nError: ${msg}\n`));
      process.exit(1);
    }

    if (plan.requiresClarification) {
      console.log(
        chalk.yellow(`\nClarification required: ${plan.clarificationQuestion}`),
      );
      console.log(
        chalk.gray(
          "Please run again with the missing detail included, or run in interactive mode.\n",
        ),
      );
      process.exit(0);
    }

    console.log(formatPlan(plan));

    // If dry-run, execute directly in dry-run mode
    if (options.dryRun) {
      const executor = new PlanExecutor({
        workspace: config.workspace,
        dryRun: true,
      });
      const result = await executor.executePlan(plan);
      console.log(formatExecutionResult(result));
      return;
    }

    // Confirmation logic
    let approved = false;
    const needsApproval = security.requiresConfirmation(plan.overallRisk);

    if (options.yes && plan.overallRisk !== "destructive") {
      approved = true;
    } else if (needsApproval) {
      const promptDetails = security.getConfirmationPrompt(plan.overallRisk);
      try {
        approved = await confirm({
          message: chalk.bold(promptDetails.promptMessage),
          default: promptDetails.defaultAnswer,
        });
      } catch {
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
          prompt: instruction,
          plan,
          approved: false,
        },
        config.historyLimit,
      );
      process.exit(0);
    }

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
          prompt: instruction,
          plan,
          approved: true,
          executionResult: execResult,
        },
        config.historyLimit,
      );

      if (!execResult.success) {
        process.exit(1);
      }
    } catch (err: unknown) {
      execSpinner.fail("Execution failed");
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`\nExecution error: ${msg}\n`));
      process.exit(1);
    }
  });

// cmdf plan command
program
  .command("plan <instruction...>")
  .description(
    "Display an AI-generated action plan without applying any changes",
  )
  .option("-w, --workspace <path>", "Workspace directory")
  .option("-m, --model <name>", "Gemini model to use")
  .option("-p, --provider <name>", "AI provider (gemini or mock)")
  .option("-t, --timeout <ms>", "AI request timeout in milliseconds")
  .action(async (instructionWords: string[], options) => {
    const parentOpts = program.opts();
    const timeoutRaw = options.timeout || parentOpts.timeout;
    const config = getResolvedConfig({
      workspace: options.workspace || parentOpts.workspace,
      model: options.model || parentOpts.model,
      provider: options.provider || parentOpts.provider,
      timeoutMs: timeoutRaw ? parseInt(timeoutRaw, 10) : undefined,
    });
    const env = getEnvironmentInfo(config.shell);
    const instruction = instructionWords.join(" ").trim();

    console.log(formatBanner(VERSION, env, config.workspace));
    console.log(chalk.white(`Plan Request: ${chalk.bold(instruction)}`));

    const planner = AIPlanner.fromConfig(config);
    const spinner = ora("Generating plan...").start();
    try {
      const plan = await planner.plan(instruction, {
        os: env.os,
        shell: env.shell,
        workspace: config.workspace,
      });
      spinner.stop();
      console.log(formatPlan(plan));
    } catch (err: unknown) {
      spinner.fail("Plan generation failed");
      console.error(
        chalk.red(
          `\nError: ${err instanceof Error ? err.message : String(err)}\n`,
        ),
      );
      process.exitCode = 1;
    }
  });

// cmdf explain command
program
  .command("explain <command...>")
  .description("Explain a shell command without executing it")
  .option("-m, --model <name>", "Gemini model to use")
  .option("-p, --provider <name>", "AI provider (gemini or mock)")
  .option("-t, --timeout <ms>", "AI request timeout in milliseconds")
  .action(async (commandWords: string[], options) => {
    const parentOpts = program.opts();
    const timeoutRaw = options.timeout || parentOpts.timeout;
    const config = getResolvedConfig({
      model: options.model || parentOpts.model,
      provider: options.provider || parentOpts.provider,
      timeoutMs: timeoutRaw ? parseInt(timeoutRaw, 10) : undefined,
    });
    const env = getEnvironmentInfo(config.shell);
    const cmdToExplain = commandWords.join(" ").trim();

    console.log(formatBanner(VERSION, env, config.workspace));
    console.log(
      chalk.white(`Command to explain: ${chalk.bold.yellow(cmdToExplain)}\n`),
    );

    const planner = AIPlanner.fromConfig(config);
    const spinner = ora("Analyzing command...").start();
    try {
      const explanation = await planner.explain(cmdToExplain);
      spinner.stop();
      console.log(chalk.cyan.bold("Explanation:"));
      console.log(explanation);
      console.log();
    } catch (err: unknown) {
      spinner.fail("Online analysis failed");
      const msg = err instanceof Error ? err.message : String(err);
      console.log(chalk.yellow(`\nNotice: ${msg}`));
      console.log(chalk.dim("Falling back to local security analysis...\n"));

      // Local rule-based explanation fallback
      const mock = new (await import("./ai/mock.js")).MockAIProvider();
      const localExplanation = await mock.explainCommand(cmdToExplain);
      console.log(chalk.cyan.bold("Local Security Analysis:"));
      console.log(localExplanation);
      console.log();
    }
  });

// cmdf doctor command
program
  .command("doctor")
  .description(
    "Inspect environment, workspace boundaries, dependencies, and AI provider setup",
  )
  .action(async () => {
    const spinner = ora("Running system diagnostics...").start();
    const results = await runDoctorChecks();
    spinner.stop();
    printDoctorResults(results);
  });

// cmdf config command
program
  .command("config [action] [key] [value]")
  .description("View or update local configuration settings")
  .action(async (action?: string, key?: string, value?: string) => {
    if (!action || action === "get" || action === "list") {
      const resolved = getResolvedConfig();
      const user = loadUserConfig();
      console.log(chalk.bold.cyan("\nCurrent cmdf Configuration:\n"));
      console.log(`  Workspace:        ${resolved.workspace}`);
      console.log(`  AI Provider:      ${resolved.provider}`);
      console.log(`  AI Model:         ${resolved.model}`);
      console.log(`  Request Timeout:  ${resolved.timeoutMs}ms`);
      console.log(`  History Limit:    ${resolved.historyLimit}`);
      console.log(`  Auto-Approve R/O: ${resolved.autoApproveReadOnly}`);
      console.log(
        `  Gemini API Key:   ${resolved.geminiApiKey ? "[CONFIGURED securely]" : chalk.red("[NOT CONFIGURED]")}`,
      );
      if (Object.keys(user).length > 0) {
        console.log(chalk.dim("\nUser overrides in ~/.cmdf/config.json:"));
        console.log(chalk.dim(JSON.stringify(user, null, 2)));
      }
      console.log();
      return;
    }

    if (action === "set" && key && value !== undefined) {
      let parsedValue: unknown = value;
      if (value === "true") parsedValue = true;
      if (value === "false") parsedValue = false;
      if (/^\d+$/.test(value)) parsedValue = parseInt(value, 10);

      saveUserConfig({ [key]: parsedValue });
      console.log(chalk.green(`\nUpdated configuration: ${key} = ${value}\n`));
      return;
    }

    console.log(
      chalk.yellow("\nUsage: cmdf config [list | set <key> <value>]\n"),
    );
  });

// cmdf history command
program
  .command("history")
  .description("View recent request history")
  .option("-c, --clear", "Clear all history")
  .action((options) => {
    if (options.clear) {
      clearHistory();
      console.log(chalk.green("\nHistory cleared successfully.\n"));
      return;
    }

    const history = loadHistory();
    if (history.length === 0) {
      console.log(chalk.gray("\nNo history entries found.\n"));
      return;
    }

    console.log(
      chalk.bold.cyan(`\nRecent cmdf History (${history.length} entries):\n`),
    );
    for (let i = 0; i < Math.min(history.length, 15); i++) {
      const entry = history[i];
      const status = entry.approved
        ? entry.executionResult?.success
          ? chalk.green("✔ Done")
          : chalk.red("✖ Failed")
        : chalk.yellow("⊘ Cancelled");

      console.log(
        `  ${chalk.dim(new Date(entry.timestamp).toLocaleString())} [${status}] ${chalk.bold(entry.prompt)}`,
      );
    }
    console.log();
  });

program.parse(process.argv);
