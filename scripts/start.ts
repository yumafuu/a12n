#!/usr/bin/env bun
/**
 * Startup script for aiorchestration
 * - Planner runs in the current pane (for human interaction)
 * - Orche and workers run in a separate window
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

  // Create new window for orche and workers
  console.log(`Creating orche window: ${WINDOW_NAME}`);
  await runCommand(["tmux", "new-window", "-d", "-n", WINDOW_NAME]);

  // Get orche pane ID
  const orchePane = await runCommand([
    "tmux",
    "display-message",
    "-t",
    WINDOW_NAME,
    "-p",
    "#{pane_id}",
  ]);

  // Start orche in the new window with pane IDs for watcher
  const orcheCmd = `PLANNER_PANE=${plannerPane} ORCHE_PANE=${orchePane} claude --mcp-config ${PROJECT_ROOT}/orche.json --system-prompt "$(cat ${PROJECT_ROOT}/orche-prompt.md)" "起動しました。check_messages を呼んで Planner からのタスクを確認してください。"`;
  await runCommand(["tmux", "send-keys", "-t", WINDOW_NAME, orcheCmd]);
  await runCommand(["tmux", "send-keys", "-t", WINDOW_NAME, "Enter"]);

  console.log("");
  console.log("Setup complete!");
  console.log(`  Current pane (${plannerPane}): planner`);
  console.log(`  Window '${WINDOW_NAME}' (${orchePane}): orche (workers will spawn here)`);
  console.log("");
  console.log("Starting planner...");
  console.log("");

  // Start planner in current pane (exec replaces current process)
  const plannerCmd = `claude --mcp-config ${PROJECT_ROOT}/planner.json --system-prompt "$(cat ${PROJECT_ROOT}/planner-prompt.md)"`;

  const proc = Bun.spawn(["bash", "-c", plannerCmd], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
}

main().catch(console.error);
