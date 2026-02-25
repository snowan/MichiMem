---
name: michimem
description: Use when working with persistent memories, recalling past decisions, storing important context, or when session context may have been lost due to compaction.
---

# MichiMem — Persistent Memory System

## Overview

MichiMem provides persistent memory across sessions with automatic compaction survival. Memories are tiered (L0→L1→L2) for progressive disclosure and prioritized (P0→P1→P2) by importance.

## Available Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `mem_search` | FTS5 search, returns L1 summaries | Finding relevant past context |
| `mem_recall` | Full content by ID (L2) | Need complete details |
| `mem_store` | Save a memory with dedup | Important decisions, corrections, patterns |
| `mem_stats` | Dashboard of memory counts | Checking system health |
| `mem_restore` | Restore from checkpoint | After compaction if context lost |

## When to Store Memories

**Always store (P0 — permanent):**
- User corrections ("actually, always use X instead of Y")
- Explicit preferences ("I prefer tabs over spaces")
- Accumulated project knowledge (architecture decisions, key patterns)

**Store as insights (P1 — 90 days):**
- Patterns observed across sessions
- Debugging solutions that might recur
- Project-specific conventions discovered

**Auto-captured (P2 — 30 days):**
- Session diaries (captured automatically by hooks)
- Raw task context

## Retrieval Pattern

Follow progressive disclosure — start narrow, expand only if needed:

1. **L0 (auto-injected)**: Core knowledge arrives in context at session start. No action needed.
2. **L1 (search)**: `mem_search "deployment pipeline"` → returns titles + summaries
3. **L2 (recall)**: `mem_recall <id>` → full content for a specific memory

## After Compaction

If you notice context was lost (e.g., session source is "compact"):
1. Check if `<michimem-restore>` block is in context (auto-injected)
2. If not, use `mem_restore` with the session ID
3. Use `mem_search` to find relevant prior work

## Storage Best Practices

- **Title**: Short, searchable phrase ("React auth flow uses JWT")
- **Summary**: One sentence for L1 display
- **Content**: Full detail with code snippets if relevant
- **Tags**: 2-4 lowercase tags for categorization
- Dedup is automatic — storing with an existing title updates instead of duplicating
