import { IndexDB } from "../mcp/src/services/index-db.js";
import { buildL0 } from "../mcp/src/services/tiering.js";
import type { CheckpointData, MichiMemConfig } from "./types.js";

export function buildL0Context(config: MichiMemConfig): string {
  const db = new IndexDB(config.data_dir);
  try {
    const items = buildL0(db, config);
    if (items.length === 0) return "";

    const knowledgeItems = items.filter((i) => i.priority === 0);
    const insightItems = items.filter((i) => i.type === "insight");
    const sharedItems = items.filter((i) => i.type === "shared");

    const lines: string[] = [];

    if (knowledgeItems.length > 0) {
      lines.push("## Core Knowledge");
      for (const i of knowledgeItems) lines.push(`- ${i.text}`);
    }

    if (insightItems.length > 0) {
      lines.push("## Recent Insights");
      for (const i of insightItems) lines.push(`- ${i.text}`);
    }

    if (sharedItems.length > 0) {
      lines.push("## Shared Memories");
      for (const i of sharedItems) lines.push(`- ${i.text}`);
    }

    return [
      "<michimem-context>",
      ...lines,
      "",
      "Use `mem_search` to find detailed memories. Use `mem_recall <id>` for full content.",
      "</michimem-context>",
    ].join("\n");
  } finally {
    db.close();
  }
}

export function buildRestoreContext(checkpoint: CheckpointData): string {
  const parts: string[] = [
    "<michimem-restore>",
    "Session was compacted. Restoring context from checkpoint:",
    "",
  ];

  if (checkpoint.current_task) {
    parts.push(`**Current task**: ${checkpoint.current_task}`);
  }

  if (checkpoint.decisions.length > 0) {
    parts.push("**Decisions made**:");
    for (const d of checkpoint.decisions) {
      parts.push(`- ${d}`);
    }
  }

  if (checkpoint.files_modified.length > 0) {
    parts.push(`**Files modified**: ${checkpoint.files_modified.join(", ")}`);
  }

  if (checkpoint.corrections.length > 0) {
    parts.push("**User corrections**:");
    for (const c of checkpoint.corrections) {
      parts.push(`- ${c}`);
    }
  }

  if (checkpoint.context_summary) {
    parts.push("**Recent context**:");
    parts.push(checkpoint.context_summary);
  }

  parts.push("</michimem-restore>");
  return parts.join("\n");
}
