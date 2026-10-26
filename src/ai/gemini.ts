import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { AIProvider, ConnectivityResult } from "./provider.js";
import type { ActionPlan, AIPlanningContext } from "./types.js";
import { ActionPlanSchema } from "./schemas.js";
import { redactSecrets } from "../utils/redactor.js";
import { DEFAULT_CONFIG } from "../config/index.js";

export type GeminiErrorCategory =
  | "missing_key"
  | "auth"
  | "model_not_found"
  | "daily_quota_exhausted"
  | "rate_limit"
  | "unavailable"
  | "timeout"
  | "network"
  | "validation"
  | "unknown";

export interface ClassifiedGeminiError {
  category: GeminiErrorCategory;
  isRetryable: boolean;
  message: string;
  originalError: unknown;
}

export function formatTimeoutDuration(ms: number): string {
  if (ms >= 1000 && ms % 1000 === 0) {
    const s = ms / 1000;
    return `${s} second${s === 1 ? "" : "s"}`;
  }
  return `${ms}ms`;
}

export function classifyGeminiError(
  err: unknown,
  model: string,
  timeoutMs: number,
  apiKey?: string,
): ClassifiedGeminiError {
  // Check for missing key upfront
  if (!apiKey || apiKey.trim().length === 0) {
    return {
      category: "missing_key",
      isRetryable: false,
      message:
        "Gemini API key is not configured.\n" +
        "To configure your personal API key, run: cmdf config set-key\n" +
        'Or set an environment variable: GEMINI_API_KEY="your_key"\n' +
        "Get a free Gemini API key from Google AI Studio: https://aistudio.google.com/apikey",
      originalError: err,
    };
  }

  const rawMsg =
    err instanceof Error
      ? err.message
      : typeof (err as { message?: unknown })?.message === "string"
        ? ((err as { message: string }).message as string)
        : String(err);
  const status =
    typeof (err as { status?: number })?.status === "number"
      ? (err as { status?: number }).status
      : undefined;

  // Redact any raw secrets from error messages
  const cleanMsg = redactSecrets(rawMsg, apiKey ? [apiKey] : []);
  const lowerMsg = cleanMsg.toLowerCase();

  // 1. Model Not Found / Unavailable / Unsupported (Check before auth to catch 404 model errors cleanly)
  const isModelUnavailable =
    status === 404 ||
    lowerMsg.includes("not found") ||
    lowerMsg.includes("not_found") ||
    lowerMsg.includes("is no longer available") ||
    lowerMsg.includes("unsupported model") ||
    lowerMsg.includes("model not found") ||
    lowerMsg.includes("invalid model") ||
    (lowerMsg.includes("model") &&
      (lowerMsg.includes("unsupported") ||
        lowerMsg.includes("unavailable") ||
        lowerMsg.includes("inaccessible") ||
        lowerMsg.includes("does not exist")));

  if (isModelUnavailable) {
    return {
      category: "model_not_found",
      isRetryable: false,
      message:
        `The configured Gemini model "${model}" is unavailable or unsupported.\n\n` +
        "Check that your model ID is supported by your Gemini API key and current API access.\n" +
        "You can change the model using:\n" +
        "cmdf config set model <model-id>\n\n" +
        "Then retry your command.",
      originalError: err,
    };
  }

  // 2. Authentication / Permissions
  if (
    status === 401 ||
    status === 403 ||
    cleanMsg.includes("API_KEY_INVALID") ||
    cleanMsg.includes("API key not valid") ||
    cleanMsg.includes("PERMISSION_DENIED") ||
    cleanMsg.includes("UNAUTHENTICATED")
  ) {
    return {
      category: "auth",
      isRetryable: false,
      message:
        "Invalid or unauthorized Gemini API key.\n" +
        "Please verify your configured API key and its access permissions.\n" +
        "You can update your key using 'cmdf config set-key' or verify your GEMINI_API_KEY environment variable.\n" +
        "Manage or generate your API key at: https://aistudio.google.com/apikey",
      originalError: err,
    };
  }

  // 3. API Quota & Rate Limit (429, RESOURCE_EXHAUSTED)
  if (
    status === 429 ||
    cleanMsg.includes("RESOURCE_EXHAUSTED") ||
    lowerMsg.includes("rate limit") ||
    lowerMsg.includes("quota exceeded") ||
    lowerMsg.includes("too many requests")
  ) {
    const isDaily =
      lowerMsg.includes("per day") ||
      lowerMsg.includes("daily") ||
      cleanMsg.includes("free_tier_requests_per_day") ||
      cleanMsg.includes("generate_content_free_tier_requests") ||
      lowerMsg.includes("limit exceeded on free tier");

    if (isDaily) {
      return {
        category: "daily_quota_exhausted",
        isRetryable: false,
        message:
          `Your daily Gemini API quota has been exhausted for model "${model}" (429 RESOURCE_EXHAUSTED).\n` +
          "Retrying will not resolve this until your daily quota resets in Google AI Studio.\n\n" +
          "Recommendations:\n" +
          "  1. Check your Gemini API quota and billing settings at: https://aistudio.google.com/\n" +
          "  2. Switch to an alternate model (e.g. gemini-3.5-flash) using: cmdf config set model <model-id>\n" +
          "  3. Wait for your daily quota to reset.\n" +
          "  4. Learn more about Gemini rate limits: https://ai.google.dev/gemini-api/docs/rate-limits",
        originalError: err,
      };
    }

    return {
      category: "rate_limit",
      isRetryable: true,
      message:
        "Gemini API rate limit or quota exceeded (429 RESOURCE_EXHAUSTED).\n" +
        "Your project's per-minute request limit has been reached.\n" +
        "Please check your Gemini API quota and billing settings at: https://aistudio.google.com/\n" +
        "Wait a moment before retrying temporary rate limits.\n" +
        "Learn more about Gemini rate limits: https://ai.google.dev/gemini-api/docs/rate-limits",
      originalError: err,
    };
  }

  // 4. Timeouts & Deadlines
  const isTimeout =
    status === 504 ||
    cleanMsg.includes("DEADLINE_EXCEEDED") ||
    lowerMsg.includes("timed out") ||
    lowerMsg.includes("deadline expired") ||
    lowerMsg.includes("request timeout");

  if (isTimeout) {
    const durationStr = formatTimeoutDuration(timeoutMs);
    const suggestedTimeoutMs = timeoutMs < 60000 ? 60000 : timeoutMs + 30000;

    return {
      category: "timeout",
      isRetryable: true,
      message:
        `Gemini planning request timed out after ${durationStr}.\n` +
        "The AI provider may be experiencing latency.\n" +
        "Try again or increase the timeout using:\n" +
        `cmdf config set timeoutMs ${suggestedTimeoutMs}`,
      originalError: err,
    };
  }

  // 5. Service High Demand / Unavailable
  if (
    status === 503 ||
    status === 502 ||
    status === 500 ||
    cleanMsg.includes("UNAVAILABLE") ||
    lowerMsg.includes("high demand") ||
    lowerMsg.includes("overloaded") ||
    lowerMsg.includes("service unavailable")
  ) {
    return {
      category: "unavailable",
      isRetryable: true,
      message:
        `Gemini model "${model}" is currently experiencing temporary high demand (${status ?? "503"} UNAVAILABLE).\n` +
        "Spikes in demand are usually temporary. Please try again in a few moments, or switch to an alternate model using: cmdf config set model <model-id>",
      originalError: err,
    };
  }

  // 6. Network connectivity failures
  if (
    cleanMsg.includes("ENOTFOUND") ||
    cleanMsg.includes("ECONNRESET") ||
    cleanMsg.includes("ECONNREFUSED") ||
    cleanMsg.includes("ETIMEDOUT") ||
    lowerMsg.includes("fetch failed") ||
    lowerMsg.includes("network error") ||
    lowerMsg.includes("networkerror")
  ) {
    return {
      category: "network",
      isRetryable: true,
      message:
        "Network error connecting to Gemini API.\n" +
        "A network failure may be responsible. Please check your internet connection and network connectivity.",
      originalError: err,
    };
  }

  // 7. Schema / Parsing failures
  if (
    err instanceof z.ZodError ||
    (err as { name?: string })?.name === "ZodError" ||
    cleanMsg.includes("ZodError") ||
    cleanMsg.includes("invalid_type") ||
    cleanMsg.includes("JSON")
  ) {
    let details = cleanMsg;
    if (err instanceof z.ZodError) {
      details = err.issues
        .map((issue) => `[${issue.path.join(".") || "root"}]: ${issue.message}`)
        .join("; ");
    }
    return {
      category: "validation",
      isRetryable: true,
      message: `Failed to parse AI response into structured plan: ${details}`,
      originalError: err,
    };
  }

  // Default fallback
  return {
    category: "unknown",
    isRetryable: false,
    message: `Gemini API error: ${cleanMsg}`,
    originalError: err,
  };
}

