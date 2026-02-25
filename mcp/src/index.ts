import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { IndexDB } from "./services/index-db.js";
import { loadConfig, ensureDataDirs } from "../../src/config.js";
import type { MemoryType, Priority } from "../../src/types.js";
import { getLatestCheckpoint } from "../../src/checkpoint.js";
import { buildRestoreContext } from "../../src/injector.js";

const config = loadConfig();
ensureDataDirs(config);
const db = new IndexDB(config.data_dir);

const server = new McpServer({
  name: "michimem",
  version: "0.1.0",
});

server.tool(
  "mem_search",
  "Search memories using full-text search. Returns L1 summaries (title + summary). Use mem_recall for full content.",
  {
    query: z.string().describe("Search query (supports FTS5 syntax)"),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("Max results to return"),
  },
  async ({ query, limit }) => {
    const start = Date.now();
    const results = db.search(query, limit);
    db.recordMetric("search", {
      query,
      results: results.length,
      latency_ms: Date.now() - start,
    });

    if (results.length === 0) {
      return { content: [{ type: "text", text: "No memories found." }] };
    }

    const text = results
      .map(
        (r) =>
          `**${r.memory.title}** (${r.memory.type}/P${r.memory.priority}) [id:${r.memory.id}]\n${r.memory.summary}`,
      )
      .join("\n\n");

    return { content: [{ type: "text", text }] };
  },
);

server.tool(
  "mem_recall",
  "Retrieve full content of a memory by ID (L2 full detail).",
  {
    id: z.string().describe("Memory ID"),
  },
  async ({ id }) => {
    const memory = db.getById(id);
    if (!memory) {
      return {
        content: [{ type: "text", text: `Memory not found: ${id}` }],
        isError: true,
      };
    }

    db.recordMetric("recall", { id });

    const text = [
      `# ${memory.title}`,
      `Type: ${memory.type} | Priority: P${memory.priority}`,
      `Tags: ${memory.tags.join(", ") || "none"}`,
      `Created: ${memory.created_at} | Updated: ${memory.updated_at}`,
      memory.expires_at ? `Expires: ${memory.expires_at}` : null,
      "",
      memory.content,
    ]
      .filter(Boolean)
      .join("\n");

    return { content: [{ type: "text", text }] };
  },
);

server.tool(
  "mem_store",
  "Manually store a new memory. Use for important information that should persist.",
  {
    title: z.string().describe("Memory title"),
    summary: z.string().describe("One-line summary for L1 display"),
    content: z.string().describe("Full content"),
    type: z
      .enum(["diary", "insight", "knowledge", "shared"])
      .default("insight")
      .describe("Memory type"),
    priority: z
      .number()
      .min(0)
      .max(2)
      .default(1)
      .describe("Priority: 0=permanent, 1=90d, 2=30d"),
    tags: z
      .array(z.string())
      .optional()
      .default([])
      .describe("Tags for categorization"),
  },
  async ({ title, summary, content, type, priority, tags }) => {
    const existing = db.search(title, 3);
    const duplicate = existing.find(
      (r) =>
        r.memory.title.toLowerCase() === title.toLowerCase() &&
        r.memory.type === type,
    );

    if (duplicate) {
      db.update(duplicate.memory.id, { content, summary });
      db.recordMetric("store_update", { id: duplicate.memory.id });
      return {
        content: [
          {
            type: "text",
            text: `Updated existing memory: ${duplicate.memory.id}`,
          },
        ],
      };
    }

    let expiresAt: string | null = null;
    if (priority === 2) {
      expiresAt = new Date(
        Date.now() + config.ttl.diary_days * 86400000,
      ).toISOString();
    } else if (priority === 1) {
      expiresAt = new Date(
        Date.now() + config.ttl.insight_days * 86400000,
      ).toISOString();
    }

    const memory = db.insert({
      type: type as MemoryType,
      priority: priority as Priority,
      title,
      summary,
      content,
      tags,
      expires_at: expiresAt,
    });

    db.recordMetric("store", { id: memory.id, type, priority });

    return {
      content: [
        { type: "text", text: `Stored memory: ${memory.id} (${type}/P${priority})` },
      ],
    };
  },
);

server.tool(
  "mem_stats",
  "Show memory system statistics dashboard.",
  {},
  async () => {
    const stats = db.stats();
    const text = [
      "# MichiMem Stats",
      "",
      `Total memories: ${stats.total}`,
      "",
      "## By Type",
      ...Object.entries(stats.by_type).map(
        ([k, v]) => `- ${k}: ${v}`,
      ),
      "",
      "## By Priority",
      ...Object.entries(stats.by_priority).map(
        ([k, v]) => `- ${k}: ${v}`,
      ),
      "",
      `Expired (pending cleanup): ${stats.expired}`,
    ].join("\n");

    return { content: [{ type: "text", text }] };
  },
);

server.tool(
  "mem_restore",
  "Manually restore context from the latest checkpoint for this session. Use after compaction if context was lost.",
  {
    session_id: z.string().describe("Session ID to restore from"),
  },
  async ({ session_id }) => {
    const checkpoint = getLatestCheckpoint(config, session_id);
    if (!checkpoint) {
      return {
        content: [
          {
            type: "text",
            text: "No checkpoint found for this session.",
          },
        ],
        isError: true,
      };
    }

    db.recordMetric("restore", { session_id });
    const text = buildRestoreContext(checkpoint);

    return { content: [{ type: "text", text }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MichiMem MCP server failed to start:", err);
  process.exit(1);
});
