import chalk from "chalk";
import type { ActionPlan, PlanStep, RiskLevel } from "../ai/types.js";
import type { PlanExecutionResult } from "../executor/result.js";
import type { EnvironmentInfo } from "./env-detect.js";

export function formatBanner(
  version: string,
  env: EnvironmentInfo,
  workspace: string,
): string {
  const title = chalk.bold.cyan(`cmdf v${version}`);
  const tagline = chalk.dim("Your intent. One command.");
  const osInfo = chalk.gray(`OS: ${env.os} (${env.osRelease})`);
  const shellInfo = chalk.gray(`Shell: ${env.shell}`);
  const wsInfo = chalk.gray(`Workspace: ${workspace}`);

  return `\n${title} — ${tagline}\n${osInfo} | ${shellInfo}\n${wsInfo}\n`;
}

export function formatRiskBadge(risk: RiskLevel): string {
  switch (risk) {
    case "destructive":
      return chalk.bgRed.black.bold(" HIGH RISK: DESTRUCTIVE ");
    case "modifying":
      return chalk.bgYellow.black.bold(" MODIFYING ");
    case "read-only":
      return chalk.bgGreen.black.bold(" READ-ONLY ");
  }
}

export function formatStep(step: PlanStep): string {
  const num = chalk.cyan.bold(`${step.id}.`);
  const desc = chalk.white(step.action.description || step.explanation);
  const riskBadge =
    step.risk === "destructive"
      ? chalk.red(`[${step.risk}]`)
      : step.risk === "modifying"
        ? chalk.yellow(`[${step.risk}]`)
        : chalk.green(`[${step.risk}]`);

  let target = "";
  if (step.targetPaths.length > 0) {
    target = chalk.dim(` (target: ${step.targetPaths.join(", ")})`);
  }

  let commandDetails = "";
  if (step.action.type === "shell_command") {
    commandDetails = `\n     ${chalk.yellow("$")} ${chalk.bold(step.action.command)}`;
  } else if (step.action.type === "npm_install") {
    commandDetails = `\n     ${chalk.yellow("$")} npm install ${step.action.packages.join(" ")}${step.action.dev ? " --save-dev" : ""}`;
  } else if (step.action.type === "npm_run") {
    commandDetails = `\n     ${chalk.yellow("$")} npm run ${step.action.script}`;
  }

  return `  ${num} ${desc} ${riskBadge}${target}${commandDetails}`;
}

export function formatPlan(plan: ActionPlan): string {
  const header = chalk.bold.blue("\nProposed Action Plan:");
  const intent = chalk.white(`  Intent: ${chalk.bold(plan.intent)}`);
  const risk = `  Risk: ${formatRiskBadge(plan.overallRisk)}`;
  const summary = chalk.gray(`  Summary: ${plan.summary}`);

  const stepsHeader = chalk.bold.white("\n  Steps:");
  const stepList = plan.steps.map(formatStep).join("\n");

  let assumptions = "";
  if (plan.assumptions && plan.assumptions.length > 0) {
    assumptions =
      `\n  ${chalk.dim("Assumptions:")}\n` +
      plan.assumptions.map((a) => chalk.dim(`   • ${a}`)).join("\n");
  }

  return `${header}\n${intent}\n${risk}\n${summary}\n${stepsHeader}\n${stepList}${assumptions}\n`;
}

export function formatExecutionResult(result: PlanExecutionResult): string {
  const lines: string[] = [];

  if (result.isDryRun) {
    lines.push(chalk.cyan.bold("\n[DRY RUN SUMMARY] — No changes were made:"));
  } else if (result.success) {
    lines.push(
      chalk.green.bold("\n[SUCCESS] All actions completed and verified:"),
    );
  } else {
    lines.push(chalk.red.bold("\n[EXECUTION FAILED]:"));
  }

  for (const step of result.completedSteps) {
    const statusIcon = step.skipped ? chalk.cyan("⊘") : chalk.green("✔");
    const msg = chalk.white(step.message);
    const time = chalk.dim(`(${step.durationMs}ms)`);
    lines.push(`  ${statusIcon} Step ${step.stepId}: ${msg} ${time}`);

    if (step.data && typeof step.data === "string") {
      lines.push(chalk.gray(`     ${step.data.split("\n").join("\n     ")}`));
    }
  }

  if (result.failedStep) {
    lines.push(
      chalk.red(
        `  ✖ Step ${result.failedStep.stepId} FAILED: ${result.failedStep.message}`,
      ),
    );
    if (result.remainingSteps.length > 0) {
      lines.push(
        chalk.yellow(
          `  ⚠ Skipped ${result.remainingSteps.length} remaining step(s) due to earlier failure.`,
        ),
      );
    }
  }

  lines.push(chalk.dim(`\nTotal duration: ${result.totalDurationMs}ms\n`));

  return lines.join("\n");
}
