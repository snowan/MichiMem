export type MemoryType = "diary" | "insight" | "knowledge" | "shared";
export type Priority = 0 | 1 | 2;

export interface Memory {
  id: string;
  type: MemoryType;
  priority: Priority;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  agent_id: string;
  source_ids: string[];
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

export interface MemoryInput {
  type: MemoryType;
  priority: Priority;
  title: string;
  summary: string;
  content: string;
  tags?: string[];
  agent_id?: string;
  source_ids?: string[];
  expires_at?: string | null;
}

export interface SearchResult {
  memory: Memory;
  rank: number;
}

export interface CheckpointData {
  session_id: string;
  timestamp: string;
  current_task: string;
  decisions: string[];
  files_modified: string[];
  corrections: string[];
  context_summary: string;
}

export interface MichiMemConfig {
  data_dir: string;
  ttl: {
    diary_days: number;
    insight_days: number;
  };
  tokens: {
    l0_budget: number;
    l1_budget: number;
    checkpoint_budget: number;
  };
  compounding: {
    diary_threshold: number;
    insight_threshold: number;
  };
}
