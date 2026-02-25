import fs from "node:fs";
import path from "node:path";
import type { Memory, MichiMemConfig } from "../../../src/types.js";
import type { IndexDB } from "./index-db.js";

interface LifecycleResult {
  expired: number;
  archived: number;
}

export function runLifecycle(
  db: IndexDB,
  config: MichiMemConfig,
): LifecycleResult {
  const result: LifecycleResult = { expired: 0, archived: 0 };

  const expired = db.getExpired();
  for (const mem of expired) {
    const archived = archiveMemory(mem, config);
    db.delete(mem.id);
    result.expired++;
    if (archived) result.archived++;

    db.recordMetric("lifecycle_expire", {
      id: mem.id,
      type: mem.type,
      priority: mem.priority,
    });
  }

  return result;
}

function archiveMemory(mem: Memory, config: MichiMemConfig): boolean {
  try {
    const archiveDir = path.join(config.data_dir, "archive");
    fs.mkdirSync(archiveDir, { recursive: true });

    const datePrefix = mem.created_at.slice(0, 10);
    const filename = `${datePrefix}-${mem.id.slice(0, 8)}.md`;
    const filepath = path.join(archiveDir, filename);

    const content = [
      `# ${mem.title}`,
      "",
      `- Type: ${mem.type}`,
      `- Priority: P${mem.priority}`,
      `- Tags: ${mem.tags.join(", ") || "none"}`,
      `- Created: ${mem.created_at}`,
      `- Expired: ${new Date().toISOString()}`,
      "",
      "## Summary",
      mem.summary,
      "",
      "## Content",
      mem.content,
    ].join("\n");

    fs.writeFileSync(filepath, content);
    return true;
  } catch {
    return false;
  }
}
