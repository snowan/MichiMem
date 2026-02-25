import fs from "node:fs";
import path from "node:path";
import type { MichiMemConfig } from "./types.js";

const DEFAULT_DATA_DIR = path.join(
  process.env.HOME || "~",
  ".claude",
  "memory",
  "michimem",
);

const DEFAULTS: MichiMemConfig = {
  data_dir: DEFAULT_DATA_DIR,
  ttl: {
    diary_days: 30,
    insight_days: 90,
  },
  tokens: {
    l0_budget: 200,
    l1_budget: 500,
    checkpoint_budget: 500,
  },
  compounding: {
    diary_threshold: 5,
    insight_threshold: 3,
  },
};

let cached: MichiMemConfig | null = null;

export function loadConfig(): MichiMemConfig {
  if (cached) return cached;

  const configPath = path.join(DEFAULT_DATA_DIR, "config.json");

  let userConfig: Partial<MichiMemConfig> = {};
  try {
    if (fs.existsSync(configPath)) {
      userConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch {
    // Use defaults on parse error
  }

  cached = {
    ...DEFAULTS,
    ...userConfig,
    ttl: { ...DEFAULTS.ttl, ...userConfig.ttl },
    tokens: { ...DEFAULTS.tokens, ...userConfig.tokens },
    compounding: { ...DEFAULTS.compounding, ...userConfig.compounding },
  };

  return cached;
}

export function ensureDataDirs(config: MichiMemConfig): void {
  const dirs = [
    config.data_dir,
    path.join(config.data_dir, "memories", "diary"),
    path.join(config.data_dir, "memories", "insights"),
    path.join(config.data_dir, "memories", "knowledge"),
    path.join(config.data_dir, "memories", "shared"),
    path.join(config.data_dir, "checkpoints"),
    path.join(config.data_dir, "archive"),
  ];

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function resetConfigCache(): void {
  cached = null;
}
