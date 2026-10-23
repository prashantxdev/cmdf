import os from "node:os";
import { execSync } from "node:child_process";

export type DetectedOS = "windows" | "macos" | "linux";
export type DetectedShell =
  "powershell" | "cmd" | "zsh" | "bash" | "sh" | "unknown";

export interface EnvironmentInfo {
  os: DetectedOS;
  osRelease: string;
  shell: DetectedShell;
  shellPath?: string;
  isGitAvailable: boolean;
  isNpmAvailable: boolean;
  isNodeAvailable: boolean;
  nodeVersion: string;
  gitVersion?: string;
  npmVersion?: string;
}

export function detectOS(): DetectedOS {
  const platform = os.platform();
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  return "linux";
}

export function detectShell(overrideShell?: string): DetectedShell {
  if (overrideShell) {
    const s = overrideShell.toLowerCase();
    if (s.includes("powershell") || s === "pwsh") return "powershell";
    if (s.includes("cmd")) return "cmd";
    if (s.includes("zsh")) return "zsh";
    if (s.includes("bash")) return "bash";
    if (s.includes("sh")) return "sh";
  }

  const currentOS = detectOS();
  if (currentOS === "windows") {
    // Check PSModulePath or ComSpec
    const psModulePath = process.env.PSModulePath;
    if (psModulePath) return "powershell";
    const comspec = process.env.ComSpec || "";
    if (comspec.toLowerCase().includes("cmd.exe")) return "cmd";
    return "powershell";
  }

  const envShell = process.env.SHELL || "";
  if (envShell.includes("zsh")) return "zsh";
  if (envShell.includes("bash")) return "bash";
  if (envShell.includes("sh")) return "sh";

  return currentOS === "macos" ? "zsh" : "bash";
}

function checkCommandVersion(cmd: string): {
  available: boolean;
  version?: string;
} {
  try {
    const output = execSync(`${cmd} --version`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
    return { available: true, version: output };
  } catch {
    return { available: false };
  }
}

export function getEnvironmentInfo(overrideShell?: string): EnvironmentInfo {
  const currentOS = detectOS();
  const shell = detectShell(overrideShell);
  const shellPath = process.env.SHELL || process.env.ComSpec;

  const nodeVersion = process.version;
  const gitInfo = checkCommandVersion("git");
  const npmInfo = checkCommandVersion("npm");

  return {
    os: currentOS,
    osRelease: `${os.type()} ${os.release()}`,
    shell,
    shellPath,
    isGitAvailable: gitInfo.available,
    isNpmAvailable: npmInfo.available,
    isNodeAvailable: true,
    nodeVersion,
    gitVersion: gitInfo.version,
    npmVersion: npmInfo.version,
  };
}
