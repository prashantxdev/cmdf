import { describe, it, expect, vi } from "vitest";
import { GeminiAIProvider, classifyGeminiError } from "../src/ai/gemini.js";
import type { AIPlanningContext } from "../src/ai/types.js";

describe("GeminiAIProvider Error Classification & Actions", () => {
  const dummyKey = "AQ.TestSecretKey1234567890ABCDEF";

  it("classifies authentication errors as non-retryable with actionable guidance", () => {
    const authErr = {
      status: 401,
      message: `API_KEY_INVALID: Key ${dummyKey} is not valid`,
    };
    const classified = classifyGeminiError(
      authErr,
      "gemini-3.8-flash",
      30000,
      dummyKey,
    );

    expect(classified.category).toBe("auth");
    expect(classified.isRetryable).toBe(false);
    expect(classified.message).toContain(
      "Invalid or unauthorized Gemini API key",
    );
    expect(classified.message).not.toContain(dummyKey);
  });

  it("classifies missing model as non-retryable 404 with guidance", () => {
    const notFoundErr = {
      status: 404,
      message: "models/gemini-invalid is not found",
    };
    const classified = classifyGeminiError(
      notFoundErr,
      "gemini-invalid",
      30000,
      dummyKey,
    );

    expect(classified.category).toBe("model_not_found");
    expect(classified.isRetryable).toBe(false);
    expect(classified.message).toContain(
      'Gemini model "gemini-invalid" was not found',
    );
  });

  it("classifies 429 rate limit errors as retryable with quota advice", () => {
    const rateLimitErr = {
      status: 429,
      message: "Quota exceeded: RESOURCE_EXHAUSTED",
    };
    const classified = classifyGeminiError(
      rateLimitErr,
      "gemini-3.8-flash",
      30000,
      dummyKey,
    );

    expect(classified.category).toBe("rate_limit");
    expect(classified.isRetryable).toBe(true);
    expect(classified.message).toContain("rate limit or quota exceeded");
  });

  it("classifies daily quota exhaustion as non-retryable with model switch remedy", () => {
    const dailyErr = {
      status: 429,
      message:
        "Generate content requests per day limit exceeded on Free Tier. model: gemini-3.8-flash",
    };
    const classified = classifyGeminiError(
      dailyErr,
      "gemini-3.8-flash",
      30000,
      dummyKey,
    );

    expect(classified.category).toBe("daily_quota_exhausted");
    expect(classified.isRetryable).toBe(false);
    expect(classified.message).toContain("daily Gemini API quota has been exhausted");
    expect(classified.message).toContain("gemini-3.5-flash");
  });

  it("classifies 503 high demand spikes as retryable", () => {
    const highDemandErr = {
      status: 503,
      message:
        "This model is currently experiencing high demand. Spikes in demand are usually temporary.",
    };
    const classified = classifyGeminiError(
      highDemandErr,
      "gemini-3.8-flash",
      30000,
      dummyKey,
    );

    expect(classified.category).toBe("unavailable");
    expect(classified.isRetryable).toBe(true);
    expect(classified.message).toContain("temporary high demand");
  });

  it("classifies network errors as retryable with connectivity message", () => {
    const netErr = new Error("fetch failed: ECONNRESET");
    const classified = classifyGeminiError(
      netErr,
      "gemini-3.8-flash",
      30000,
      dummyKey,
    );

    expect(classified.category).toBe("network");
    expect(classified.isRetryable).toBe(true);
    expect(classified.message).toContain(
      "Network error connecting to Gemini API",
    );
  });

  it("classifies timeouts as retryable and suggests setting GEMINI_TIMEOUT_MS", () => {
    const timeoutErr = new Error("AI request timed out after 30000ms");
    const classified = classifyGeminiError(
      timeoutErr,
      "gemini-3.8-flash",
      30000,
      dummyKey,
    );

    expect(classified.category).toBe("timeout");
    expect(classified.isRetryable).toBe(true);
    expect(classified.message).toContain("timed out after 30000ms");
    expect(classified.message).toContain("GEMINI_TIMEOUT_MS");
  });
});

