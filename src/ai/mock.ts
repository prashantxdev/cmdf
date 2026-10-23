import type { AIProvider } from "./provider.js";
import type { ActionPlan, AIPlanningContext, PlanStep } from "./types.js";
import { ActionPlanSchema } from "./schemas.js";

export class MockAIProvider implements AIProvider {
  name = "mock";
  private customPlans = new Map<string, ActionPlan>();

  setMockPlan(queryPattern: string, plan: ActionPlan): void {
    this.customPlans.set(queryPattern.toLowerCase(), plan);
  }

  clearMockPlans(): void {
    this.customPlans.clear();
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async generatePlan(
    prompt: string,
    context: AIPlanningContext,
  ): Promise<ActionPlan> {
    const lower = prompt.trim().toLowerCase();

    // Check custom mock plans first
    for (const [pattern, plan] of this.customPlans.entries()) {
      if (lower.includes(pattern)) {
        return ActionPlanSchema.parse(plan);
      }
    }

    // Underspecified check: "create folder", "make directory", "new file" without target
    if (/^(create|make|new)\s+(folder|directory)\s*$/i.test(prompt.trim())) {
      return ActionPlanSchema.parse({
        intent: "Create directory",
        assumptions: [],
        steps: [],
        overallRisk: "modifying",
        summary: "Cannot proceed without target directory name",
        requiresClarification: true,
        clarificationQuestion: "What should the folder be named?",
      });
    }

    if (/^(create|make|new)\s+file\s*$/i.test(prompt.trim())) {
      return ActionPlanSchema.parse({
        intent: "Create file",
        assumptions: [],
        steps: [],
        overallRisk: "modifying",
        summary: "Cannot proceed without filename and destination",
        requiresClarification: true,
        clarificationQuestion:
          "What should the file be named and where should it be placed?",
      });
    }

    // "create a folder called X" / "make folder X"
    const createFolderMatch = prompt.match(
      /(?:create|make|new)\s+(?:a\s+)?(?:folder|directory)(?:\s+called|\s+named)?\s+([^\s,]+)/i,
    );
    if (createFolderMatch && createFolderMatch[1]) {
      const folderName = createFolderMatch[1].replace(/['"]/g, "");
      return ActionPlanSchema.parse({
        intent: `Create directory "${folderName}"`,
        assumptions: [`Directory will be created under ${context.workspace}`],
        steps: [
          {
            id: 1,
            action: {
              type: "create_directory",
              path: folderName,
              description: `Create directory "${folderName}"`,
            },
            risk: "modifying",
            explanation: `Creates folder "${folderName}" in the active workspace.`,
            affectsData: true,
            targetPaths: [folderName],
          },
        ],
        overallRisk: "modifying",
        summary: `Create directory "${folderName}"`,
      });
    }

    // "create src, tests, and docs folders"
    if (
      lower.includes("src") &&
      lower.includes("tests") &&
      lower.includes("docs")
    ) {
      return ActionPlanSchema.parse({
        intent: "Create standard project directories (src, tests, docs)",
        assumptions: ["Standard folder structure under workspace root"],
        steps: [
          {
            id: 1,
            action: {
              type: "create_directory",
              path: "src",
              description: "Create directory src",
            },
            risk: "modifying",
            explanation: "Creates src directory for source code",
            affectsData: true,
            targetPaths: ["src"],
          },
          {
            id: 2,
            action: {
              type: "create_directory",
              path: "tests",
              description: "Create directory tests",
            },
            risk: "modifying",
            explanation: "Creates tests directory for test suites",
            affectsData: true,
            targetPaths: ["tests"],
          },
          {
            id: 3,
            action: {
              type: "create_directory",
              path: "docs",
              description: "Create directory docs",
            },
            risk: "modifying",
            explanation: "Creates docs directory for documentation",
            affectsData: true,
            targetPaths: ["docs"],
          },
        ],
        overallRisk: "modifying",
        summary: "Creates src, tests, and docs folders",
      });
    }

    // "list all files" / "list files with details"
    if (
      lower.includes("list") &&
      (lower.includes("file") || lower.includes("dir"))
    ) {
      const includeHidden = lower.includes("hidden") || lower.includes("all");
      return ActionPlanSchema.parse({
        intent: "List files in workspace",
        assumptions: ["Target directory is workspace root"],
        steps: [
          {
            id: 1,
            action: {
              type: "list_files",
              path: ".",
              includeHidden,
              description: includeHidden
                ? "List all files including hidden"
                : "List files in workspace",
            },
            risk: "read-only",
            explanation:
              "Reads workspace directory contents without modifying any files.",
            affectsData: false,
            targetPaths: ["."],
          },
        ],
        overallRisk: "read-only",
        summary: "List files in current workspace",
      });
    }

    // "rename old.js to new.js"
    const renameMatch = prompt.match(/rename\s+([^\s]+)\s+to\s+([^\s]+)/i);
    if (renameMatch && renameMatch[1] && renameMatch[2]) {
      const source = renameMatch[1].replace(/['"]/g, "");
      const destination = renameMatch[2].replace(/['"]/g, "");
      return ActionPlanSchema.parse({
        intent: `Rename "${source}" to "${destination}"`,
        assumptions: [`Source file ${source} exists`],
        steps: [
          {
            id: 1,
            action: {
              type: "rename",
              source,
              destination,
              description: `Rename ${source} to ${destination}`,
            },
            risk: "modifying",
            explanation: `Renames file from ${source} to ${destination}.`,
            affectsData: true,
            targetPaths: [source, destination],
          },
        ],
        overallRisk: "modifying",
        summary: `Rename ${source} to ${destination}`,
      });
    }

    // "move X to Y"
    const moveMatch = prompt.match(/move\s+([^\s]+)\s+(?:to|into)\s+([^\s]+)/i);
    if (moveMatch && moveMatch[1] && moveMatch[2]) {
      const source = moveMatch[1].replace(/['"]/g, "");
      const destination = moveMatch[2].replace(/['"]/g, "");
      return ActionPlanSchema.parse({
        intent: `Move "${source}" to "${destination}"`,
        assumptions: [],
        steps: [
          {
            id: 1,
            action: {
              type: "move",
              source,
              destination,
              description: `Move ${source} to ${destination}`,
            },
            risk: "modifying",
            explanation: `Moves ${source} into ${destination}.`,
            affectsData: true,
            targetPaths: [source, destination],
          },
        ],
        overallRisk: "modifying",
        summary: `Move ${source} to ${destination}`,
      });
    }

    // "find all Java files" / "find files *.java"
    if (
      lower.includes("find") &&
      (lower.includes("java") || lower.includes(".java"))
    ) {
      return ActionPlanSchema.parse({
        intent: "Find Java files in workspace",
        assumptions: ["Search recursively under workspace root"],
        steps: [
          {
            id: 1,
            action: {
              type: "search_files",
              path: ".",
              pattern: "*.java",
              description: "Search for *.java files",
            },
            risk: "read-only",
            explanation:
              "Searches directory tree for filenames matching Java extension.",
            affectsData: false,
            targetPaths: ["."],
          },
        ],
        overallRisk: "read-only",
        summary: "Find all Java files in this project",
      });
    }

    // "find TODO comments in my source code"
    if (lower.includes("todo")) {
      return ActionPlanSchema.parse({
        intent: "Find TODO comments in source code",
        assumptions: ["Scan text files in workspace"],
        steps: [
          {
            id: 1,
            action: {
              type: "search_content",
              path: ".",
              query: "TODO",
              description: 'Search for "TODO" in files',
            },
            risk: "read-only",
            explanation: 'Searches file contents for the string "TODO".',
            affectsData: false,
            targetPaths: ["."],
          },
        ],
        overallRisk: "read-only",
        summary: "Find TODO comments in source files",
      });
    }

    // "initialize Git and create a gitignore file"
    if (
      lower.includes("git") &&
      (lower.includes("init") || lower.includes("initialize"))
    ) {
      const steps: PlanStep[] = [
        {
          id: 1,
          action: {
            type: "git_init",
            path: ".",
            description: "Initialize Git repository",
          },
          risk: "modifying",
          explanation: "Initializes a new Git version control repository.",
          affectsData: true,
          targetPaths: [".git"],
        },
      ];
      if (lower.includes("gitignore")) {
        steps.push({
          id: 2,
          action: {
            type: "create_file",
            path: ".gitignore",
            content: "node_modules/\ndist/\n.env\n*.log\n",
            description: "Create standard .gitignore file",
          },
          risk: "modifying",
          explanation:
            "Creates a default .gitignore to exclude build artifacts and secrets.",
          affectsData: true,
          targetPaths: [".gitignore"],
        });
      }
      return ActionPlanSchema.parse({
        intent: "Initialize Git and create .gitignore",
        assumptions: ["Git is installed on host system"],
        steps,
        overallRisk: "modifying",
        summary: "Initialize Git repository and create .gitignore",
      });
    }

    // "show the last five Git commits" / "show git commits"
    if (
      lower.includes("commit") ||
      (lower.includes("git") && lower.includes("log"))
    ) {
      return ActionPlanSchema.parse({
        intent: "Show recent Git commits",
        assumptions: ["Repository is initialized with Git commits"],
        steps: [
          {
            id: 1,
            action: {
              type: "git_log",
              path: ".",
              count: 5,
              description: "Show last 5 Git commits",
            },
            risk: "read-only",
            explanation: "Displays commit history without making changes.",
            affectsData: false,
            targetPaths: [".git"],
          },
        ],
        overallRisk: "read-only",
        summary: "Show recent Git commit history",
      });
    }

    // "create a README for this project"
    if (lower.includes("readme")) {
      return ActionPlanSchema.parse({
        intent: "Create README.md",
        assumptions: ["Generate starter README markdown"],
        steps: [
          {
            id: 1,
            action: {
              type: "create_file",
              path: "README.md",
              content: "# Project\n\nGenerated by cmdf.\n",
              description: "Create README.md",
            },
            risk: "modifying",
            explanation: "Creates a starter README.md in workspace root.",
            affectsData: true,
            targetPaths: ["README.md"],
          },
        ],
        overallRisk: "modifying",
        summary: "Create README.md",
      });
    }

    // "run the existing test suite"
    if (lower.includes("test")) {
      return ActionPlanSchema.parse({
        intent: "Run test suite",
        assumptions: ["npm test script is configured in package.json"],
        steps: [
          {
            id: 1,
            action: {
              type: "npm_run",
              script: "test",
              description: 'Run "npm test"',
            },
            risk: "modifying",
            explanation: "Executes the project test suite using npm.",
            affectsData: true,
            targetPaths: ["package.json"],
          },
        ],
        overallRisk: "modifying",
        summary: "Run project test suite",
      });
    }

    // "install Express and Nodemon"
    if (
      lower.includes("install") &&
      (lower.includes("express") || lower.includes("package"))
    ) {
      const packages = ["express"];
      if (lower.includes("nodemon")) packages.push("nodemon");
      return ActionPlanSchema.parse({
        intent: `Install packages: ${packages.join(", ")}`,
        assumptions: ["Install packages via npm in the current project"],
        steps: [
          {
            id: 1,
            action: {
              type: "npm_install",
              packages,
              dev: false,
              description: `Install ${packages.join(", ")}`,
            },
            risk: "modifying",
            explanation: `Installs npm packages: ${packages.join(", ")}`,
            affectsData: true,
            targetPaths: ["package.json", "node_modules"],
          },
        ],
        overallRisk: "modifying",
        summary: `Install ${packages.join(", ")}`,
      });
    }

    // Fallback: Safe shell command or default plan
    return ActionPlanSchema.parse({
      intent: `Execute: ${prompt}`,
      assumptions: ["Default single-action plan"],
      steps: [
        {
          id: 1,
          action: {
            type: "list_files",
            path: ".",
            description: `Inspect directory for task: ${prompt}`,
          },
          risk: "read-only",
          explanation:
            "Inspects current directory to understand project layout.",
          affectsData: false,
          targetPaths: ["."],
        },
      ],
      overallRisk: "read-only",
      summary: `Analyzed request: ${prompt}`,
    });
  }

  async explainCommand(command: string): Promise<string> {
    const trimmed = command.trim();
    if (trimmed.includes("rm -rf")) {
      return `Warning: "rm -rf" forcefully and recursively deletes directories and files without prompting for confirmation. Any data inside will be permanently lost.`;
    }
    if (trimmed.startsWith("git reset --hard")) {
      return `Warning: "git reset --hard" discards all uncommitted local modifications and staged files, resetting the working tree to the specified commit.`;
    }
    return `Command: "${command}". Executes standard shell operation. Always verify flags and paths before running.`;
  }
}
