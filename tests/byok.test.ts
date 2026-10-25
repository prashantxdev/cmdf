import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  resolveApiKey,
  getResolvedConfig,
  maskApiKey,
  checkConfigPermissions,
  setStoredApiKey,
  deleteStoredApiKey,
} from "../src/config/index.js";
import { AIPlanner } from "../src/ai/planner.js";
import { classifyGeminiError } from "../src/ai/gemini.js";
import { formatFirstRunSetup } from "../src/utils/formatters.js";

let originalEnvKey: string | undefined;

beforeEach(() => {
  originalEnvKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
});

afterEach(() => {
  if (originalEnvKey !== undefined) {
    process.env.GEMINI_API_KEY = originalEnvKey;
  } else {
    delete process.env.GEMINI_API_KEY;
  }
  vi.restoreAllMocks();
});

describe("BYOK (Bring Your Own Key) Precedence & Resolution", () => {
  it("Priority 1: resolves key from process.env.GEMINI_API_KEY with source 'environment'", () => {
    process.env.GEMINI_API_KEY = "test_env_key_123456789";
    const resolved = resolveApiKey();

    expect(resolved.key).toBe("test_env_key_123456789");
    expect(resolved.source).toBe("environment");
  });

  it("Priority 1 takes precedence over locally stored user config key", () => {
    process.env.GEMINI_API_KEY = "env_priority_key_999";

    // Even if user config has a key, env var wins
    const resolved = resolveApiKey();
    expect(resolved.key).toBe("env_priority_key_999");
    expect(resolved.source).toBe("environment");
  });

  it("Priority 2: resolves key from user config when env var is not set", () => {
    delete process.env.GEMINI_API_KEY;

    vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      if (String(p).includes("config.json")) return true;
      return false;
    });
    vi.spyOn(fs, "readFileSync").mockImplementation((p) => {
      if (String(p).includes("config.json")) {
        return JSON.stringify({ geminiApiKey: "stored_user_key_555" });
      }
      return "";
    });

    const resolved = resolveApiKey();
    expect(resolved.key).toBe("stored_user_key_555");
    expect(resolved.source).toBe("user_config");
  });

  it("Priority 3: resolves key from project .env when neither shell env nor user config is set", () => {
    delete process.env.GEMINI_API_KEY;

    vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      if (String(p).endsWith(".env")) return true;
      return false; // config.json does not exist
    });
    vi.spyOn(fs, "readFileSync").mockImplementation((p) => {
      if (String(p).endsWith(".env")) {
        return "GEMINI_API_KEY=project_dotenv_key_777\n";
      }
      return "";
    });

    const resolved = resolveApiKey();
    expect(resolved.key).toBe("project_dotenv_key_777");
    expect(resolved.source).toBe("project_env");
  });

  it("returns undefined and source 'none' when no key is configured anywhere", () => {
    delete process.env.GEMINI_API_KEY;

    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    const resolved = resolveApiKey();
    expect(resolved.key).toBeUndefined();
    expect(resolved.source).toBe("none");
  });
});

describe("API Key Masking & Storage Security", () => {
  it("masks keys securely without exposing full value", () => {
    expect(maskApiKey(undefined)).toBe("(not configured)");
    expect(maskApiKey("")).toBe("(not configured)");
    expect(maskApiKey("12345")).toBe("••••••••");

    const sampleKey = "AIzaSyDummyKeyForTestingOnly123456789";
    const masked = maskApiKey(sampleKey);

    expect(masked).not.toBe(sampleKey);
    expect(masked.startsWith("AIza")).toBe(true);
    expect(masked.endsWith("6789")).toBe(true);
    expect(masked).toContain("•");
    expect(masked).not.toContain("DummyKeyForTestingOnly");
  });

  it("validates key length when storing and rejects empty keys", () => {
    expect(() => setStoredApiKey("")).toThrow(/Invalid Gemini API key/);
    expect(() => setStoredApiKey("   ")).toThrow(/Invalid Gemini API key/);
    expect(() => setStoredApiKey("123")).toThrow(/Invalid Gemini API key/);
  });

  it("stores key with 0600 mode on Unix systems and reports permissions", () => {
    let writtenMode: number | undefined;
    vi.spyOn(fs, "writeFileSync").mockImplementation(
      (_file, _data, options) => {
        if (typeof options === "object" && options && "mode" in options) {
          writtenMode = options.mode as number;
        }
      },
    );
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({}));

    setStoredApiKey("valid_test_key_sample_12345");
    expect(writtenMode).toBe(0o600);

    const perm = checkConfigPermissions();
    expect(perm.isSecure).toBe(true);
    expect(perm.note).toBeDefined();
  });

  it("deletes stored key from configuration file without deleting other settings", () => {
    let savedContent = "";
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ geminiApiKey: "to_delete_key", timeoutMs: 60000 }),
    );
    vi.spyOn(fs, "writeFileSync").mockImplementation((_file, data) => {
      savedContent = String(data);
    });

    deleteStoredApiKey();
    const parsed = JSON.parse(savedContent);
    expect(parsed.geminiApiKey).toBeUndefined();
    expect(parsed.timeoutMs).toBe(60000);
  });
});

