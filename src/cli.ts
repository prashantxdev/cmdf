#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { select, input, password } from "@inquirer/prompts";
import type { ActionPlan } from "./ai/types.js";
import {
  getResolvedConfig,
  saveUserConfig,
  loadUserConfig,
  setStoredApiKey,
  deleteStoredApiKey,
  maskApiKey,
  checkConfigPermissions,
  validateTimeoutMs,
} from "./config/index.js";
import { getEnvironmentInfo } from "./utils/env-detect.js";
import {
  formatBanner,
  formatPlan,
  formatExecutionResult,
  formatFirstRunSetup,
} from "./utils/formatters.js";
import { AIPlanner } from "./ai/planner.js";
import { PlanExecutor } from "./executor/index.js";
import {
  loadHistory,
  clearHistory,
  saveHistoryEntry,
} from "./history/index.js";
import { runDoctorChecks, printDoctorResults } from "./utils/doctor.js";
import { runInteractiveSession } from "./interactive/session.js";

const VERSION = "1.0.2";

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

    if (config.provider === "gemini" && !config.geminiApiKey) {
      console.log(formatFirstRunSetup());
      process.exit(1);
    }

    console.log(chalk.white(`Request: ${chalk.bold(instruction)}`));

    const planner = AIPlanner.fromConfig(config);

    let currentInstruction = instruction;
    let plan!: ActionPlan;

    // Planning and Revision Loop (inspired by Builder.io AI Shell)
    while (true) {
      const isRevision = currentInstruction !== instruction;
      const spinnerText = isRevision
        ? "Revising action plan..."
        : "Generating action plan...";
      const spinner = ora(spinnerText).start();

      try {
        plan = await planner.plan(currentInstruction, {
          os: env.os,
          shell: env.shell,
          workspace: config.workspace,
        });
        spinner.stop();
      } catch (err: unknown) {
        spinner.fail("Planning failed");
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`\nError: ${msg}\n`));
        process.exitCode = 1;
        return;
      }

      if (plan.requiresClarification) {
        console.log(
          chalk.yellow(
            `\nClarification required: ${plan.clarificationQuestion || "Please provide additional details."}`,
          ),
        );
        let clarificationAnswer = "";
        try {
          clarificationAnswer = await input({
            message: chalk.cyan.bold("Your answer:"),
          });
        } catch {
          console.log(chalk.yellow("\nOperation cancelled.\n"));
          process.exitCode = 0;
          return;
        }

        if (!clarificationAnswer.trim()) {
          console.log(
            chalk.gray(
              "Please run again with the missing detail included, or run in interactive mode.\n",
            ),
          );
          process.exitCode = 0;
          return;
        }

        currentInstruction = `${currentInstruction} (Detail: ${clarificationAnswer.trim()})`;
        continue;
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

      // If --yes flag passed and not destructive, approve immediately
      if (options.yes && plan.overallRisk !== "destructive") {
        break; // Proceed to execution
      }

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
        // User aborted prompt (Ctrl+C)
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
            prompt: currentInstruction,
            plan,
            approved: false,
          },
          config.historyLimit,
        );
        process.exitCode = 0;
        return;
      }

      if (userChoice === "approve") {
        break; // Proceed to execution
      }

      if (userChoice === "revise") {
        let revisionPrompt = "";
        try {
          revisionPrompt = await input({
            message: chalk.cyan.bold("How would you like to revise this?"),
          });
        } catch {
          console.log(chalk.yellow("\nOperation cancelled.\n"));
          process.exitCode = 0;
          return;
        }

        const trimmedRev = revisionPrompt.trim();
        if (!trimmedRev) {
          console.log(
            chalk.yellow("No revision entered. Showing options again."),
          );
          continue;
        }

        currentInstruction = `${currentInstruction} [Revision: ${trimmedRev}]`;
        continue;
      }
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
          prompt: currentInstruction,
          plan,
          approved: true,
          executionResult: execResult,
        },
        config.historyLimit,
      );

      if (!execResult.success) {
        process.exitCode = 1;
        return;
      }
    } catch (err: unknown) {
      execSpinner.fail("Execution failed");
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`\nExecution error: ${msg}\n`));
      process.exitCode = 1;
      return;
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

    if (config.provider === "gemini" && !config.geminiApiKey) {
      console.log(formatFirstRunSetup());
      process.exitCode = 1;
      return;
    }

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

    if (config.provider === "gemini" && !config.geminiApiKey) {
      console.log(
        chalk.yellow(
          "Notice: Gemini API key is not configured. Falling back to local security analysis.\n",
        ),
      );
      console.log(
        chalk.dim(
          "To enable deep AI-powered explanations, configure your key with: cmdf config set-key\n",
        ),
      );
      const mock = new (await import("./ai/mock.js")).MockAIProvider();
      const localExplanation = await mock.explainCommand(cmdToExplain);
      console.log(chalk.cyan.bold("Local Security Analysis:"));
      console.log(localExplanation);
      console.log();
      return;
    }

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
  .option("-m, --model <name>", "Gemini model to diagnose")
  .option("-t, --timeout <ms>", "AI request timeout in milliseconds")
  .action(async (options) => {
    const parentOpts = program.opts();
    const timeoutRaw = options.timeout || parentOpts.timeout;
    const spinner = ora("Running system diagnostics...").start();
    const results = await runDoctorChecks({
      model: options.model || parentOpts.model,
      timeoutMs: timeoutRaw ? parseInt(timeoutRaw, 10) : undefined,
    });
    spinner.stop();
    printDoctorResults(results);
  });

