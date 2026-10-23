import { spawn } from "node:child_process";
import { validateCommand } from "../security/command-validator.js";
import { redactSecrets } from "../utils/redactor.js";

export interface CommandExecutionResult {
  success: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

const MAX_OUTPUT_SIZE = 200 * 1024; // 200 KB max buffer
const DEFAULT_EXEC_TIMEOUT_MS = 60000; // 60 seconds

/**
 * Execute an approved external binary with argument array safely.
 * Never uses shell: true unless executing batch scripts on Windows when strictly necessary,
 * and even then validates arguments.
 */
export async function executeSafeCommand(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs: number = DEFAULT_EXEC_TIMEOUT_MS,
): Promise<CommandExecutionResult> {
  const isWindows = process.platform === "win32";
  const startTime = Date.now();

  // On Windows, npm, npx, etc. are cmd/ps1 scripts, so npm.cmd is used
  let bin = executable;
  if (
    isWindows &&
    !bin.toLowerCase().endsWith(".cmd") &&
    !bin.toLowerCase().endsWith(".exe")
  ) {
    if (["npm", "npx"].includes(bin.toLowerCase())) {
      bin = `${bin}.cmd`;
    }
  }

  return new Promise((resolve, reject) => {
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let isTerminated = false;

    // Use spawn with argument array — no shell injection possible
    const child = spawn(bin, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      isTerminated = true;
      child.kill("SIGKILL");
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on("data", (data: Buffer) => {
      if (stdoutBuffer.length < MAX_OUTPUT_SIZE) {
        stdoutBuffer += data.toString("utf-8");
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      if (stderrBuffer.length < MAX_OUTPUT_SIZE) {
        stderrBuffer += data.toString("utf-8");
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (!isTerminated) {
        reject(
          new Error(`Failed to start process "${executable}": ${err.message}`),
        );
      }
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      resolve({
        success: code === 0,
        code,
        stdout: redactSecrets(stdoutBuffer.trim()),
        stderr: redactSecrets(stderrBuffer.trim()),
        durationMs,
      });
    });
  });
}

/**
 * Install npm packages using argument array.
 */
export async function runNpmInstall(
  workspaceRoot: string,
  packages: string[],
  isDev: boolean = false,
): Promise<CommandExecutionResult> {
  // Validate package names (prevent flag injection like --prefix or malicious characters)
  for (const pkg of packages) {
    if (!/^[@a-zA-Z0-9_\-\.\/]+$/.test(pkg) || pkg.startsWith("-")) {
      throw new Error(`Invalid package name: "${pkg}"`);
    }
  }

  const args = ["install"];
  if (isDev) args.push("--save-dev");
  args.push(...packages);

  return executeSafeCommand("npm", args, workspaceRoot);
}

/**
 * Run an npm script (e.g. npm run test).
 */
export async function runNpmScript(
  workspaceRoot: string,
  script: string,
): Promise<CommandExecutionResult> {
  // Validate script name
  if (!/^[a-zA-Z0-9_\-:]+$/.test(script)) {
    throw new Error(`Invalid script name: "${script}"`);
  }

  return executeSafeCommand("npm", ["run", script], workspaceRoot);
}

/**
 * Run a validated shell command string.
 */
export async function runValidatedShellCommand(
  rawCommand: string,
  workspaceRoot: string,
): Promise<CommandExecutionResult> {
  const validation = validateCommand(rawCommand);
  if (!validation.isAllowed) {
    throw new Error(`Command blocked: ${validation.reason}`);
  }

  return executeSafeCommand(
    validation.executable,
    validation.args,
    workspaceRoot,
  );
}