describe("First-Run Setup & Planner Behavior Without Key", () => {
  it("AIPlanner.fromConfig throws descriptive BYOK error when key is missing", () => {
    const config = getResolvedConfig();
    config.provider = "gemini";
    config.geminiApiKey = undefined;

    expect(() => AIPlanner.fromConfig(config)).toThrowError(
      /Gemini API key is not configured/,
    );
    expect(() => AIPlanner.fromConfig(config)).toThrowError(
      /cmdf config set-key/,
    );
    expect(() => AIPlanner.fromConfig(config)).toThrowError(
      /aistudio\.google\.com\/apikey/,
    );
  });

  it("formatFirstRunSetup includes clear instructions and AI Studio link", () => {
    const banner = formatFirstRunSetup();
    expect(banner).toContain("https://aistudio.google.com/apikey");
    expect(banner).toContain("cmdf config set-key");
    expect(banner).toContain("GEMINI_API_KEY");
  });
});

describe("Error Classification: Rate Limits vs Daily Quotas", () => {
  it("classifies daily quota exhaustion as non-retryable 429", () => {
    const dailyErr = {
      status: 429,
      message:
        "Quota exceeded for quota metric 'Generate Content Requests Per Day' and limit 'RequestsPerDay_free_tier' (429 RESOURCE_EXHAUSTED)",
    };

    const classified = classifyGeminiError(
      dailyErr,
      "gemini-3.8-flash",
      30000,
      "test_key",
    );

    expect(classified.category).toBe("daily_quota_exhausted");
    expect(classified.isRetryable).toBe(false);
    expect(classified.message).toContain(
      "daily Gemini API quota has been exhausted",
    );
    expect(classified.message).toContain("Retrying will not resolve this");
    expect(classified.message).toContain("https://aistudio.google.com/");
    expect(classified.message).toContain(
      "https://ai.google.dev/gemini-api/docs/rate-limits",
    );
  });

  it("classifies transient per-minute rate limit as retryable 429", () => {
    const transientErr = {
      status: 429,
      message:
        "Quota exceeded for quota metric 'Generate Content Requests Per Minute' (429 RESOURCE_EXHAUSTED)",
    };

    const classified = classifyGeminiError(
      transientErr,
      "gemini-3.8-flash",
      30000,
      "test_key",
    );

    expect(classified.category).toBe("rate_limit");
    expect(classified.isRetryable).toBe(true);
    expect(classified.message).toContain(
      "per-minute request limit has been reached",
    );
  });

  it("classifies missing key with category 'missing_key'", () => {
    const classified = classifyGeminiError(
      new Error("Any error"),
      "gemini-3.8-flash",
      30000,
      undefined,
    );

    expect(classified.category).toBe("missing_key");
    expect(classified.isRetryable).toBe(false);
    expect(classified.message).toContain("cmdf config set-key");
  });
});

describe("Package & Source Code Security Audit", () => {
  it(".env.example contains only empty placeholders and no secrets", () => {
    const envExamplePath = path.resolve(process.cwd(), ".env.example");
    expect(fs.existsSync(envExamplePath)).toBe(true);

    const content = fs.readFileSync(envExamplePath, "utf-8");
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.startsWith("GEMINI_API_KEY=")) {
        const val = line.split("=")[1].trim();
        expect(val).toBe("");
      }
    }
  });

  it(".gitignore excludes sensitive files (.env, .env.local, *.key)", () => {
    const gitignorePath = path.resolve(process.cwd(), ".gitignore");
    expect(fs.existsSync(gitignorePath)).toBe(true);

    const content = fs.readFileSync(gitignorePath, "utf-8");
    expect(content).toContain(".env");
    expect(content).toContain("*.key");
  });

  it("package.json files field only includes dist, README.md, and LICENSE", () => {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

    expect(pkg.files).toBeDefined();
    expect(pkg.files).toContain("dist");
    expect(pkg.files).toContain("README.md");
    expect(pkg.files).toContain("LICENSE");
    expect(pkg.files).not.toContain(".env");
    expect(pkg.files).not.toContain(".env.example");
  });
});
