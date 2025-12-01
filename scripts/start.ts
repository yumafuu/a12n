#!/usr/bin/env bun
/**
 * Startup script for aiorchestration
 * - Planner runs in the current pane (for human interaction)
 * - Orche, Reviewer, and workers run in a separate window (autonomous)
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  setPaneBorderColor,
  setPaneTitle,
  setWindowName,
  ROLE_COLORS,
} from "../src/lib/tmux.js";

// Generate unique identifier for this session
function generateUid(): string {
  return Math.random().toString(36).substring(2, 8);
}

const UID = generateUid();
const WINDOW_NAME = `agents-${UID}`;
const PROJECT_ROOT = import.meta.dir.replace("/scripts", "");
const TARGET_REPO = process.cwd(); // Directory where aio was launched

// Directory for generated config files (moved to .aio for multi-project support)
const GENERATED_DIR = join(TARGET_REPO, ".aio", ".generated");

// Generate MCP config for a role
function generateMcpConfig(role: string, extraEnv: Record<string, string> = {}): object {
  const DB_PATH = join(TARGET_REPO, ".aio", "aiorchestration.db");

  return {
    mcpServers: {
      aiorchestration: {
        command: "bun",
        args: ["run", join(PROJECT_ROOT, "src/mcp-server.ts"), "--role", role],
        env: {
          DB_PATH,
          ...extraEnv,
        },
      },
    },
  };
}

// Create generated config directory and write config files
function setupGeneratedConfigs(): void {
  // Create .generated directory if it doesn't exist
  mkdirSync(GENERATED_DIR, { recursive: true });

  // Create .aio directory in target repo for DB
  mkdirSync(join(TARGET_REPO, ".aio"), { recursive: true });

  // Generate config files for each role
  const configs = {
    planner: generateMcpConfig("planner"),
    orche: generateMcpConfig("orche", {
      TARGET_REPO_ROOT: TARGET_REPO,
      PROJECT_ROOT: PROJECT_ROOT,
      GENERATED_DIR: GENERATED_DIR,
      SESSION_UID: UID,
    }),
    reviewer: generateMcpConfig("reviewer"),
    worker: generateMcpConfig("worker"),
  };

  for (const [role, config] of Object.entries(configs)) {
    const configPath = join(GENERATED_DIR, `${role}.json`);
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  }

  console.log(`Generated MCP configs in: ${GENERATED_DIR}`);
}

async function runCommand(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  return output.trim();
}

async function isInsideTmux(): Promise<boolean> {
  return !!process.env.TMUX;
}

async function main() {
  console.log("Starting aiorchestration...");
  console.log(`Window name: ${WINDOW_NAME}`);
  console.log(`Project root: ${PROJECT_ROOT}`);
  console.log(`Target repo: ${TARGET_REPO}`);
  console.log(`Database: ${TARGET_REPO}/.aio/aiorchestration.db`);

  // Generate MCP config files dynamically
  setupGeneratedConfigs();

  const insideTmux = await isInsideTmux();

  if (!insideTmux) {
    console.error("Error: Must be run inside tmux");
    console.error("Please start tmux first: tmux");
    process.exit(1);
  }

  // Get current pane ID for planner
  const plannerPane = await runCommand([
    "tmux",
    "display-message",
    "-p",
    "#{pane_id}",
  ]);

  // Create new window for orche, reviewer, and workers
  console.log(`Creating orche window: ${WINDOW_NAME}`);
  await runCommand(["tmux", "new-window", "-d", "-n", WINDOW_NAME]);

  // Get orche pane (initial pane in new window)
  const orchePane = await runCommand([
    "tmux",
    "display-message",
    "-t",
    WINDOW_NAME,
    "-p",
    "#{pane_id}",
  ]);

  // Get window ID for naming
  const orcheWindow = await runCommand([
    "tmux",
    "display-message",
    "-t",
    WINDOW_NAME,
    "-p",
    "#{window_id}",
  ]);

  // Get planner window ID for naming
  const plannerWindow = await runCommand([
    "tmux",
    "display-message",
    "-t",
    plannerPane,
    "-p",
    "#{window_id}",
  ]);

  // Reviewer pane is not created on startup (on-demand only)
  const reviewerPane = "";

  // Apply colors to planner pane
  await setPaneBorderColor(plannerPane, "planner");
  await setPaneTitle(plannerPane, "Planner");

  // Apply colors to orche pane
  await setPaneBorderColor(orchePane, "orche");
  await setPaneTitle(orchePane, "Orche");

  // Set window name with UID
  await setWindowName(plannerWindow, `Planner:${UID}`);
  await setWindowName(orcheWindow, `Orche:${UID}`);

  // Start planner in planner pane
  const plannerPromptPath = join(PROJECT_ROOT, "prompts/planner-prompt.md");
  const plannerCmd = `claude --model opus --mcp-config ${GENERATED_DIR}/planner.json --system-prompt "$(cat ${plannerPromptPath})"`;
  await runCommand(["tmux", "send-keys", "-t", plannerPane, plannerCmd]);
  await runCommand(["tmux", "send-keys", "-t", plannerPane, "Enter"]);

  // Start orche in pane (with pane IDs for watcher)
  const orcheCmd = `PLANNER_PANE=${plannerPane} ORCHE_PANE=${orchePane} SESSION_UID=${UID} PROJECT_ROOT=${PROJECT_ROOT} GENERATED_DIR=${GENERATED_DIR} claude --model sonnet --dangerously-skip-permissions --mcp-config ${GENERATED_DIR}/orche.json --system-prompt "$(cat ${PROJECT_ROOT}/prompts/orche-prompt.md)" "起動しました。check_messages を呼んで Planner からのタスクを確認してください。"`;
  await runCommand(["tmux", "send-keys", "-t", orchePane, orcheCmd]);
  await runCommand(["tmux", "send-keys", "-t", orchePane, "Enter"]);

  // Reviewer is not started on startup (on-demand only, launched by watcher)

  console.log("");
  console.log("Setup complete!");
  console.log(`  Planner pane (${plannerPane}): Running in current pane`);
  console.log(`  Orche window '${WINDOW_NAME}':`);
  console.log(`    - Pane (${orchePane}): Orche (workers spawn here)`);
  console.log(`    - Reviewer will be spawned on-demand by watcher`);
  console.log("");
  console.log("Switch to orche window:");
  console.log(`  tmux select-window -t ${WINDOW_NAME}`);
  console.log("");
}

main().catch(console.error);