describe("GeminiAIProvider with Mocked Client", () => {
  const dummyKey = "AQ.TestKeyMocked123456789";
  const dummyContext: AIPlanningContext = {
    os: "windows",
    shell: "powershell",
    workspace: process.cwd(),
  };

  it("handles client timeouts cleanly and clears timers", async () => {
    // Mock client that hangs indefinitely
    const hangingClient = {
      models: {
        generateContent: vi.fn().mockImplementation(() => {
          return new Promise((resolve) => setTimeout(resolve, 5000));
        }),
      },
    };

    // Provider with very short timeout for fast deterministic test
    const provider = new GeminiAIProvider(
      dummyKey,
      "gemini-3.8-flash",
      50,
      hangingClient,
    );

    await expect(
      provider.generatePlan("test prompt", dummyContext),
    ).rejects.toThrow(/timed out after 50ms/);
  });

  it("aborts immediately without retries when authentication fails", async () => {
    const authSpy = vi.fn().mockRejectedValue({
      status: 401,
      message: "API_KEY_INVALID",
    });

    const mockClient = {
      models: {
        generateContent: authSpy,
      },
    };

    const provider = new GeminiAIProvider(
      dummyKey,
      "gemini-3.8-flash",
      5000,
      mockClient,
    );

    await expect(
      provider.generatePlan("test prompt", dummyContext),
    ).rejects.toThrow(/Invalid or unauthorized Gemini API key/);

    // Should only be called ONCE (non-retryable)
    expect(authSpy).toHaveBeenCalledTimes(1);
  });

  it("aborts immediately without retries when model is not found", async () => {
    const modelSpy = vi.fn().mockRejectedValue({
      status: 404,
      message: "models/gemini-unknown is not found",
    });

    const mockClient = {
      models: {
        generateContent: modelSpy,
      },
    };

    const provider = new GeminiAIProvider(
      dummyKey,
      "gemini-unknown",
      5000,
      mockClient,
    );

    await expect(
      provider.generatePlan("test prompt", dummyContext),
    ).rejects.toThrow(/was not found or is not available/);

    expect(modelSpy).toHaveBeenCalledTimes(1);
  });

  it("retries transient rate-limit errors and reports distinct message", async () => {
    const rateSpy = vi.fn().mockRejectedValue({
      status: 429,
      message: "RESOURCE_EXHAUSTED",
    });

    const mockClient = {
      models: {
        generateContent: rateSpy,
      },
    };

    const provider = new GeminiAIProvider(
      dummyKey,
      "gemini-3.8-flash",
      5000,
      mockClient,
    );

    await expect(
      provider.generatePlan("test prompt", dummyContext),
    ).rejects.toThrow(/rate limit or quota exceeded/);

    // Retries 3 times before failing
    expect(rateSpy).toHaveBeenCalledTimes(3);
  });

  it("returns validated ActionPlan on successful response", async () => {
    const validPlanJson = JSON.stringify({
      intent: "Find all files",
      assumptions: [],
      steps: [
        {
          id: 1,
          action: {
            type: "list_files",
            path: ".",
            includeHidden: false,
            description: "List all files in workspace",
          },
          risk: "read-only",
          explanation: "Reads directory tree",
          affectsData: false,
          targetPaths: ["."],
        },
      ],
      overallRisk: "read-only",
      summary: "Lists all files in current workspace",
      requiresClarification: false,
    });

    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: validPlanJson,
        }),
      },
    };

    const provider = new GeminiAIProvider(
      dummyKey,
      "gemini-3.8-flash",
      5000,
      mockClient,
    );

    const plan = await provider.generatePlan("find all files", dummyContext);
    expect(plan.intent).toBe("Find all files");
    expect(plan.overallRisk).toBe("read-only");
    expect(plan.steps).toHaveLength(1);
  });

  it("testConnectivity succeeds when minimal generation probe succeeds", async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({ text: "pong" }),
      },
    };

    const provider = new GeminiAIProvider(
      dummyKey,
      "gemini-3.8-flash",
      5000,
      mockClient,
    );

    const result = await provider.testConnectivity();
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Successfully connected to Gemini API");
  });

  it("testConnectivity fails with classified message when authentication fails", async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockRejectedValue({
          status: 401,
          message: "API_KEY_INVALID",
        }),
      },
    };

    const provider = new GeminiAIProvider(
      dummyKey,
      "gemini-3.8-flash",
      5000,
      mockClient,
    );

    const result = await provider.testConnectivity();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Invalid or unauthorized Gemini API key");
  });

  it("testConnectivity fails and advises switching models when daily quota is exhausted", async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockRejectedValue({
          status: 429,
          message:
            "Generate content requests per day limit exceeded on Free Tier. model: gemini-3.8-flash",
        }),
      },
    };

    const provider = new GeminiAIProvider(
      dummyKey,
      "gemini-3.8-flash",
      5000,
      mockClient,
    );

    const result = await provider.testConnectivity();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("daily Gemini API quota has been exhausted");
    expect(result.message).toContain("gemini-3.5-flash");
  });

  it("handles clarificationQuestion: null response cleanly (gemini-3.5-flash-lite regression)", async () => {
    const rawResponse = JSON.stringify({
      intent: "Create a folder named DEMO",
      assumptions: ["The folder should be created in the current directory"],
      steps: [
        {
          id: 1,
          action: {
            type: "create_directory",
            path: "DEMO",
            description: "Creates a new folder named DEMO",
          },
          risk: "modifying",
          explanation: "Creates directory DEMO in the current workspace",
          affectsData: true,
          targetPaths: ["DEMO"],
        },
      ],
      overallRisk: "modifying",
      summary: "Create a directory named DEMO",
      requiresClarification: false,
      clarificationQuestion: null,
    });

    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({ text: rawResponse }),
      },
    };

    const provider = new GeminiAIProvider(
      dummyKey,
      "gemini-3.5-flash-lite",
      5000,
      mockClient,
    );

    const plan = await provider.generatePlan(
      "create a folder named DEMO",
      dummyContext,
    );
    expect(plan.intent).toBe("Create a folder named DEMO");
    expect(plan.requiresClarification).toBe(false);
    expect(plan.clarificationQuestion).toBeNull();
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].action.type).toBe("create_directory");
  });

  it("handles valid clarification question when clarification is needed", async () => {
    const rawResponse = JSON.stringify({
      intent: "Create a folder",
      assumptions: [],
      steps: [],
      overallRisk: "read-only",
      summary: "Folder name missing",
      requiresClarification: true,
      clarificationQuestion: "What should the folder be named?",
    });

    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({ text: rawResponse }),
      },
    };

    const provider = new GeminiAIProvider(
      dummyKey,
      "gemini-3.5-flash-lite",
      5000,
      mockClient,
    );

    const plan = await provider.generatePlan("create a folder", dummyContext);
    expect(plan.requiresClarification).toBe(true);
    expect(plan.clarificationQuestion).toBe("What should the folder be named?");
  });

  it("rejects when requiresClarification is true but clarificationQuestion is null", async () => {
    const invalidResponse = JSON.stringify({
      intent: "Create a folder",
      assumptions: [],
      steps: [],
      overallRisk: "read-only",
      summary: "Clarification required",
      requiresClarification: true,
      clarificationQuestion: null,
    });

    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({ text: invalidResponse }),
      },
    };

    const provider = new GeminiAIProvider(
      dummyKey,
      "gemini-3.5-flash-lite",
      5000,
      mockClient,
    );

    await expect(
      provider.generatePlan("create a folder", dummyContext),
    ).rejects.toThrow(/A non-empty clarificationQuestion is required/);
  });

  it("formats malformed model response errors cleanly with field path", async () => {
    const malformedResponse = JSON.stringify({
      intent: 12345, // invalid type
      steps: [],
      overallRisk: "invalid_risk",
      summary: "summary",
    });

    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({ text: malformedResponse }),
      },
    };

    const provider = new GeminiAIProvider(
      dummyKey,
      "gemini-3.5-flash-lite",
      5000,
      mockClient,
    );

    await expect(
      provider.generatePlan("test prompt", dummyContext),
    ).rejects.toThrow(/Failed to parse AI response into structured plan/);
  });

  it("does not abort already-completed requests during validation failures", async () => {
    let capturedSignal: AbortSignal | undefined;
    const invalidResponse = "NOT VALID JSON";

    const mockClient = {
      models: {
        generateContent: vi.fn().mockImplementation(({ config }) => {
          capturedSignal = config?.abortSignal;
          return Promise.resolve({ text: invalidResponse });
        }),
      },
    };

    const provider = new GeminiAIProvider(
      dummyKey,
      "gemini-3.5-flash-lite",
      5000,
      mockClient,
    );

    await expect(
      provider.generatePlan("test prompt", dummyContext),
    ).rejects.toThrow(/Failed to parse AI response/);

    // Because the HTTP request finished, signal must NOT have been aborted after the fact
    expect(capturedSignal?.aborted).toBe(false);
  });
});
