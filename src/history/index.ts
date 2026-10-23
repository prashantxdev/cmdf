import fs from "node:fs";
import path from "node:path";
import { getConfigDir } from "../config/index.js";
import type { HistoryEntry } from "./types.js";
import { redactObject } from "../utils/redactor.js";

const HISTORY_FILE_NAME = "history.json";

export function getHistoryFilePath(): string {
  return path.join(getConfigDir(), HISTORY_FILE_NAME);
}

export function loadHistory(): HistoryEntry[] {
  const filePath = getHistoryFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as HistoryEntry[];
    }
  } catch {
    // Ignore corrupt or unreadable history
  }
  return [];
}

export function saveHistoryEntry(
  entry: Omit<HistoryEntry, "id" | "timestamp">,
  limit: number = 100,
): void {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const entries = loadHistory();
  const newEntry: HistoryEntry = {
    id: `hist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    prompt: entry.prompt,
    plan: entry.plan,
    approved: entry.approved,
    executionResult: entry.executionResult,
  };

  // Redact any secrets before storing
  const redactedEntry = redactObject(newEntry);

  // Prepend newest first
  entries.unshift(redactedEntry);

  // Limit size
  const trimmed = entries.slice(0, limit);

  fs.writeFileSync(
    getHistoryFilePath(),
    JSON.stringify(trimmed, null, 2),
    "utf-8",
  );
}

export function clearHistory(): void {
  const filePath = getHistoryFilePath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
