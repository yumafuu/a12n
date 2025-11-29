#!/usr/bin/env bun
/**
 * Startup script for aiorchestration
 * - Planner runs in the current pane (for human interaction)
 * - Orche, Reviewer, and workers run in a separate window (autonomous)
 */

// Generate unique window name: {dirname}-{4char uid}
function generateWindowName(): string {
  const uid = Math.random().toString(36).substring(2, 6);
  const dirname = process.cwd().split("/").pop() || "aio";
  return `${dirname}-${uid}`;
}

const WINDOW_NAME = generateWindowName();
const PROJECT_ROOT = import.meta.dir.replace("/scripts", "");

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

  const insideTmux = await isInsideTmux();

  if (!insideTmux) {
    console.error("Error: Must be run inside tmux");
    console.error("Please start tmux first: tmux");
    process.exit(1);
  }

  // Get current pane ID (will be used for planner)
  const plannerPane = await runCommand([
    "tmux",
    "display-message",
    "-p",
    "#{pane_id}",
  ]);

  // Create new window for orche, reviewer, and workers
  console.log(`Creating agents window: ${WINDOW_NAME}`);
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

  // Split horizontally for reviewer
  await runCommand([
    "tmux",
    "split-window",
    "-t",
    WINDOW_NAME,
    "-h",
  ]);

  // Get reviewer pane ID (the new pane after split)
  const reviewerPane = await runCommand([
    "tmux",
    "display-message",
    "-t",
    WINDOW_NAME,
    "-p",
    "#{pane_id}",
  ]);

  // Start orche in left pane (with pane IDs for watcher)
  const orcheCmd = `PLANNER_PANE=${plannerPane} ORCHE_PANE=${orchePane} REVIEWER_PANE=${reviewerPane} claude --dangerously-skip-permissions --mcp-config ${PROJECT_ROOT}/orche.json --system-prompt "$(cat ${PROJECT_ROOT}/orche-prompt.md)" "起動しました。check_messages を呼んで Planner からのタスクを確認してください。"`;
  await runCommand(["tmux", "send-keys", "-t", orchePane, orcheCmd]);
  await runCommand(["tmux", "send-keys", "-t", orchePane, "Enter"]);

  // Start reviewer in right pane
  const reviewerCmd = `claude --dangerously-skip-permissions --mcp-config ${PROJECT_ROOT}/reviewer.json --system-prompt "$(cat ${PROJECT_ROOT}/reviewer-prompt.md)" "起動しました。check_messages を呼んでレビュー依頼を確認してください。"`;
  await runCommand(["tmux", "send-keys", "-t", reviewerPane, reviewerCmd]);
  await runCommand(["tmux", "send-keys", "-t", reviewerPane, "Enter"]);

  console.log("");
  console.log("Setup complete!");
  console.log(`  Current pane (${plannerPane}): Planner (human interaction)`);
  console.log(`  Window '${WINDOW_NAME}':`);
  console.log(`    - Left pane (${orchePane}): Orche (workers spawn here)`);
  console.log(`    - Right pane (${reviewerPane}): Reviewer (autonomous)`);
  console.log("");
  console.log("Starting planner...");
  console.log("");

  // Start planner in current pane (human interaction)
  const plannerCmd = `claude --mcp-config ${PROJECT_ROOT}/planner.json --system-prompt "$(cat ${PROJECT_ROOT}/planner-prompt.md)"`;

  const proc = Bun.spawn(["bash", "-c", plannerCmd], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
}

main().catch(console.error);
