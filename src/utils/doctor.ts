import fs from "node:fs";
import chalk from "chalk";
import { getEnvironmentInfo } from "./env-detect.js";
import { getResolvedConfig, getConfigDir } from "../config/index.js";
import { GeminiAIProvider } from "../ai/gemini.js";

export interface DoctorCheckResult {
  category: string;
  name: string;
  passed: boolean;
  message: string;
  remedy?: string;
}

import type { PartialCmdfConfig } from "../config/types.js";

export async function runDoctorChecks(
  customConfig?: PartialCmdfConfig,
): Promise<DoctorCheckResult[]> {
  const results: DoctorCheckResult[] = [];
  const env = getEnvironmentInfo();
  const config = getResolvedConfig(customConfig);

  // 1. Node.js Check
  const nodeMajor = parseInt(process.versions.node.split(".")[0] || "0", 10);
  results.push({
    category: "Runtime",
    name: "Node.js",
    passed: nodeMajor >= 18,
    message: `Node.js ${process.version} detected (LTS recommended)`,
    remedy:
      nodeMajor < 18
        ? "Please upgrade Node.js to version 18 or higher."
        : undefined,
  });

  // 2. npm Check
  results.push({
    category: "Runtime",
    name: "npm",
    passed: env.isNpmAvailable,
    message: env.isNpmAvailable
      ? `npm ${env.npmVersion} available`
      : "npm is not detected on system PATH",
    remedy: !env.isNpmAvailable ? "Install npm with Node.js." : undefined,
  });

  // 3. Git Check
  results.push({
    category: "Tools",
    name: "Git",
    passed: env.isGitAvailable,
    message: env.isGitAvailable
      ? `Git available (${env.gitVersion})`
      : "Git is not found on PATH",
    remedy: !env.isGitAvailable
      ? "Install Git for version control features: https://git-scm.com/"
      : undefined,
  });

  // 4. Shell & OS
  results.push({
    category: "Environment",
    name: "OS & Shell",
    passed: true,
    message: `${env.os} (${env.osRelease}), Shell: ${env.shell}`,
  });

  // 5. Workspace Directory
  let workspaceOk = false;
  let workspaceMsg = "";
  try {
    if (fs.existsSync(config.workspace)) {
      const stat = fs.statSync(config.workspace);
      if (stat.isDirectory()) {
        fs.accessSync(config.workspace, fs.constants.R_OK | fs.constants.W_OK);
        workspaceOk = true;
        workspaceMsg = `Workspace is accessible: ${config.workspace}`;
      } else {
        workspaceMsg = `Workspace path is not a directory: ${config.workspace}`;
      }
    } else {
      workspaceMsg = `Workspace directory does not exist: ${config.workspace}`;
    }
  } catch (err: unknown) {
    workspaceMsg = `Workspace access error: ${err instanceof Error ? err.message : String(err)}`;
  }

  results.push({
    category: "Workspace",
    name: "Approved Workspace",
    passed: workspaceOk,
    message: workspaceMsg,
    remedy: !workspaceOk
      ? "Check workspace path and folder permissions."
      : undefined,
  });

  // 6. User Config Directory
  const configDir = getConfigDir();
  let configDirOk = false;
  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    configDirOk = true;
  } catch {
    configDirOk = false;
  }

  results.push({
    category: "Configuration",
    name: "Config Storage",
    passed: configDirOk,
    message: configDirOk
      ? `User configuration storage active at: ${configDir}`
      : `Cannot write to ${configDir}`,
  });

  // 7. AI Provider Setup
  const hasApiKey = Boolean(
    config.geminiApiKey && config.geminiApiKey.trim().length > 0,
  );
  results.push({
    category: "AI Provider",
    name: "Gemini API Key",
    passed: hasApiKey,
    message: hasApiKey
      ? `GEMINI_API_KEY configured (length: ${config.geminiApiKey?.length} chars, stored securely)`
      : "GEMINI_API_KEY is not configured",
    remedy: !hasApiKey
      ? "Create a .env file or set GEMINI_API_KEY environment variable. Get a free key at https://aistudio.google.com/"
      : undefined,
  });

  results.push({
    category: "AI Provider",
    name: "Selected Model",
    passed: true,
    message: `Model: ${config.model} (Provider: ${config.provider})`,
  });

  // Test live connection if key is present
  if (hasApiKey && config.provider === "gemini") {
    try {
      const provider = new GeminiAIProvider(
        config.geminiApiKey,
        config.model,
        15000,
      );
      const connResult = await provider.testConnectivity();
      results.push({
        category: "AI Provider",
        name: "API Connectivity",
        passed: connResult.ok,
        message: connResult.message,
        remedy: !connResult.ok
          ? "Run 'cmdf config' or check your GEMINI_API_KEY/GEMINI_MODEL in .env"
          : undefined,
      });
    } catch (err: unknown) {
      results.push({
        category: "AI Provider",
        name: "API Connectivity",
        passed: false,
        message: `API connection failed: ${err instanceof Error ? err.message : String(err)}`,
        remedy:
          "Verify internet connection, API key, and model availability at Google AI Studio.",
      });
    }
  }

  return results;
}

export function printDoctorResults(results: DoctorCheckResult[]): void {
  console.log(chalk.bold.cyan("\ncmdf Doctor Diagnostic Report:\n"));

  let allPassed = true;
  for (const check of results) {
    const icon = check.passed ? chalk.green("✔") : chalk.red("✖");
    const name = chalk.bold(check.name);
    const cat = chalk.dim(`[${check.category}]`);
    console.log(`  ${icon} ${cat} ${name}: ${check.message}`);

    if (!check.passed) {
      allPassed = false;
      if (check.remedy) {
        console.log(`     ${chalk.yellow("Suggested fix:")} ${check.remedy}`);
      }
    }
  }

  console.log();
  if (allPassed) {
    console.log(
      chalk.green.bold("All doctor checks passed! cmdf is ready to run.\n"),
    );
  } else {
    console.log(
      chalk.yellow.bold(
        "Some checks need attention. See suggested fixes above.\n",
      ),
    );
  }
}
