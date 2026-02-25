import { IndexDB } from "../mcp/src/services/index-db.js";
import type { CheckpointData, MichiMemConfig } from "./types.js";

export function buildL0Context(config: MichiMemConfig): string {
  const db = new IndexDB(config.data_dir);
  try {
    const lines: string[] = [];

    const knowledge = db.getByPriority(0, 10);
    if (knowledge.length > 0) {
      lines.push("## Core Knowledge");
      for (const m of knowledge) {
        lines.push(`- ${m.title}: ${m.summary}`);
      }
    }

    const insights = db.getByType("insight", 5);
    if (insights.length > 0) {
      lines.push("## Recent Insights");
      for (const m of insights) {
        lines.push(`- ${m.title}: ${m.summary}`);
      }
    }

    const shared = db.getByType("shared", 3);
    if (shared.length > 0) {
      lines.push("## Shared Memories");
      for (const m of shared) {
        lines.push(`- ${m.title}: ${m.summary}`);
      }
    }

    if (lines.length === 0) return "";

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
