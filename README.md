# cmdf — AI-Powered Terminal Assistant

> **Your intent. One command.**

[![npm version](https://img.shields.io/npm/v/@prashantxdev/cmdf.svg)](https://www.npmjs.com/package/@prashantxdev/cmdf)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node: >=18.0.0](https://img.shields.io/badge/Node-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![TypeScript: 5.7](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Tests: Vitest](https://img.shields.io/badge/Tests-Vitest%20(78%20passed)-purple.svg)](https://vitest.dev/)

**cmdf** is a cross-platform, AI-powered command-line terminal assistant inspired by the polished developer experience of Builder.io AI Shell. It translates your natural-language intent into structured, inspectable action plans and safely executes terminal, filesystem, and developer tasks.

Instead of memorizing esoteric shell commands, obscure flags, or platform incompatibilities across Windows PowerShell, Windows Terminal, macOS Zsh, and Linux Bash, simply describe what you want in plain English. `cmdf` analyzes your environment, formulates a validated plan, categorizes risk, explains what each step does, and guides you through an interactive approval and revision workflow before touching your files.

---

## The cmdf Workflow

Inspired by the clean interaction design of Builder.io AI Shell, `cmdf` provides an intuitive 3-step experience:

```text
1. Install globally:
   $ npm install -g @prashantxdev/cmdf

2. Quick interactive setup:
   $ cmdf config

3. Express your intent:
   $ cmdf "find all log files"
```

### Interactive Approval & Revision Workflow

When you ask `cmdf` to perform a task, it presents a clear breakdown of the planned actions, risk level, and explanations, followed by an interactive prompt powered by `@inquirer/prompts`:

```text
Proposed Action Plan:
  Intent: Find all log files in the current workspace
  Risk:   READ-ONLY
  Summary: Search the directory tree for all files with a .log extension.

  Steps:
  1. Search for files matching *.log pattern [read-only] (target: .)

? How would you like to proceed?
  ❯ ✅ Approve and execute
    📝 Revise with instruction
    ❌ Cancel
```

- **✅ Approve and execute**: Safely runs the proposed actions and verifies disk outcomes.
- **📝 Revise with instruction**: Enter an adjustment (e.g., *"only search inside the build directory"*) to refine the plan without restarting your session.
- **❌ Cancel**: Exits cleanly without modifying any files or running commands.

---

## Bring Your Own Key (BYOK) Architecture

`cmdf` is strictly private and operates on a **Bring Your Own Key (BYOK)** model:

- **Direct local connection**: All Gemini API requests are dispatched directly from your terminal to Google's official Gemini API endpoint via Google's official `@google/genai` SDK.
- **Zero middleman / Zero telemetry**: There is no developer-controlled server, proxy, database, or telemetry relay. Your keys and workspace contents never touch third-party infrastructure.
- **Your key, your quota**: Every user supplies their own Gemini API key. Requests consume your personal Google Gemini quota and free-tier limits.
- **Strict secret protection**: Keys are never printed in full, logged, or bundled with npm packages. Stored keys are masked (e.g., `AQ.A••••••••••••••••••••_I5A`) and secured with restrictive local permissions.

```mermaid
sequenceDiagram
    autonumber
    actor User as User Terminal
    participant CLI as cmdf (Local CLI)
    participant Config as ~/.cmdf/config.json (0600)
    participant Google as Google Gemini API (@google/genai SDK)

    User->>CLI: cmdf "create src/index.ts and initialize git"
    CLI->>Config: Resolve key (Priority: Env > User Config > .env)
    Config-->>CLI: Masked API key resolved
    CLI->>Google: Direct HTTPS request with AbortController & Low Thinking
    Google-->>CLI: Structured JSON Action Plan
    CLI->>User: Display proposed plan, explanations & risk
    User->>CLI: Approve / Revise / Cancel
    CLI->>User: Safe local execution & disk verification
```

---

## Key Features

- **Natural Language Intent Engine**: Handles intuitive developer tasks (e.g., `"create a folder named demo"`, `"create a file named DEMO.txt"`, `"find all Java files"`, `"list all log files"`).
- **Interactive Approval & Revision**: 3-option workflow allows approving, revising in-place, or cancelling safely without side effects.
- **Fast, Bounded AI Generation**: Optimized generation with low thinking latency, strict deadline budgeting across attempts, and cancellation signals.
- **Structured Plan Validation**: Powered by Zod schemas to ensure every step has a valid action type, arguments, risk level, and explanations.
- **Interactive Configuration Wizard**: Run `cmdf config` in any terminal to set keys, switch models, adjust timeouts, or view settings.
- **System Doctor Diagnostics**: `cmdf doctor` performs runtime checks, workspace validation, and a minimal real live-generation probe with actionable error diagnosis.
- **Three-Tier Risk Policy**:
  - **Read-Only**: File searches, directory listings, reading files, and git logs.
  - **Modifying**: Creating directories, writing files, installing packages (requires approval).
  - **Destructive**: Deleting files or resetting git trees (defaults to Cancel with high-visibility warnings).
- **Security-First Execution**:
  - Prefers deterministic Node.js filesystem APIs over general-purpose shells.
  - Prohibits `shell: true` on untrusted command strings. Uses `spawn`/`execFile` with argument arrays.
  - Enforces workspace boundaries, preventing directory traversal (`../`) and drive-hopping.
  - Validates commands against a strict blocklist for destructive system calls (`rm -rf /`, `format`, fork bombs).
- **Genuine Dry-Run Simulation**: `--dry-run` simulates the plan without applying filesystem modifications.
- **Command Explanations**: `cmdf explain "<command>"` safely breaks down flags, read/write impact, and safety alternatives.
- **Cross-Platform**: First-class support for Windows PowerShell, Windows Terminal, macOS Zsh, and Linux Bash.
- **Offline Mock Provider**: Run offline or in CI with `--provider mock`.

---

## Prerequisites

- **Node.js**: Version 18.0.0 or higher (LTS recommended)
- **npm**: Version 9.0.0 or higher
- **Git**: Installed and available on system PATH (optional, for git actions)
- **Gemini API Key**: Free key from [Google AI Studio](https://aistudio.google.com/apikey)

---

## Installation

### Install Globally from npm

```bash
npm install -g @prashantxdev/cmdf
```

### Verify Installation

```bash
cmdf --version
cmdf doctor
```

---

## First-Time Setup & BYOK Configuration

### Step 1: Obtain a Free Gemini API Key

1. Visit [Google AI Studio](https://aistudio.google.com/apikey).
2. Sign in with your Google account.
3. Click **Create API Key** and copy your key.

### Step 2: Configure Your Key

`cmdf` resolves your Gemini API key using strict precedence:
1. **Environment Variable (`GEMINI_API_KEY`)** — Highest priority (shell session or CI/CD).
2. **User Configuration (`~/.cmdf/config.json`)** — Recommended for personal machines.
3. **Project `.env` file** — Convenient for local project development.

#### Option A: Interactive Configuration Wizard (Recommended)

Run `cmdf config` without arguments in an interactive terminal:

```bash
cmdf config
```

```text
cmdf Configuration Wizard

  Workspace:        C:\Users\Dell\Desktop\cmdf
  AI Provider:      gemini
  AI Model:         gemini-3.5-flash
  Request Timeout:  45000ms
  Gemini API Key:   AQ.A••••••••••••••••••••_I5A (via user_config)

? What would you like to configure?
  ❯ 🔑 Set Gemini API Key
    🤖 Select AI Model
    ⏱️  Set Request Timeout
    📋 View Active Configuration
    🗑️  Delete Stored API Key
    🚪 Exit
```

#### Option B: Fast Subcommands

```bash
# Save your API key (masked prompt):
cmdf config set-key

# Or pass directly:
cmdf config set-key YOUR_GEMINI_API_KEY

# View masked key and configuration table:
cmdf config list
cmdf config get-key

# Remove stored key:
cmdf config delete-key

# Set preferred model or timeout:
cmdf config set model gemini-3.5-flash
cmdf config set timeoutMs 60000
```

#### Option C: Shell Environment Variables

**Windows PowerShell:**
```powershell
# Current terminal session:
$env:GEMINI_API_KEY="your_api_key_here"

# Permanent user profile:
[Environment]::SetEnvironmentVariable("GEMINI_API_KEY", "your_api_key_here", "User")
```

**macOS / Linux (`~/.bashrc` or `~/.zshrc`):**
```bash
export GEMINI_API_KEY="your_api_key_here"
export GEMINI_MODEL="gemini-3.5-flash"
```

#### Option D: Project-Local `.env` File

For repository-specific development, create a `.env` file:

```env
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=gemini-3.5-flash
CMDF_WORKSPACE=.
```

---

## Model Selection & Gemini Planning Troubleshooting

### Understanding the Gemini Planning Timeout & Quotas

If you previously experienced `AI planning request timed out after 45000ms` or `429 RESOURCE_EXHAUSTED`, here is why and how `cmdf` solves it:

1. **Reasoning Latency on Thinking Models (`gemini-3.8-flash`)**:
   - `gemini-3.8-flash` is a preview model with extended reasoning/thinking capabilities. By default, it spends substantial time in internal "thinking" before generating tokens, which under network load can lead to 25s–60s+ latencies or 504 gateway timeouts.
   - **Fix**: `cmdf` automatically applies `{ thinkingLevel: "low" }` to thinking-enabled models, drastically minimizing reasoning delay while preserving planning accuracy.
2. **Google AI Studio Free-Tier Limits (20 Requests/Day on Preview Models)**:
   - On the Google AI Studio Free Tier, preview models like `gemini-3.8-flash` enforce a strict quota of **20 requests per day**. Once exhausted, requests return `429 RESOURCE_EXHAUSTED`.
   - **Fix**: `cmdf` cleanly distinguishes **Daily Quota Exhaustion** from **Transient Rate Limits**. Instead of repeatedly retrying and wasting time on an exhausted daily quota, `cmdf` immediately reports the exact issue and guides you to switch to a higher-capacity model like `gemini-3.5-flash`.
3. **Recommended Model: `gemini-3.5-flash`**:
   - `gemini-3.5-flash` delivers fast ~2-second responses, generous free-tier limits, and full JSON schema compliance.
   - Switch anytime with:
     ```bash
     cmdf config set model gemini-3.5-flash
     ```
     Or on a single command:
     ```bash
     cmdf -m gemini-3.5-flash "create a file named DEMO.txt"
     ```
4. **Deadline Budgeting & Native Cancellation**:
   - `cmdf` enforces a total deadline budget (`Date.now() + timeoutMs`) across attempts. Retries are strictly bounded and abort immediately via `AbortController` if the budget is depleted.

---

## Supported Commands and Options

### Global Options

| Option | Description |
| :--- | :--- |
| `-v, --version` | Display version number |
| `-w, --workspace <path>` | Approved workspace root directory (defaults to current directory) |
| `-m, --model <name>` | Gemini model to use (`gemini-3.5-flash`, `gemini-3.8-flash`, etc.) |
| `-p, --provider <name>` | AI provider (`gemini` or `mock`) |
| `-t, --timeout <ms>` | AI request timeout in milliseconds (defaults to `45000`) |
| `-d, --dry-run` | Simulate plan without modifying files or executing commands |
| `-y, --yes` | Automatically approve non-destructive actions |
| `-h, --help` | Display command help |

### Commands

#### 1. Natural Language Task Execution (Default)

```bash
cmdf [options] [instruction...]
```

Translates your prompt into an action plan with an interactive `Approve / Revise / Cancel` prompt. If instruction is omitted, launches interactive REPL mode.

```bash
# Execute task
cmdf "find all log files"

# Create a demo file
cmdf "create a file named DEMO.txt"

# Create directory
cmdf "create a folder named demo"

# Dry-run simulation (no changes made)
cmdf --dry-run "create src/index.ts and initialize git"

# Auto-approve non-destructive read actions
cmdf -y "find all Java files"
```

#### 2. Plan Inspection (`cmdf plan`)

```bash
cmdf plan [options] <instruction...>
```

Generates and prints the structured JSON plan and explanations without executing any steps:

```bash
cmdf plan "find all Java files"
```

#### 3. Command Explanation (`cmdf explain`)

```bash
cmdf explain [options] <command...>
```

Explains what a terminal command does, its flags, filesystem read/write effects, and risk classification without running it:

```bash
cmdf explain "git log -n 5 --oneline"
cmdf explain "rm -rf node_modules"
```

#### 4. System Diagnostics (`cmdf doctor`)

```bash
cmdf doctor [options]
```

Inspects Node.js, npm, Git, OS, shell, workspace accessibility, credential storage permissions, and runs a minimal live generation probe:

```bash
cmdf doctor
cmdf doctor -m gemini-3.5-flash
```

#### 5. Configuration (`cmdf config`)

```bash
cmdf config                       # Interactive configuration wizard
cmdf config list                  # View configuration table
cmdf config set-key [key]         # Save Gemini API key
cmdf config get-key               # View active key status and source
cmdf config delete-key            # Delete stored key
cmdf config set <key> <value>     # Update a specific setting (model, timeoutMs)
```

#### 6. Execution History (`cmdf history`)

```bash
cmdf history                      # View recent request history
cmdf history --clear              # Clear history log
```

---

## Real Usage Examples

### Example 1: Creating Files and Folders

```bash
cmdf "create a file named DEMO.txt"
```

```text
Proposed Action Plan:
  Intent: Create a new file named DEMO.txt
  Risk:   MODIFYING
  Summary: Create an empty file named DEMO.txt in the current directory.

  Steps:
  1. Create empty file DEMO.txt [modifying] (target: DEMO.txt)

? How would you like to proceed?
  ❯ ✅ Approve and execute
    📝 Revise with instruction
    ❌ Cancel

[SUCCESS] All actions completed and verified:
  ✔ Step 1: Created file "DEMO.txt" (2ms)
```

### Example 2: In-Place Revision

```bash
cmdf "create a folder named demo"
```

If you select `📝 Revise with instruction`:
```text
? How would you like to revise this? name it demo-v2 instead
- Generating action plan...

Proposed Action Plan:
  Intent: Create a folder named demo-v2
  Risk:   MODIFYING
  Summary: Create directory demo-v2 in current workspace.
```

### Example 3: Finding Files Safely

```bash
cmdf "find all Java files"
```

```text
Proposed Action Plan:
  Intent: Find all Java files within the workspace
  Risk:   READ-ONLY
  Summary: Search the workspace for all files matching the '*.java' pattern.

  Steps:
  1. Search for files matching *.java pattern [read-only] (target: .)
```

### Example 4: Dry-Run Verification

```bash
cmdf --dry-run "create a file named DEMO.txt"
```

```text
[DRY RUN SUMMARY] — No changes were made:
  ⊘ Step 1: [Dry Run] Would execute: Creates a new empty text file named DEMO.txt. (0ms)
```

---

## Security & Execution Safeguards

1. **Workspace Boundary Containment**:
   All filesystem paths are checked using path normalization and security guards. Path traversal sequences (`../`), relative escapes, and drive-hopping outside the workspace are blocked before execution.
2. **No Arbitrary Shell Execution**:
   Deterministic filesystem operations (create file, list directory, search files, move, delete) use native Node.js APIs (`node:fs`). Shell commands only run when no native alternative exists, using sanitized `child_process.spawn` argument arrays.
3. **Command Validator**:
   Dangerous destructive system commands (`rm -rf /`, `mkfs`, `format`, fork bombs, `chmod 777 /`) are caught by the security policy and refused.
4. **Secret Redaction**:
   API keys, GitHub tokens, and private credentials are automatically scrubbed from error messages and history logs.
5. **Restrictive File Permissions**:
   On macOS/Linux, `~/.cmdf/config.json` is stored with `0600` (owner read/write only). On Windows, it is protected by Windows NTFS Access Control Lists (ACLs).

---

## Troubleshooting

| Issue / Error | Root Cause | Solution |
| :--- | :--- | :--- |
| `Daily Gemini API quota has been exhausted (429 RESOURCE_EXHAUSTED)` | Preview models like `gemini-3.8-flash` have a 20 request/day limit on Free Tier | Switch to `gemini-3.5-flash` with higher limits: `cmdf config set model gemini-3.5-flash` |
| `AI planning request timed out after 45000ms` | Model thinking latency or network congestion | Switch to `gemini-3.5-flash` or increase timeout: `cmdf config set timeoutMs 60000` |
| `Gemini API key is not configured` | No key set in env, user config, or `.env` | Run `cmdf config set-key` to configure your key |
| `Invalid or unauthorized Gemini API key (401/403)` | API key is invalid or revoked | Verify your key at [Google AI Studio](https://aistudio.google.com/apikey) and re-run `cmdf config set-key` |
| `Model "..." is no longer available (404)` | Deprecated model ID (e.g. `gemini-2.5-flash`) | Run `cmdf config set model gemini-3.5-flash` |
| `Permission denied` on config file | Insecure file mode on Unix systems | Run `chmod 600 ~/.cmdf/config.json` |

---

## Development & Testing

```bash
# Clone repository
git clone https://github.com/prashantxdev/cmdf.git
cd cmdf

# Install dependencies
npm install

# Compile TypeScript
npm run build

# Run unit and integration tests (69 passing tests, zero real API calls)
npm test

# Type-check without emitting
npm run typecheck

# Lint check
npm run lint

# Dry-run package inspection (verifies secrets and tests are excluded)
npm pack --dry-run
```

All automated tests use mocked providers or in-memory fixtures. No real API keys or paid quotas are ever consumed during testing.

---

## License & Originality

This project is independently developed and licensed under the [MIT License](LICENSE).

Reference inspiration: [Builder.io AI Shell](https://github.com/BuilderIO/ai-shell) (MIT License). Interaction design principles (approval, revision, and concise terminal presentation) have been adapted and implemented specifically for `cmdf`'s TypeScript + Google GenAI architecture.

- **GitHub Repository**: [https://github.com/prashantxdev/cmdf](https://github.com/prashantxdev/cmdf)
- **npm Package**: [https://www.npmjs.com/package/@prashantxdev/cmdf](https://www.npmjs.com/package/@prashantxdev/cmdf)