export class GeminiAIProvider implements AIProvider {
  name = "gemini";
  private client: GoogleGenAI | null = null;
  private apiKey?: string;
  private model: string;
  private timeoutMs: number;

  constructor(
    apiKey?: string,
    model: string = DEFAULT_CONFIG.model,
    timeoutMs: number = DEFAULT_CONFIG.timeoutMs,
    clientOverride?: unknown,
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
    if (clientOverride) {
      this.client = clientOverride as GoogleGenAI;
    } else if (this.apiKey) {
      // Pass httpOptions.timeout so the official SDK enforces deadline natively
      this.client = new GoogleGenAI({
        apiKey: this.apiKey,
        httpOptions: { timeout: this.timeoutMs },
      });
    }
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  /**
   * Safe live API connectivity check for cmdf doctor.
   * Tests authentication, model availability, and actual generation capability
   * using a minimal generateContent probe without executing commands or generating large outputs.
   */
  async testConnectivity(
    timeoutMsOverride?: number,
  ): Promise<ConnectivityResult> {
    if (!this.client || !this.apiKey) {
      return {
        ok: false,
        latencyMs: 0,
        model: this.model,
        message:
          "GEMINI_API_KEY is not configured. Add your key to .env (https://aistudio.google.com/)",
        error: "Missing API Key",
      };
    }

    const startTime = Date.now();
    const abortController = new AbortController();
    let timerId: NodeJS.Timeout | null = null;
    let requestCompleted = false;
    const testTimeoutMs = timeoutMsOverride ?? this.timeoutMs;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timerId = setTimeout(() => {
          if (!requestCompleted && !abortController.signal.aborted) {
            try {
              abortController.abort();
            } catch {
              // Ignore
            }
          }
          reject(
            new Error(
              `Doctor connectivity check timed out after ${testTimeoutMs}ms`,
            ),
          );
        }, testTimeoutMs);
      });