// cmdf config command
program
  .command("config [action] [key] [value]")
  .description("View or update local configuration settings")
  .action(async (action?: string, key?: string, value?: string) => {
    // 1. cmdf config set-key [key]
    if (action === "set-key") {
      let keyToSet = key;
      if (!keyToSet || keyToSet.trim().length === 0) {
        try {
          keyToSet = await password({
            message: chalk.bold("Enter your Gemini API key (input is masked):"),
            mask: "*",
          });
        } catch {
          console.log(chalk.yellow("\nOperation cancelled.\n"));
          return;
        }
      }

      if (!keyToSet || keyToSet.trim().length === 0) {
        console.log(
          chalk.yellow("\nNo key entered. Configuration was not changed.\n"),
        );
        return;
      }

      try {
        setStoredApiKey(keyToSet);
        const perm = checkConfigPermissions();
        console.log(
          chalk.green.bold("\n✔ Gemini API key saved to ~/.cmdf/config.json"),
        );
        console.log(
          `  Configured Key:   ${maskApiKey(keyToSet)} (${keyToSet.trim().length} chars)`,
        );
        console.log(`  File Security:    ${perm.note}`);
        console.log(chalk.cyan("\nNext Steps:"));
        console.log("  • Run 'cmdf doctor' to verify API connectivity");
        console.log(
          "  • Run 'cmdf <instruction>' to execute commands with AI\n",
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`\nFailed to save API key: ${msg}\n`));
        process.exitCode = 1;
      }
      return;
    }

    // 2. cmdf config delete-key / unset-key
    if (action === "delete-key" || action === "unset-key") {
      deleteStoredApiKey();
      console.log(
        chalk.green(
          "\n✔ Stored Gemini API key removed from ~/.cmdf/config.json\n",
        ),
      );
      return;
    }

    // 3. cmdf config get-key
    if (action === "get-key") {
      const resolved = getResolvedConfig();
      console.log(chalk.bold.cyan("\nActive Gemini API Key Status:\n"));
      console.log(
        `  API Key:  ${resolved.geminiApiKey ? maskApiKey(resolved.geminiApiKey) : chalk.red("[NOT CONFIGURED]")}`,
      );
      console.log(`  Source:   ${resolved.apiKeySource}`);
      console.log();
      return;
    }

    // 4. cmdf config set <key> <value>
    if (action === "set" && key && value !== undefined) {
      if (key === "geminiApiKey") {
        try {
          setStoredApiKey(value);
          console.log(
            chalk.green(
              `\nUpdated configuration: geminiApiKey = ${maskApiKey(value)}\n`,
            ),
          );
        } catch (err: unknown) {
          console.error(
            chalk.red(
              `\nError: ${err instanceof Error ? err.message : String(err)}\n`,
            ),
          );
          process.exitCode = 1;
        }
        return;
      }

      if (key === "timeoutMs") {
        const valCheck = validateTimeoutMs(value);
        if (!valCheck.valid) {
          console.error(chalk.red(`\nError: ${valCheck.error}\n`));
          process.exitCode = 1;
          return;
        }
        saveUserConfig({ timeoutMs: valCheck.value });
        console.log(
          chalk.green(
            `\nUpdated configuration: timeoutMs = ${valCheck.value}\n`,
          ),
        );
        return;
      }

      if (key === "model") {
        const trimmed = value.trim();
        if (!trimmed) {
          console.error(chalk.red("\nError: Model name cannot be empty.\n"));
          process.exitCode = 1;
          return;
        }
        saveUserConfig({ model: trimmed });
        console.log(
          chalk.green(`\nUpdated configuration: model = ${trimmed}\n`),
        );
        return;
      }

      let parsedValue: unknown = value;
      if (value === "true") parsedValue = true;
      if (value === "false") parsedValue = false;
      if (/^\d+$/.test(value)) parsedValue = parseInt(value, 10);

      saveUserConfig({ [key]: parsedValue });
      console.log(chalk.green(`\nUpdated configuration: ${key} = ${value}\n`));
      return;
    }

    // 5. Interactive config wizard (if run without arguments in an interactive terminal)
    if (!action && process.stdin.isTTY) {
      console.log(chalk.bold.cyan("\ncmdf Configuration Wizard\n"));
      const resolved = getResolvedConfig();
      console.log(`  Workspace:        ${chalk.dim(resolved.workspace)}`);
      console.log(`  AI Provider:      ${chalk.bold(resolved.provider)}`);
      console.log(`  AI Model:         ${chalk.bold.green(resolved.model)}`);
      console.log(`  Request Timeout:  ${resolved.timeoutMs}ms`);
      console.log(
        `  Gemini API Key:   ${resolved.geminiApiKey ? maskApiKey(resolved.geminiApiKey) : chalk.red("[NOT CONFIGURED]")} (via ${resolved.apiKeySource})\n`,
      );

      let configAction: string;
      try {
        configAction = await select({
          message: chalk.bold("What would you like to configure?"),
          choices: [
            { name: "🔑 Set Gemini API Key", value: "set-key" },
            {
              name: "🤖 Select AI Model (gemini-3.5-flash, gemini-3.8-flash, etc.)",
              value: "set-model",
            },
            { name: "⏱️  Set Request Timeout", value: "set-timeout" },
            { name: "📋 View Full Configuration", value: "list" },
            { name: "🗑️  Delete Stored API Key", value: "delete-key" },
            { name: "❌ Exit", value: "exit" },
          ],
        });
      } catch {
        return;
      }

      if (configAction === "exit") return;

      if (configAction === "set-model") {
        let selectedModel: string;
        try {
          selectedModel = await select({
            message: chalk.bold("Choose default Gemini model:"),
            choices: [
              {
                name: "gemini-3.5-flash (Fast, recommended, high free quota)",
                value: "gemini-3.5-flash",
              },
              {
                name: "gemini-3.8-flash (Extended reasoning enabled)",
                value: "gemini-3.8-flash",
              },
              {
                name: "gemini-3.5-flash-lite (Ultra-fast, lightweight)",
                value: "gemini-3.5-flash-lite",
              },
              {
                name: "Custom model name...",
                value: "custom",
              },
            ],
            default: resolved.model.includes("3.8")
              ? "gemini-3.8-flash"
              : "gemini-3.5-flash",
          });
        } catch {
          return;
        }

        if (selectedModel === "custom") {
          try {
            selectedModel = await input({
              message: chalk.cyan.bold("Enter model identifier:"),
              default: resolved.model,
            });
          } catch {
            return;
          }
        }

        const trimmed = selectedModel.trim();
        if (trimmed) {
          saveUserConfig({ model: trimmed });
          console.log(
            chalk.green.bold(`\n✔ Default model set to: ${trimmed}\n`),
          );
        }
        return;
      }

      if (configAction === "set-timeout") {
        let selectedTimeout: string;
        try {
          selectedTimeout = await select({
            message: chalk.bold("Choose default AI request timeout:"),
            choices: [
              { name: "30 seconds (30000ms)", value: "30000" },
              { name: "45 seconds (45000ms)", value: "45000" },
              { name: "60 seconds (60000ms - recommended)", value: "60000" },
              { name: "90 seconds (90000ms)", value: "90000" },
              { name: "120 seconds (120000ms)", value: "120000" },
            ],
            default: String(resolved.timeoutMs),
          });
        } catch {
          return;
        }

        const valCheck = validateTimeoutMs(selectedTimeout);
        if (valCheck.valid && valCheck.value) {
          saveUserConfig({ timeoutMs: valCheck.value });
          console.log(
            chalk.green.bold(`\n✔ AI timeout set to: ${valCheck.value}ms\n`),
          );
        }
        return;
      }

      if (configAction === "set-key") {
        let keyToSet = "";
        try {
          keyToSet = await password({
            message: chalk.bold("Enter your Gemini API key (input is masked):"),
            mask: "*",
          });
        } catch {
          console.log(chalk.yellow("\nOperation cancelled.\n"));
          return;
        }

        if (!keyToSet || keyToSet.trim().length === 0) {
          console.log(chalk.yellow("\nNo key entered.\n"));
          return;
        }

        try {
          setStoredApiKey(keyToSet);
          console.log(
            chalk.green.bold(
              `\n✔ Gemini API key saved to ~/.cmdf/config.json (${maskApiKey(keyToSet)})\n`,
            ),
          );
        } catch (err: unknown) {
          console.error(
            chalk.red(
              `\nError: ${err instanceof Error ? err.message : String(err)}\n`,
            ),
          );
        }
        return;
      }

      if (configAction === "delete-key") {
        deleteStoredApiKey();
        console.log(
          chalk.green(
            "\n✔ Stored Gemini API key removed from ~/.cmdf/config.json\n",
          ),
        );
        return;
      }

      // If "list" was chosen in the wizard, fall through to listing below
    }

    // 6. cmdf config list / get
    if (!action || action === "get" || action === "list") {
      const resolved = getResolvedConfig();
      const user = loadUserConfig();
      const perm = checkConfigPermissions();
      console.log(chalk.bold.cyan("\nCurrent cmdf Configuration:\n"));
      console.log(`  Workspace:        ${resolved.workspace}`);
      console.log(`  AI Provider:      ${resolved.provider}`);
      console.log(`  AI Model:         ${resolved.model}`);
      console.log(`  Request Timeout:  ${resolved.timeoutMs}ms`);
      console.log(`  History Limit:    ${resolved.historyLimit}`);
      console.log(`  Auto-Approve R/O: ${resolved.autoApproveReadOnly}`);
      console.log(
        `  Gemini API Key:   ${resolved.geminiApiKey ? maskApiKey(resolved.geminiApiKey) : chalk.red("[NOT CONFIGURED]")}`,
      );
      console.log(`  Key Source:       ${resolved.apiKeySource}`);
      console.log(`  File Security:    ${perm.note}`);

      if (Object.keys(user).length > 0) {
        console.log(chalk.dim("\nUser overrides in ~/.cmdf/config.json:"));
        const sanitizedUser = { ...user };
        if (sanitizedUser.geminiApiKey) {
          sanitizedUser.geminiApiKey = maskApiKey(
            sanitizedUser.geminiApiKey,
          ) as unknown as string;
        }
        console.log(chalk.dim(JSON.stringify(sanitizedUser, null, 2)));
      }
      console.log();
      return;
    }

    console.log(chalk.yellow("\nUsage:"));
    console.log(
      "  cmdf config                       Interactive configuration wizard",
    );
    console.log(
      "  cmdf config list                  List current configuration table",
    );
    console.log(
      "  cmdf config set-key [key]         Save your personal Gemini API key",
    );
    console.log("  cmdf config delete-key            Remove stored API key");
    console.log(
      "  cmdf config get-key               Show masked key and active source",
    );
    console.log(
      "  cmdf config set <key> <value>     Update configuration setting\n",
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
