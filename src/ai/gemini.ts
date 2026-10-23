import { GoogleGenAI } from "@google/genai";
import type { AIProvider } from "./provider.js";
import type { ActionPlan, AIPlanningContext } from "./types.js";
import { ActionPlanSchema } from "./schemas.js";

export class GeminiAIProvider implements AIProvider {
  name = "gemini";
  private client: GoogleGenAI | null = null;
  private apiKey?: string;
  private model: string;
  private timeoutMs: number;

  constructor(
    apiKey?: string,
    model: string = "gemini-3.8-flash",
    timeoutMs: number = 30000,
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
    if (this.apiKey) {
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
    }
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
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
   - NEVER invent missing filenames or targets. If a user says "create folder" or "make file" without specifying a name, set requiresClarification: true and ask a concise clarificationQuestion.
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
  "clarificationQuestion": string (optional)
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

    // Attempt with retry on transient errors (503 / 429)
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(`AI request timed out after ${this.timeoutMs}ms`),
              ),
            this.timeoutMs,
          ),
        );

        const apiPromise = this.client.models.generateContent({
          model: this.model,
          contents: userPrompt,
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: "application/json",
          },
        });

        const response = await Promise.race([apiPromise, timeoutPromise]);
        const responseText = response.text?.trim() || "";

        if (!responseText) {
          throw new Error("Received empty response from Gemini API");
        }

        // Clean any stray markdown formatting
        const cleanJson = responseText
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/```$/i, "")
          .trim();

        const parsedJson = JSON.parse(cleanJson);
        const validatedPlan = ActionPlanSchema.parse(parsedJson);
        return validatedPlan;
      } catch (err: unknown) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);

        // Check if retryable (503 high demand, 429 rate limit)
        if (
          (msg.includes("503") ||
            msg.includes("429") ||
            msg.includes("UNAVAILABLE")) &&
          attempt < 3
        ) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
          continue;
        }

        break;
      }
    }

    const errorDetails =
      lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`AI planning failed: ${errorDetails}`);
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

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: prompt,
      });

      return response.text?.trim() || "No explanation generated.";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to explain command: ${msg}`);
    }
  }
}
