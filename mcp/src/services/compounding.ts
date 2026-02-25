import type { Memory, MichiMemConfig } from "../../../src/types.js";
import type { IndexDB } from "./index-db.js";

interface CompoundingResult {
  insights_created: number;
  knowledge_created: number;
  diaries_processed: number;
}

export function runCompounding(
  db: IndexDB,
  config: MichiMemConfig,
): CompoundingResult {
  const result: CompoundingResult = {
    insights_created: 0,
    knowledge_created: 0,
    diaries_processed: 0,
  };

  const insightsFromDiaries = compoundDiariesToInsights(db, config);
  result.insights_created = insightsFromDiaries.length;
  result.diaries_processed = insightsFromDiaries.reduce(
    (sum, i) => sum + i.sourceCount,
    0,
  );

  const knowledgeFromInsights = compoundInsightsToKnowledge(db, config);
  result.knowledge_created = knowledgeFromInsights.length;

  db.recordMetric("compounding", result as unknown as Record<string, unknown>);

  return result;
}

interface CreatedInsight {
  id: string;
  sourceCount: number;
}

function compoundDiariesToInsights(
  db: IndexDB,
  config: MichiMemConfig,
): CreatedInsight[] {
  const unprocessed = db.getUnprocessedDiaries(50);

  if (unprocessed.length < config.compounding.diary_threshold) {
    return [];
  }

  const groups = groupByOverlap(unprocessed);
  const created: CreatedInsight[] = [];

  for (const group of groups) {
    if (group.length < config.compounding.diary_threshold) continue;

    const insight = synthesizeInsight(group);
    if (!insight) continue;

    const expiresAt = new Date(
      Date.now() + config.ttl.insight_days * 86400000,
    ).toISOString();

    const memory = db.insert({
      type: "insight",
      priority: 1,
      title: insight.title,
      summary: insight.summary,
      content: insight.content,
      tags: insight.tags,
      source_ids: group.map((d) => d.id),
      expires_at: expiresAt,
    });

    created.push({ id: memory.id, sourceCount: group.length });
  }

  return created;
}

function compoundInsightsToKnowledge(
  db: IndexDB,
  config: MichiMemConfig,
): Memory[] {
  const insights = db.getByType("insight", 50);

  if (insights.length < config.compounding.insight_threshold) {
    return [];
  }

  const groups = groupByOverlap(insights);
  const created: Memory[] = [];

  for (const group of groups) {
    if (group.length < config.compounding.insight_threshold) continue;

    const knowledge = synthesizeKnowledge(group);
    if (!knowledge) continue;

    const memory = db.insert({
      type: "knowledge",
      priority: 0,
      title: knowledge.title,
      summary: knowledge.summary,
      content: knowledge.content,
      tags: knowledge.tags,
      source_ids: group.map((i) => i.id),
    });

    created.push(memory);
  }

  return created;
}

function groupByOverlap(memories: Memory[]): Memory[][] {
  if (memories.length === 0) return [];

  const groups: Memory[][] = [];
  const assigned = new Set<string>();

  for (const mem of memories) {
    if (assigned.has(mem.id)) continue;

    const group: Memory[] = [mem];
    assigned.add(mem.id);

    const memWords = extractWords(mem);

    for (const other of memories) {
      if (assigned.has(other.id)) continue;

      const otherWords = extractWords(other);
      const overlap = computeOverlap(memWords, otherWords);

      if (overlap >= 0.15) {
        group.push(other);
        assigned.add(other.id);
      }
    }

    groups.push(group);
  }

  return groups;
}

function extractWords(mem: Memory): Set<string> {
  const text = `${mem.title} ${mem.summary} ${mem.tags.join(" ")}`.toLowerCase();
  const words = text.split(/\W+/).filter((w) => w.length > 3);
  return new Set(words);
}

function computeOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  return intersection / Math.min(a.size, b.size);
}

interface SynthesizedMemory {
  title: string;
  summary: string;
  content: string;
  tags: string[];
}

function synthesizeInsight(diaries: Memory[]): SynthesizedMemory | null {
  if (diaries.length === 0) return null;

  const allTags = new Set<string>();
  const contentParts: string[] = [];

  for (const d of diaries) {
    for (const t of d.tags) allTags.add(t);
    contentParts.push(`- ${d.title}: ${d.summary}`);
  }

  const commonTopics = [...allTags].slice(0, 5);
  const topicStr =
    commonTopics.length > 0 ? commonTopics.join(", ") : "general";

  return {
    title: `Pattern: ${topicStr} (from ${diaries.length} sessions)`,
    summary: `Recurring pattern across ${diaries.length} sessions involving ${topicStr}`,
    content: [
      `Synthesized from ${diaries.length} session diaries:`,
      "",
      ...contentParts,
      "",
      `Date range: ${diaries[0].created_at.slice(0, 10)} to ${diaries[diaries.length - 1].created_at.slice(0, 10)}`,
    ].join("\n"),
    tags: [...commonTopics, "auto-insight"],
  };
}

function synthesizeKnowledge(insights: Memory[]): SynthesizedMemory | null {
  if (insights.length === 0) return null;

  const allTags = new Set<string>();
  const contentParts: string[] = [];

  for (const i of insights) {
    for (const t of i.tags) allTags.add(t);
    contentParts.push(`- ${i.title}: ${i.summary}`);
  }

  const topics = [...allTags].filter((t) => t !== "auto-insight").slice(0, 5);
  const topicStr = topics.length > 0 ? topics.join(", ") : "general";

  return {
    title: `Knowledge: ${topicStr}`,
    summary: `Accumulated knowledge from ${insights.length} insights about ${topicStr}`,
    content: [
      `Promoted from ${insights.length} insights:`,
      "",
      ...contentParts,
      "",
      `This knowledge is permanent (P0) and will be included in L0 context injection.`,
    ].join("\n"),
    tags: [...topics, "auto-knowledge"],
  };
}
