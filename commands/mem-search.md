---
description: Search MichiMem memories by keyword or phrase
---

Search the MichiMem memory store using the query provided by the user as ARGUMENT.

1. Call the `mem_search` MCP tool with the user's query
2. Display results in a concise table format showing: title, type, priority, and a truncated summary
3. If the user wants more detail on a specific result, use `mem_recall` with the memory ID
4. If no results are found, suggest alternative search terms or broader queries