      const config: Record<string, unknown> = {
        maxOutputTokens: 5,
        abortSignal: abortController.signal,
      };

      if (this.model.includes("3.8") || this.model.includes("thinking")) {
        config.thinkingConfig = {
          thinkingLevel: "low",
        };
      }

      const checkPromise = this.client.models.generateContent({
        model: this.model,
        contents: "ping",
        config,
      });

      await Promise.race([checkPromise, timeoutPromise]).finally(() => {
        if (timerId !== null) clearTimeout(timerId);
      });
      requestCompleted = true;

      const latencyMs = Date.now() - startTime;
      return {
        ok: true,
        latencyMs,
        model: this.model,
        message: `Successfully connected to Gemini API (${this.model}, ${latencyMs}ms)`,
      };
    } catch (err: unknown) {
      if (!requestCompleted && !abortController.signal.aborted) {
        try {
          abortController.abort();
        } catch {
          // Ignore
        }
      }
      const latencyMs = Date.now() - startTime;
      const classified = classifyGeminiError(
        err,
        this.model,
        testTimeoutMs,
        this.apiKey,
      );
      return {
        ok: false,
        latencyMs,
        model: this.model,
        message: classified.message,
        error: classified.message,
      };
    }
  }

  private buildSystemPrompt(context: AIPlanningContext): string {
    return `You are the AI planning engine of cmdf, a cross-platform, secure natural language terminal assistant.
Your job is to translate user natural-language instructions into strict JSON structured action plans.

Current Environment:
- Host Operating System: ${context.os}
- Active Shell: ${context.shell}
- Approved Workspace Root: ${context.workspace}

CRITICAL RULES:
1. Output ONLY valid JSON matching the exact schema below. No conversational markdown, no code blocks, no backticks.
2. Safety is top priority:
   - Categorize actions as 'read-only', 'modifying', or 'destructive'.
   - NEVER invent missing filenames or targets. If a user says "create folder" or "make file" without specifying a name, set requiresClarification: true and ask a concise clarificationQuestion. If requiresClarification is false, set clarificationQuestion to null.
   - For irreversible operations (like deletion or reset), mark risk as 'destructive'.
   - All paths must stay inside the approved workspace.
3. Supported action types:
   - list_files (path, includeHidden)
   - create_directory (path)
   - create_file (path, content, overwrite)
   - read_file (path, maxLines)
   - move (source, destination)
   - rename (source, destination)
   - copy (source, destination)
   - delete_file (path)
   - search_files (path, pattern)
   - search_content (path, query, extension)
   - git_init (path)
   - git_status (path)
   - git_log (path, count)
   - npm_install (packages, dev)
   - npm_run (script)
   - shell_command (command, explanation) - ONLY when no native action exists.

JSON Output Format:
{
  "intent": string,
  "assumptions": string[],
  "steps": [
    {
      "id": 1,
      "action": { "type": "...", "description": "...", ... },
      "risk": "read-only" | "modifying" | "destructive",
      "explanation": string,
      "affectsData": boolean,
      "targetPaths": string[]
    }
  ],
  "overallRisk": "read-only" | "modifying" | "destructive",
  "summary": string,
  "requiresClarification": boolean,
  "clarificationQuestion": string | null
}`;
  }

  async generatePlan(
    prompt: string,
    context: AIPlanningContext,
  ): Promise<ActionPlan> {
    if (!this.client || !this.apiKey) {
      throw new Error(
        "Gemini API key is not configured.\n" +
          "Please set your GEMINI_API_KEY in a local .env file or environment variable.\n" +
          "Get your API key at: https://aistudio.google.com/",
      );
    }

    const systemPrompt = this.buildSystemPrompt(context);
    const userPrompt = `User Request: "${prompt}"\nGenerate the structured JSON action plan.`;

    const overallDeadline = Date.now() + this.timeoutMs;
    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1 && Date.now() >= overallDeadline) {
        break; // Overall deadline budget exhausted
      }

      const remainingTotalMs = overallDeadline - Date.now();
      const attemptTimeoutMs =
        attempt === 1
          ? this.timeoutMs
          : Math.max(50, Math.min(remainingTotalMs, this.timeoutMs));

      const abortController = new AbortController();
      let timerId: NodeJS.Timeout | null = null;
      let requestCompleted = false;

      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timerId = setTimeout(() => {
            if (!requestCompleted && !abortController.signal.aborted) {
              try {
                abortController.abort();
              } catch {
                // Ignore
              }
            }
            reject(
              new Error(`AI request timed out after ${attemptTimeoutMs}ms`),
            );
          }, attemptTimeoutMs);
        });

        const config: Record<string, unknown> = {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          abortSignal: abortController.signal,
        };

        // For models that support thinking (e.g. gemini-3.8-flash), set low thinkingLevel to minimize reasoning latency
        if (this.model.includes("3.8") || this.model.includes("thinking")) {
          config.thinkingConfig = {
            thinkingLevel: "low",
          };
        }

        const t0 = Date.now();
        const apiPromise = this.client.models.generateContent({
          model: this.model,
          contents: userPrompt,
          config,
        });

        const response = await Promise.race([
          apiPromise,
          timeoutPromise,
        ]).finally(() => {
          if (timerId !== null) {
            clearTimeout(timerId);
            timerId = null;
          }
        });
        requestCompleted = true;

        const apiDurationMs = Date.now() - t0;
        const responseText = response.text?.trim() || "";
        if (!responseText) {
          throw new Error("Received empty response from Gemini API");
        }

        const tParse = Date.now();
        // Clean any stray markdown formatting
        const cleanJson = responseText
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/```$/i, "")
          .trim();

        const parsedJson = JSON.parse(cleanJson);
        const validatedPlan = ActionPlanSchema.parse(parsedJson);
        const parseDurationMs = Date.now() - tParse;

        if (process.env.CMDF_DEBUG) {
          console.error(
            `[cmdf-debug] API Latency: ${apiDurationMs}ms | Parse & Validate: ${parseDurationMs}ms`,
          );
        }

        return validatedPlan;
      } catch (err: unknown) {
        if (!requestCompleted && !abortController.signal.aborted) {
          try {
            abortController.abort();
          } catch {
            // Ignore
          }
        }
        lastError = err;
        const classified = classifyGeminiError(
          err,
          this.model,
          this.timeoutMs,
          this.apiKey,
        );

        // Bounded retry with backoff only for retryable errors if budget remains
        const timeRemaining = overallDeadline - Date.now();
        if (
          classified.isRetryable &&
          attempt < maxAttempts &&
          timeRemaining > 0
        ) {
          // If request already timed out, do not retry if insufficient budget remains
          if (classified.category === "timeout" && timeRemaining < 3000) {
            throw new Error(`AI planning failed:\n${classified.message}`);
          }

          const backoffDelay = Math.min(
            200 * Math.pow(2, attempt - 1),
            Math.max(0, timeRemaining - 50),
          );

          if (backoffDelay > 0) {
            await new Promise((resolve) => setTimeout(resolve, backoffDelay));
          }
          continue;
        }

        // Non-retryable error (e.g. auth, daily quota, model not found) or budget exhausted
        throw new Error(`AI planning failed:\n${classified.message}`);
      }
    }

    const finalClassified = classifyGeminiError(
      lastError,
      this.model,
      this.timeoutMs,
      this.apiKey,
    );
    throw new Error(`AI planning failed:\n${finalClassified.message}`);
  }

  async explainCommand(command: string): Promise<string> {
    if (!this.client || !this.apiKey) {
      throw new Error(
        "Gemini API key is not configured.\n" +
          "Set your GEMINI_API_KEY in .env to enable AI command explanations.",
      );
    }

    const prompt = `You are a developer security assistant in cmdf.
