import { loadConfig, ensureDataDirs } from "../src/config.js";
import { createCheckpoint, getLatestCheckpoint } from "../src/checkpoint.js";
import { buildL0Context, buildRestoreContext } from "../src/injector.js";
import { IndexDB } from "../mcp/src/services/index-db.js";

interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  source?: string;
  trigger?: string;
  custom_instructions?: string;
  stop_hook_active?: boolean;
  reason?: string;
}

async function main() {
  const eventName = process.argv[2];
  if (!eventName) {
    process.exit(1);
  }

  let input: HookInput;
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    input = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    process.exit(1);
  }

  const config = loadConfig();
  ensureDataDirs(config);

  switch (eventName) {
    case "SessionStart":
      handleSessionStart(input, config);
      break;
    case "PreCompact":
      handlePreCompact(input, config);
      break;
    case "Stop":
      handleStop(input, config);
      break;
    case "SessionEnd":
      handleSessionEnd(input, config);
      break;
    default:
      process.exit(0);
  }
}

function handleSessionStart(
  input: HookInput,
  config: ReturnType<typeof loadConfig>,
) {
  const parts: string[] = [];

  const l0 = buildL0Context(config);
  if (l0) parts.push(l0);

  if (input.source === "compact") {
    const checkpoint = getLatestCheckpoint(config, input.session_id);
    if (checkpoint) {
      parts.push(buildRestoreContext(checkpoint));
    }
  }

  if (parts.length === 0) {
    process.exit(0);
    return;
  }

  const output = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: parts.join("\n\n"),
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

function handlePreCompact(
  input: HookInput,
  config: ReturnType<typeof loadConfig>,
) {
  const result = createCheckpoint(
    config,
    input.session_id,
    input.transcript_path,
  );

  const db = new IndexDB(config.data_dir);
  try {
    db.recordMetric("precompact", {
      session_id: input.session_id,
      trigger: input.trigger,
      checkpoint_created: result !== null,
    });
  } finally {
    db.close();
  }

  if (result) {
    process.stderr.write(`MichiMem: checkpoint saved`);
  }
  process.exit(0);
}

function handleStop(
  input: HookInput,
  config: ReturnType<typeof loadConfig>,
) {
  if (input.stop_hook_active) {
    process.exit(0);
    return;
  }

  const db = new IndexDB(config.data_dir);
  try {
    db.recordMetric("stop", {
      session_id: input.session_id,
    });
  } finally {
    db.close();
  }

  process.exit(0);
}

function handleSessionEnd(
  input: HookInput,
  config: ReturnType<typeof loadConfig>,
) {
  const db = new IndexDB(config.data_dir);
  try {
    db.recordMetric("session_end", {
      session_id: input.session_id,
      reason: input.reason,
    });

    const expired = db.getExpired();
    for (const mem of expired) {
      db.delete(mem.id);
      db.recordMetric("expired", { id: mem.id, type: mem.type });
    }
  } finally {
    db.close();
  }

  process.exit(0);
}

main().catch(() => process.exit(1));
