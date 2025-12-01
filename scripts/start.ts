#!/usr/bin/env bun
/**
 * CLI script for aiorchestration
 * Supports subcommands: start, stop, status, clean
 */

import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "fs";
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
function setupGeneratedConfigs(uid: string): void {
  // Create .generated directory if it doesn't exist
  mkdirSync(GENERATED_DIR, { recursive: true });

  // Create .aio directory in target repo for DB
  mkdirSync(join(TARGET_REPO, ".aio"), { recursive: true });

  // Generate config files for each role
  // Note: orche config is generated for compatibility but not used (orche runs as bun process)
  const configs = {
    planner: generateMcpConfig("planner"),
    orche: generateMcpConfig("orche", {
      TARGET_REPO_ROOT: TARGET_REPO,
      PROJECT_ROOT: PROJECT_ROOT,
      GENERATED_DIR: GENERATED_DIR,
      SESSION_UID: uid,
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

// Subcommand: start (default behavior)
async function startSession() {
  const UID = generateUid();
  const WINDOW_NAME = `agents-${UID}`;

  console.log("Starting aiorchestration...");
  console.log(`Window name: ${WINDOW_NAME}`);
  console.log(`Project root: ${PROJECT_ROOT}`);
  console.log(`Target repo: ${TARGET_REPO}`);
  console.log(`Database: ${TARGET_REPO}/.aio/aiorchestration.db`);

  // Generate MCP config files dynamically
  setupGeneratedConfigs(UID);

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

  // Start orche as bun process (instead of claude CLI)
  const DB_PATH = join(TARGET_REPO, ".aio", "aiorchestration.db");
  const orcheCmd = `DB_PATH=${DB_PATH} TARGET_REPO_ROOT=${TARGET_REPO} PROJECT_ROOT=${PROJECT_ROOT} SESSION_UID=${UID} bun run ${PROJECT_ROOT}/src/orche-process.ts`;
  await runCommand(["tmux", "send-keys", "-t", orchePane, orcheCmd]);
  await runCommand(["tmux", "send-keys", "-t", orchePane, "Enter"]);

  // Reviewer is not started on startup (on-demand only, launched by orche-process)

  console.log("");
  console.log("Setup complete!");
  console.log(`  Planner pane (${plannerPane}): Running in current pane`);
  console.log(`  Orche window '${WINDOW_NAME}':`);
  console.log(`    - Pane (${orchePane}): Orche (workers spawn here)`);
  console.log(`    - Reviewer will be spawned on-demand by orche`);
  console.log("");
  console.log("Switch to orche window:");
  console.log(`  tmux select-window -t ${WINDOW_NAME}`);
  console.log("");
}

// Subcommand: stop [uid]
async function stopSession(uid?: string) {
  const insideTmux = await isInsideTmux();

  if (!insideTmux) {
    console.error("Error: Must be run inside tmux");
    process.exit(1);
  }

  if (uid) {
    // Stop specific session by UID
    const windowName = `agents-${uid}`;
    try {
      const windows = await runCommand(["tmux", "list-windows", "-F", "#{window_name}"]);
      const windowList = windows.split("\n");

      if (windowList.includes(windowName)) {
        await runCommand(["tmux", "kill-window", "-t", windowName]);
        console.log(`Stopped session: ${uid}`);
      } else {
        console.error(`Session not found: ${uid}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Failed to stop session: ${error}`);
      process.exit(1);
    }
  } else {
    // Stop all aiorchestration sessions
    try {
      const windows = await runCommand(["tmux", "list-windows", "-F", "#{window_name}"]);
      const windowList = windows.split("\n").filter((w) => w.startsWith("agents-"));

      if (windowList.length === 0) {
        console.log("No aiorchestration sessions found");
        return;
      }

      for (const windowName of windowList) {
        await runCommand(["tmux", "kill-window", "-t", windowName]);
        const uid = windowName.replace("agents-", "");
        console.log(`Stopped session: ${uid}`);
      }
    } catch (error) {
      console.error(`Failed to stop sessions: ${error}`);
      process.exit(1);
    }
  }
}

// Subcommand: status
async function showStatus() {
  const insideTmux = await isInsideTmux();

  if (!insideTmux) {
    console.error("Error: Must be run inside tmux");
    process.exit(1);
  }

  try {
    const windows = await runCommand(["tmux", "list-windows", "-F", "#{window_name}:#{window_id}"]);
    const windowList = windows
      .split("\n")
      .filter((w) => w.startsWith("agents-"))
      .map((w) => {
        const [name, id] = w.split(":");
        return { uid: name.replace("agents-", ""), windowId: id };
      });

    if (windowList.length === 0) {
      console.log("No aiorchestration sessions running");
      return;
    }

    console.log("Active aiorchestration sessions:");
    for (const { uid, windowId } of windowList) {
      const panes = await runCommand([
        "tmux",
        "list-panes",
        "-t",
        windowId,
        "-F",
        "#{pane_title}",
      ]);
      const paneList = panes.split("\n").filter((p) => p);
      console.log(`  - Session: ${uid}`);
      console.log(`    Window: ${windowId}`);
      console.log(`    Panes: ${paneList.join(", ")}`);
    }

    // Check database status
    const dbPath = join(TARGET_REPO, ".aio", "aiorchestration.db");
    if (existsSync(dbPath)) {
      console.log(`\nDatabase: ${dbPath} (exists)`);
    } else {
      console.log(`\nDatabase: ${dbPath} (not found)`);
    }
  } catch (error) {
    console.error(`Failed to show status: ${error}`);
    process.exit(1);
  }
}

// Subcommand: clean
async function cleanData() {
  const aioDir = join(TARGET_REPO, ".aio");

  if (!existsSync(aioDir)) {
    console.log("No data to clean (no .aio directory found)");
    return;
  }

  try {
    // Check for active sessions
    const insideTmux = await isInsideTmux();
    if (insideTmux) {
      const windows = await runCommand(["tmux", "list-windows", "-F", "#{window_name}"]);
      const hasActiveSessions = windows.split("\n").some((w) => w.startsWith("agents-"));

      if (hasActiveSessions) {
        console.error("Error: Active sessions detected. Please stop all sessions first:");
        console.error("  aio stop");
        process.exit(1);
      }
    }

    // Clean .aio directory
    rmSync(aioDir, { recursive: true, force: true });
    console.log("Cleaned aiorchestration data:");
    console.log(`  - Removed: ${aioDir}`);
  } catch (error) {
    console.error(`Failed to clean data: ${error}`);
    process.exit(1);
  }
}

// Show help
function showHelp() {
  console.log("aiorchestration - AI agent orchestration system\n");
  console.log("Usage:");
  console.log("  aio [start]       Start a new orchestration session");
  console.log("  aio stop [uid]    Stop session(s) (all if uid not specified)");
  console.log("  aio status        Show active sessions and status");
  console.log("  aio clean         Clean data files (.aio directory)");
  console.log("  aio help          Show this help message\n");
  console.log("Examples:");
  console.log("  aio               # Start new session");
  console.log("  aio stop wm3gbt   # Stop specific session");
  console.log("  aio stop          # Stop all sessions");
  console.log("  aio status        # Show all active sessions");
  console.log("  aio clean         # Clean all data files");
}

// Main entry point
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "start";

  switch (command) {
    case "start":
      await startSession();
      break;
    case "stop":
      await stopSession(args[1]);
      break;
    case "status":
      await showStatus();
      break;
    case "clean":
      await cleanData();
      break;
    case "help":
    case "--help":
    case "-h":
      showHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Run 'aio help' for usage information");
      process.exit(1);
  }
}

main().catch(console.error);
