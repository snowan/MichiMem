import fs from "node:fs";
import path from "node:path";
import type { CheckpointData, MichiMemConfig } from "./types.js";

interface TranscriptMessage {
  role: string;
  content: unknown;
  type?: string;
}

export function createCheckpoint(
  config: MichiMemConfig,
  sessionId: string,
  transcriptPath: string,
): string | null {
  let messages: TranscriptMessage[];
  try {
    const raw = fs.readFileSync(transcriptPath, "utf-8");
    messages = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return null;
  }

  const checkpoint: CheckpointData = {
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    current_task: extractCurrentTask(messages),
    decisions: extractDecisions(messages),
    files_modified: extractFilesModified(messages),
    corrections: extractCorrections(messages),
    context_summary: buildContextSummary(messages),
  };

  const checkpointDir = path.join(config.data_dir, "checkpoints");
  fs.mkdirSync(checkpointDir, { recursive: true });

  const filename = `${sessionId}-${Date.now()}.json`;
  const filepath = path.join(checkpointDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(checkpoint, null, 2));

  return filepath;
}

export function getLatestCheckpoint(
  config: MichiMemConfig,
  sessionId: string,
): CheckpointData | null {
  const checkpointDir = path.join(config.data_dir, "checkpoints");
  if (!fs.existsSync(checkpointDir)) return null;

  const files = fs
    .readdirSync(checkpointDir)
    .filter((f) => f.startsWith(sessionId) && f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  try {
    return JSON.parse(
      fs.readFileSync(path.join(checkpointDir, files[0]), "utf-8"),
    );
  } catch {
    return null;
  }
}

function extractCurrentTask(messages: TranscriptMessage[]): string {
  const recentUser = messages
    .filter((m) => m.role === "user")
    .slice(-3);

  for (const msg of recentUser.reverse()) {
    const text = extractText(msg.content);
    if (text.length > 10) {
      return text.slice(0, 200);
    }
  }
  return "";
}

function extractDecisions(messages: TranscriptMessage[]): string[] {
  const decisions: string[] = [];
  const decisionPatterns = [
    /(?:decided|choosing|going with|using|picked|selected)\s+(.{10,80})/gi,
    /(?:approach|strategy|plan):\s*(.{10,80})/gi,
  ];

  for (const msg of messages.filter((m) => m.role === "assistant")) {
    const text = extractText(msg.content);
    for (const pattern of decisionPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        decisions.push(match[1].trim());
      }
    }
  }

  return decisions.slice(-5);
}

function extractFilesModified(messages: TranscriptMessage[]): string[] {
  const files = new Set<string>();
  const filePatterns = [
    /(?:edited|wrote|created|modified|updated)\s+[`"]?([/\w.-]+\.\w+)[`"]?/gi,
    /file_path['":\s]+([/\w.-]+\.\w+)/gi,
  ];

  for (const msg of messages) {
    const text = JSON.stringify(msg.content);
    for (const pattern of filePatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        files.add(match[1]);
      }
    }
  }

  return [...files].slice(-10);
}

function extractCorrections(messages: TranscriptMessage[]): string[] {
  const corrections: string[] = [];
  const correctionPatterns = [
    /(?:actually|no,|wrong|instead|correction|fix|should be)\s+(.{10,100})/gi,
    /(?:don't|do not|never|always|prefer|avoid)\s+(.{10,80})/gi,
  ];

  for (const msg of messages.filter((m) => m.role === "user")) {
    const text = extractText(msg.content);
    for (const pattern of correctionPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        corrections.push(match[1].trim());
      }
    }
  }

  return corrections.slice(-5);
}

function buildContextSummary(messages: TranscriptMessage[]): string {
  const recentMessages = messages.slice(-10);
  const parts: string[] = [];

  for (const msg of recentMessages) {
    const text = extractText(msg.content);
    if (text.length > 0) {
      const prefix = msg.role === "user" ? "U" : "A";
      parts.push(`${prefix}: ${text.slice(0, 100)}`);
    }
  }

  return parts.join("\n").slice(0, 500);
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block?.type === "text" && typeof block.text === "string")
          return block.text;
        return "";
      })
      .join(" ");
  }
  return "";
}
