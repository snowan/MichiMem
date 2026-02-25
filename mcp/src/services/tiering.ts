import type { Memory, MichiMemConfig } from "../../../src/types.js";
import type { IndexDB } from "./index-db.js";

export interface TieredResult {
  id: string;
  title: string;
  type: string;
  priority: number;
  text: string;
}

export function buildL0(db: IndexDB, config: MichiMemConfig): TieredResult[] {
  const results: TieredResult[] = [];
  let tokenEstimate = 0;
  const budget = config.tokens.l0_budget;

  const knowledge = db.getByPriority(0, 20);
  for (const m of knowledge) {
    const line = `${m.title}: ${m.summary}`;
    const tokens = estimateTokens(line);
    if (tokenEstimate + tokens > budget) break;
    tokenEstimate += tokens;
    results.push(toTiered(m, line));
  }

  const insights = db.getByType("insight", 10);
  for (const m of insights) {
    const line = `${m.title}: ${m.summary}`;
    const tokens = estimateTokens(line);
    if (tokenEstimate + tokens > budget) break;
    tokenEstimate += tokens;
    results.push(toTiered(m, line));
  }

  const shared = db.getByType("shared", 5);
  for (const m of shared) {
    const line = `${m.title}: ${m.summary}`;
    const tokens = estimateTokens(line);
    if (tokenEstimate + tokens > budget) break;
    tokenEstimate += tokens;
    results.push(toTiered(m, line));
  }

  return results;
}

export function buildL1(memories: Memory[], config: MichiMemConfig): TieredResult[] {
  const results: TieredResult[] = [];
  let tokenEstimate = 0;
  const budget = config.tokens.l1_budget;

  for (const m of memories) {
    const paragraph = [
      `**${m.title}** (${m.type}/P${m.priority}) [id:${m.id}]`,
      m.summary,
      m.tags.length > 0 ? `Tags: ${m.tags.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const tokens = estimateTokens(paragraph);
    if (tokenEstimate + tokens > budget) break;
    tokenEstimate += tokens;
    results.push(toTiered(m, paragraph));
  }

  return results;
}

export function buildL2(memory: Memory): TieredResult {
  const full = [
    `# ${memory.title}`,
    `Type: ${memory.type} | Priority: P${memory.priority}`,
    `Tags: ${memory.tags.join(", ") || "none"}`,
    `Created: ${memory.created_at} | Updated: ${memory.updated_at}`,
    memory.expires_at ? `Expires: ${memory.expires_at}` : null,
    "",
    memory.content,
  ]
    .filter((l) => l !== null)
    .join("\n");

  return toTiered(memory, full);
}

function toTiered(m: Memory, text: string): TieredResult {
  return {
    id: m.id,
    title: m.title,
    type: m.type,
    priority: m.priority,
    text,
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
