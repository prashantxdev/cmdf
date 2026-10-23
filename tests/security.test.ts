import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  validateWorkspacePath,
  isProtectedPath,
} from "../src/security/path-guard.js";
import {
  validateCommand,
  parseCommandLine,
} from "../src/security/command-validator.js";
import { redactSecrets } from "../src/utils/redactor.js";

describe("Security Controls & Path Guard", () => {
  let testWorkspace: string;

  beforeEach(() => {
    testWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "cmdf-sec-"));
  });

  afterEach(() => {
    if (fs.existsSync(testWorkspace)) {
      fs.rmSync(testWorkspace, { recursive: true, force: true });
    }
  });

  it("allows valid paths inside workspace", () => {
    const res1 = validateWorkspacePath("src/components", testWorkspace);
    expect(res1.isValid).toBe(true);
    expect(res1.resolvedPath).toBe(
      path.resolve(testWorkspace, "src/components"),
    );

    const res2 = validateWorkspacePath(".", testWorkspace);
    expect(res2.isValid).toBe(true);
  });

  it("rejects path traversal attempts with ../", () => {
    const res = validateWorkspacePath("../../secret.txt", testWorkspace);
    expect(res.isValid).toBe(false);
    expect(res.error).toContain("outside the approved workspace");
  });

  it("rejects absolute paths pointing outside workspace", () => {
    const target =
      process.platform === "win32" ? "C:\\Windows\\System32" : "/etc/passwd";
    const res = validateWorkspacePath(target, testWorkspace);
    expect(res.isValid).toBe(false);
    expect(res.error).toContain("outside the approved workspace");
  });

  it("detects and protects sensitive files", () => {
    expect(isProtectedPath(".env", testWorkspace)).toBe(true);
    expect(isProtectedPath("sub/.env", testWorkspace)).toBe(true);
    expect(isProtectedPath(".git/config", testWorkspace)).toBe(true);
    expect(isProtectedPath("id_rsa", testWorkspace)).toBe(true);
    expect(isProtectedPath("src/normal.ts", testWorkspace)).toBe(false);
  });
});

describe("Command Validator & Shell Injection Guard", () => {
  it("parses command line tokens respecting quotes", () => {
    const { executable, args } = parseCommandLine(
      'git commit -m "initial commit" --quiet',
    );
    expect(executable).toBe("git");
    expect(args).toEqual(["commit", "-m", "initial commit", "--quiet"]);
  });

  it("blocks dangerous system-level destructive commands", () => {
    expect(validateCommand("format C:").isAllowed).toBe(false);
    expect(validateCommand("rm -rf /").isAllowed).toBe(false);
    expect(validateCommand("sudo rm -rf build").isAllowed).toBe(false);
    expect(validateCommand("shutdown -r now").isAllowed).toBe(false);
    expect(validateCommand(":(){ :|:& };:").isAllowed).toBe(false);
  });

  it("blocks shell injection and command chaining attempts", () => {
    expect(validateCommand("git status; rm -rf /").isAllowed).toBe(false);
    expect(validateCommand("npm test && rm file").isAllowed).toBe(false);
    expect(validateCommand("echo hello `cat /etc/passwd`").isAllowed).toBe(
      false,
    );
    expect(validateCommand("echo $(whoami)").isAllowed).toBe(false);
  });

  it("blocks non-allowlisted executables", () => {
    const res = validateCommand("powershell -ExecutionPolicy Bypass");
    expect(res.isAllowed).toBe(false);
    expect(res.reason).toContain("not in the approved command allowlist");
  });

  it("permits approved developer tools with appropriate risk levels", () => {
    const gitStatus = validateCommand("git status");
    expect(gitStatus.isAllowed).toBe(true);
    expect(gitStatus.risk).toBe("read-only");

    const npmInstall = validateCommand("npm install express");
    expect(npmInstall.isAllowed).toBe(true);
    expect(npmInstall.risk).toBe("modifying");

    const gitReset = validateCommand("git reset --hard HEAD");
    expect(gitReset.isAllowed).toBe(true);
    expect(gitReset.risk).toBe("destructive");
  });
});

describe("Secret Redaction", () => {
  it("redacts Gemini API keys from logs and messages", () => {
    const secret = "AIzaSyA1234567890123456789012345678901";
    const text = `Request failed using key: ${secret}`;
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain(secret);
    expect(redacted).toContain("[REDACTED_SECRET]");
  });

  it("redacts explicit provided secret keys", () => {
    const customKey = "AQ.Ab8RN6Jl_secret12345";
    const text = `Error connecting with ${customKey}`;
    const redacted = redactSecrets(text, [customKey]);
    expect(redacted).not.toContain(customKey);
    expect(redacted).toContain("[REDACTED_SECRET]");
  });
});
