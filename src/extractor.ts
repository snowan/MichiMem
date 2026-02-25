import fs from "node:fs";
import type { MemoryInput } from "./types.js";
import type { MichiMemConfig } from "./types.js";

interface TranscriptMessage {
  role: string;
  content: unknown;
  type?: string;
}

interface ExtractedMemories {
  diary: MemoryInput | null;
  corrections: MemoryInput[];
  preferences: MemoryInput[];
}

export function extractFromTranscript(
  transcriptPath: string,
  config: MichiMemConfig,
): ExtractedMemories {
  let messages: TranscriptMessage[];
  try {
    const raw = fs.readFileSync(transcriptPath, "utf-8");
    messages = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return { diary: null, corrections: [], preferences: [] };
  }

  if (messages.length < 4) {
    return { diary: null, corrections: [], preferences: [] };
  }

  return {
    diary: buildDiary(messages, config),
    corrections: extractCorrections(messages),
    preferences: extractPreferences(messages),
  };
}

function buildDiary(
  messages: TranscriptMessage[],
  config: MichiMemConfig,
): MemoryInput {
  const userMessages = messages.filter((m) => m.role === "user");
  const assistantMessages = messages.filter((m) => m.role === "assistant");

  const firstUserMsg = extractText(userMessages[0]?.content).slice(0, 100);
  const topics = extractTopics(messages);
  const filesModified = extractFileRefs(messages);

  const title = firstUserMsg
    ? `Session: ${firstUserMsg.replace(/\n/g, " ").trim()}`
    : `Session diary ${new Date().toISOString().slice(0, 10)}`;

  const summary = [
    `${userMessages.length} user msgs, ${assistantMessages.length} assistant msgs.`,
    topics.length > 0 ? `Topics: ${topics.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const contentParts: string[] = [];
  for (const msg of messages.slice(-20)) {
    const text = extractText(msg.content);
    if (text.length > 0) {
      const prefix = msg.role === "user" ? "**User**" : "**Assistant**";
      contentParts.push(`${prefix}: ${text.slice(0, 200)}`);
    }
  }

  if (filesModified.length > 0) {
    contentParts.push(`\nFiles referenced: ${filesModified.join(", ")}`);
  }

  const expiresAt = new Date(
    Date.now() + config.ttl.diary_days * 86400000,
  ).toISOString();

  return {
    type: "diary",
    priority: 2,
    title,
    summary,
    content: contentParts.join("\n"),
    tags: topics.slice(0, 5),
    expires_at: expiresAt,
  };
}

function extractCorrections(messages: TranscriptMessage[]): MemoryInput[] {
  const corrections: MemoryInput[] = [];
  const patterns = [
    {
      regex:
        /(?:actually|no,\s*|wrong|instead|correction)[,:]?\s+(.{15,150})/gi,
      type: "correction" as const,
    },
    {
      regex:
        /(?:don't|do not|never|stop)\s+([\w\s]{10,80})/gi,
      type: "negative_preference" as const,
    },
  ];

  for (const msg of messages.filter((m) => m.role === "user")) {
    const text = extractText(msg.content);

    for (const { regex, type } of patterns) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(text)) !== null) {
        const extracted = match[1].trim();
        if (extracted.length < 15) continue;

        corrections.push({
          type: "knowledge",
          priority: 0,
          title: `Correction: ${extracted.slice(0, 60)}`,
          summary: extracted.slice(0, 150),
          content: `Source: user correction (${type})\nContext: ${text.slice(Math.max(0, match.index - 50), match.index + match[0].length + 50)}`,
          tags: ["correction", type],
        });
      }
    }
  }

  return dedup(corrections);
}

function extractPreferences(messages: TranscriptMessage[]): MemoryInput[] {
  const preferences: MemoryInput[] = [];
  const patterns = [
    /(?:always|prefer|I like|I want|I use|please always)\s+(.{10,100})/gi,
    /(?:my preferred|my favorite|I typically|I usually)\s+(.{10,100})/gi,
  ];

  for (const msg of messages.filter((m) => m.role === "user")) {
    const text = extractText(msg.content);

    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const extracted = match[1].trim();
        if (extracted.length < 10) continue;

        preferences.push({
          type: "knowledge",
          priority: 0,
          title: `Preference: ${extracted.slice(0, 60)}`,
          summary: extracted.slice(0, 150),
          content: `Source: user preference\nFull context: ${text.slice(Math.max(0, match.index - 30), match.index + match[0].length + 30)}`,
          tags: ["preference"],
        });
      }
    }
  }

  return dedup(preferences);
}

function extractTopics(messages: TranscriptMessage[]): string[] {
  const topics = new Set<string>();
  const topicPatterns = [
    /(?:working on|implementing|building|fixing|debugging|creating)\s+([\w\s-]{5,30})/gi,
    /(?:the\s+)([\w-]+(?:\s+[\w-]+){0,2})\s+(?:module|service|component|function|class|file)/gi,
  ];

  for (const msg of messages.slice(0, 10)) {
    const text = extractText(msg.content);
    for (const pattern of topicPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        topics.add(match[1].trim().toLowerCase());
      }
    }
  }

  return [...topics].slice(0, 5);
}

function extractFileRefs(messages: TranscriptMessage[]): string[] {
  const files = new Set<string>();
  const pattern = /(?:[\w/.-]+\/)?[\w.-]+\.\w{1,6}/g;

  for (const msg of messages) {
    const text = JSON.stringify(msg.content);
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      const f = match[0];
      if (
        f.includes("/") &&
        !f.startsWith("http") &&
        !f.includes("node_modules")
      ) {
        files.add(f);
      }
    }
  }

  return [...files].slice(0, 10);
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

function dedup(memories: MemoryInput[]): MemoryInput[] {
  const seen = new Set<string>();
  return memories.filter((m) => {
    const key = m.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