Explain the following shell command clearly, objectively, and concisely without executing it.
Highlight what each flag does, what files it touches, whether it is destructive, and suggest safe alternatives if risky.

Command:
\`\`\`
${command}
\`\`\`
`;

    const abortController = new AbortController();
    let timerId: NodeJS.Timeout | null = null;
    let requestCompleted = false;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timerId = setTimeout(() => {
          if (!requestCompleted && !abortController.signal.aborted) {
            try {
              abortController.abort();
            } catch {
              // Ignore
            }
          }
          reject(
            new Error(`Explain request timed out after ${this.timeoutMs}ms`),
          );
        }, this.timeoutMs);
      });

      const config: Record<string, unknown> = {
        abortSignal: abortController.signal,
      };

      if (this.model.includes("3.8") || this.model.includes("thinking")) {
        config.thinkingConfig = {
          thinkingLevel: "low",
        };
      }

      const apiPromise = this.client.models.generateContent({
        model: this.model,
        contents: prompt,
        config,
      });

      const response = await Promise.race([apiPromise, timeoutPromise]).finally(
        () => {
          if (timerId !== null) {
            clearTimeout(timerId);
            timerId = null;
          }
        },
      );
      requestCompleted = true;

      return response.text?.trim() || "No explanation generated.";
    } catch (err: unknown) {
      if (!requestCompleted && !abortController.signal.aborted) {
        try {
          abortController.abort();
        } catch {
          // Ignore
        }
      }
      const classified = classifyGeminiError(
        err,
        this.model,
        this.timeoutMs,
        this.apiKey,
      );
      throw new Error(`Failed to explain command:\n${classified.message}`);
    }
  }
}
