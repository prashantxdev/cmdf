export interface CommandValidationResult {
  isAllowed: boolean;
  executable: string;
  args: string[];
  risk: "read-only" | "modifying" | "destructive";
  reason?: string;
}

// Strictly blocked commands and patterns that should never run
const BLOCKED_PATTERNS = [
  /\b(format|diskpart|mkfs|fdisk|parted)\b/i,
  /\brm\s+(-[rfRF]{1,4}\s+)?(\/|[a-zA-Z]:\\|\*)/i,
  /\brmdir\s+\/[sqSQ]\s+([a-zA-Z]:\\|\/)/i,
  /\b(del|erase)\s+\/[sqSQ]\s+([a-zA-Z]:\\|\/)/i,
  /\b(sudo|runas|su|doas)\b/i,
  /\b(shutdown|reboot|init\s+0|halt|poweroff)\b/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, // Fork bomb
  />\s*(\/dev\/sd[a-z]|\/dev\/null)/i,
  /\bchmod\s+(-[rR]\s+)?(777|000)\s+(\/|[a-zA-Z]:\\)/i,
  /\bchown\s+(-[rR]\s+)?.*(\/|[a-zA-Z]:\\)/i,
  /\bcurl\b.*\|\s*(bash|sh|powershell|cmd)/i,
  /\bwget\b.*\|\s*(bash|sh|powershell|cmd)/i,
  /\bStart-Process\s+.*-Verb\s+runAs\b/i,
];

// Allowed executables for general terminal workflows
const ALLOWED_EXECUTABLES = new Set([
  "git",
  "npm",
  "npx",
  "node",
  "tsc",
  "vitest",
  "eslint",
  "prettier",
  "echo",
  "dir",
  "ls",
  "cat",
  "type",
  "pwd",
  "cd",
  "mkdir",
  "whoami",
  "date",
  "which",
  "where",
  "findstr",
  "grep",
]);

/**
 * Split command line string into executable and argument array safely.
 * Handles single quotes, double quotes, and escaped characters.
 */
export function parseCommandLine(commandStr: string): {
  executable: string;
  args: string[];
} {
  const trimmed = commandStr.trim();
  if (!trimmed) return { executable: "", args: [] };

  const tokens: string[] = [];
  let currentToken = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let isEscaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (isEscaped) {
      currentToken += char;
      isEscaped = false;
      continue;
    }

    if (char === "\\" && !inSingleQuote) {
      isEscaped = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (currentToken.length > 0) {
        tokens.push(currentToken);
        currentToken = "";
      }
      continue;
    }

    currentToken += char;
  }

  if (currentToken.length > 0) {
    tokens.push(currentToken);
  }

  const executable = tokens[0] || "";
  const args = tokens.slice(1);

  return { executable, args };
}

/**
 * Validates a shell command against security policies.
 */
export function validateCommand(rawCommand: string): CommandValidationResult {
  const trimmed = rawCommand.trim();

  if (!trimmed) {
    return {
      isAllowed: false,
      executable: "",
      args: [],
      risk: "read-only",
      reason: "Empty command string",
    };
  }

  // 1. Check for blatantly destructive patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isAllowed: false,
        executable: "",
        args: [],
        risk: "destructive",
        reason: `Command matches strictly blocked high-risk pattern: ${pattern}`,
      };
    }
  }

  // 2. Check for dangerous chaining, pipe injection, or subshell expansion
  if (/&&|\|\||[;&|`]|(?:\$\()/.test(trimmed)) {
    return {
      isAllowed: false,
      executable: "",
      args: [],
      risk: "destructive",
      reason:
        "Command chaining or subshell expansion (&&, ||, ;, |, `, $()) is not permitted for security reasons.",
    };
  }

  // 3. Parse executable and arguments
  const { executable, args } = parseCommandLine(trimmed);
  const baseName = executable
    .toLowerCase()
    .replace(/\.exe$/i, "")
    .replace(/^.*[\\/]/, "");

  if (!ALLOWED_EXECUTABLES.has(baseName)) {
    return {
      isAllowed: false,
      executable,
      args,
      risk: "modifying",
      reason: `Executable "${executable}" is not in the approved command allowlist. For safety, cmdf only runs validated developer tools and safe shell utilities.`,
    };
  }

  // 4. Assess risk level based on command and flags
  let risk: "read-only" | "modifying" | "destructive" = "modifying";

  if (
    baseName === "echo" ||
    baseName === "pwd" ||
    baseName === "dir" ||
    baseName === "ls" ||
    baseName === "cat" ||
    baseName === "type" ||
    baseName === "whoami" ||
    baseName === "which" ||
    baseName === "where"
  ) {
    risk = "read-only";
  } else if (baseName === "git") {
    const subCmd = args[0]?.toLowerCase();
    if (["status", "log", "diff", "show", "branch"].includes(subCmd)) {
      risk = "read-only";
    } else if (["reset", "clean", "rebase"].includes(subCmd)) {
      risk = "destructive";
    } else {
      risk = "modifying";
    }
  } else if (baseName === "npm" || baseName === "npx") {
    const subCmd = args[0]?.toLowerCase();
    if (["test", "run", "build", "lint", "audit"].includes(subCmd)) {
      risk = "modifying";
    } else if (["install", "i", "add"].includes(subCmd)) {
      risk = "modifying";
    } else if (["uninstall", "remove", "rm", "prune"].includes(subCmd)) {
      risk = "modifying";
    }
  }

  return {
    isAllowed: true,
    executable,
    args,
    risk,
  };
}
