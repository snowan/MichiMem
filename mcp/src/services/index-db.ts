import Database from "better-sqlite3";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type {
  Memory,
  MemoryInput,
  MemoryType,
  SearchResult,
} from "../../../src/types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('diary','insight','knowledge','shared')),
  priority INTEGER NOT NULL CHECK(priority IN (0,1,2)),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  agent_id TEXT NOT NULL DEFAULT '',
  source_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  id UNINDEXED,
  title,
  summary,
  content,
  tags,
  content='memories',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, id, title, summary, content, tags)
  VALUES (new.rowid, new.id, new.title, new.summary, new.content, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, id, title, summary, content, tags)
  VALUES ('delete', old.rowid, old.id, old.title, old.summary, old.content, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, id, title, summary, content, tags)
  VALUES ('delete', old.rowid, old.id, old.title, old.summary, old.content, old.tags);
  INSERT INTO memories_fts(rowid, id, title, summary, content, tags)
  VALUES (new.rowid, new.id, new.title, new.summary, new.content, new.tags);
END;

CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
`;

export class IndexDB {
  private db: Database.Database;

  constructor(dataDir: string) {
    const dbPath = path.join(dataDir, "index.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  insert(input: MemoryInput): Memory {
    const now = new Date().toISOString();
    const memory: Memory = {
      id: uuidv4(),
      type: input.type,
      priority: input.priority,
      title: input.title,
      summary: input.summary,
      content: input.content,
      tags: input.tags ?? [],
      agent_id: input.agent_id ?? "",
      source_ids: input.source_ids ?? [],
      created_at: now,
      updated_at: now,
      expires_at: input.expires_at ?? null,
    };

    this.db
      .prepare(
        `INSERT INTO memories (id, type, priority, title, summary, content, tags, agent_id, source_ids, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        memory.id,
        memory.type,
        memory.priority,
        memory.title,
        memory.summary,
        memory.content,
        JSON.stringify(memory.tags),
        memory.agent_id,
        JSON.stringify(memory.source_ids),
        memory.created_at,
        memory.updated_at,
        memory.expires_at,
      );

    return memory;
  }

  getById(id: string): Memory | null {
    const row = this.db
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;

    return row ? this.rowToMemory(row) : null;
  }

  search(query: string, limit = 10): SearchResult[] {
    const rows = this.db
      .prepare(
        `SELECT m.*, rank
       FROM memories_fts f
       JOIN memories m ON f.id = m.id
       WHERE memories_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
      )
      .all(query, limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      memory: this.rowToMemory(row),
      rank: row.rank as number,
    }));
  }

  getByType(type: MemoryType, limit = 50): Memory[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM memories WHERE type = ? ORDER BY updated_at DESC LIMIT ?",
      )
      .all(type, limit) as Array<Record<string, unknown>>;

    return rows.map((r) => this.rowToMemory(r));
  }

  getByPriority(priority: number, limit = 50): Memory[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM memories WHERE priority = ? ORDER BY updated_at DESC LIMIT ?",
      )
      .all(priority, limit) as Array<Record<string, unknown>>;

    return rows.map((r) => this.rowToMemory(r));
  }

  getExpired(): Memory[] {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare(
        "SELECT * FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?",
      )
      .all(now) as Array<Record<string, unknown>>;

    return rows.map((r) => this.rowToMemory(r));
  }

  getUnprocessedDiaries(limit = 50): Memory[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM memories
       WHERE type = 'diary' AND id NOT IN (
         SELECT json_each.value FROM memories, json_each(memories.source_ids)
         WHERE memories.type = 'insight'
       )
       ORDER BY created_at ASC
       LIMIT ?`,
      )
      .all(limit) as Array<Record<string, unknown>>;

    return rows.map((r) => this.rowToMemory(r));
  }

  update(
    id: string,
    fields: Partial<Pick<Memory, "title" | "summary" | "content" | "tags" | "priority" | "expires_at">>,
  ): boolean {
    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(fields)) {
      if (key === "tags") {
        sets.push("tags = ?");
        values.push(JSON.stringify(value));
      } else {
        sets.push(`${key} = ?`);
        values.push(value);
      }
    }

    sets.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);

    const result = this.db
      .prepare(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values);

    return result.changes > 0;
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM memories WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  stats(): {
    total: number;
    by_type: Record<string, number>;
    by_priority: Record<string, number>;
    expired: number;
  } {
    const total = (
      this.db.prepare("SELECT COUNT(*) as c FROM memories").get() as {
        c: number;
      }
    ).c;

    const byTypeRows = this.db
      .prepare("SELECT type, COUNT(*) as c FROM memories GROUP BY type")
      .all() as Array<{ type: string; c: number }>;
    const by_type: Record<string, number> = {};
    for (const r of byTypeRows) by_type[r.type] = r.c;

    const byPriorityRows = this.db
      .prepare("SELECT priority, COUNT(*) as c FROM memories GROUP BY priority")
      .all() as Array<{ priority: number; c: number }>;
    const by_priority: Record<string, number> = {};
    for (const r of byPriorityRows) by_priority[`P${r.priority}`] = r.c;

    const expired = (
      this.db
        .prepare(
          "SELECT COUNT(*) as c FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?",
        )
        .get(new Date().toISOString()) as { c: number }
    ).c;

    return { total, by_type, by_priority, expired };
  }

  recordMetric(event: string, data: Record<string, unknown> = {}): void {
    this.db
      .prepare(
        "INSERT INTO metrics (event, data, created_at) VALUES (?, ?, ?)",
      )
      .run(event, JSON.stringify(data), new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }

  private rowToMemory(row: Record<string, unknown>): Memory {
    return {
      id: row.id as string,
      type: row.type as MemoryType,
      priority: row.priority as 0 | 1 | 2,
      title: row.title as string,
      summary: row.summary as string,
      content: row.content as string,
      tags: JSON.parse((row.tags as string) || "[]"),
      agent_id: row.agent_id as string,
      source_ids: JSON.parse((row.source_ids as string) || "[]"),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      expires_at: (row.expires_at as string) || null,
    };
  }
}
