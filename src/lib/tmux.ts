import { $ } from "bun";

// Role-based color configuration
// Using distinct colors for easy visual identification
export const ROLE_COLORS = {
  planner: {
    fg: "white",
    bg: "colour54",      // Purple - for human interaction
    border: "colour54",
    paneBgActive: "colour235",   // Active pane background
    paneBgInactive: "colour237", // Inactive pane background (grayer)
  },
  orche: {
    fg: "white",
    bg: "colour24",      // Blue - orchestrator
    border: "colour24",
    paneBgActive: "colour235",
    paneBgInactive: "colour237",
  },
  reviewer: {
    fg: "colour226",     // Bright yellow text
    bg: "colour58",      // Dark olive background
    border: "colour226", // Bright yellow border
    paneBgActive: "colour235",
    paneBgInactive: "colour237",
  },
  worker: {
    fg: "white",
    bg: "colour22",      // Green - workers
    border: "colour22",
    paneBgActive: "colour234",   // Very dark gray for subtle background tint
    paneBgInactive: "colour237", // Grayer when inactive
  },
} as const;

export type RoleType = keyof typeof ROLE_COLORS;

// Helper function to run tmux commands with proper error handling
async function runTmuxCommand(args: string[]): Promise<string> {
  const proc = Bun.spawn(["tmux", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`tmux command failed: ${stderr}`);
  }

  return output.trim();
}

// Set pane border style for same-window roles (Orche, Reviewer)
export async function setPaneBorderColor(
  paneId: string,
  role: RoleType
): Promise<void> {
  await checkTmux();
  const color = ROLE_COLORS[role];

  try {
    // Set window-style for inactive panes (applies to all panes in window)
    const paneBgInactive = "paneBgInactive" in color ? color.paneBgInactive : "colour237";
    await runTmuxCommand([
      "set-option", "-t", paneId, "-p", "window-style", `bg=${paneBgInactive}`
    ]);

    // Set window-active-style for active pane
    const paneBgActive = "paneBgActive" in color ? color.paneBgActive : "colour235";
    await runTmuxCommand([
      "set-option", "-t", paneId, "-p", "window-active-style", `bg=${paneBgActive}`
    ]);

    // Set pane-specific border style
    await runTmuxCommand([
      "set-option", "-t", paneId, "-p", "pane-border-style", `fg=${color.border}`
    ]);

    // Set active border style
    await runTmuxCommand([
      "set-option", "-t", paneId, "-p", "pane-active-border-style", `fg=${color.border},bold`
    ]);
  } catch (error) {
    throw new Error(`Failed to set pane border color: ${(error as Error).message}`);
  }
}

// Set pane title for identification
export async function setPaneTitle(
  paneId: string,
  title: string
): Promise<void> {
  await checkTmux();

  try {
    await runTmuxCommand(["select-pane", "-t", paneId, "-T", title]);
  } catch (error) {
    throw new Error(`Failed to set pane title: ${(error as Error).message}`);
  }
}

// Set window style for Worker windows (background color)
export async function setWindowStyle(
  windowId: string,
  role: RoleType
): Promise<void> {
  await checkTmux();
  const color = ROLE_COLORS[role];

  try {
    // Get the pane ID of the window's first pane
    const paneId = await runTmuxCommand([
      "display-message", "-t", windowId, "-p", "#{pane_id}"
    ]);

    // Set window-style for inactive panes
    const paneBgInactive = "paneBgInactive" in color ? color.paneBgInactive : "colour237";
    await runTmuxCommand([
      "set-option", "-t", paneId, "-p", "window-style", `bg=${paneBgInactive}`
    ]);

    // Set window-active-style for active pane
    const paneBgActive = "paneBgActive" in color ? color.paneBgActive : "colour235";
    await runTmuxCommand([
      "set-option", "-t", paneId, "-p", "window-active-style", `bg=${paneBgActive}`
    ]);

    // Set window status format with color
    await runTmuxCommand([
      "set-window-option", "-t", windowId, "window-status-style",
      `bg=${color.bg},fg=${color.fg}`
    ]);

    // Set active window status format
    await runTmuxCommand([
      "set-window-option", "-t", windowId, "window-status-current-style",
      `bg=${color.bg},fg=${color.fg},bold`
    ]);

    // Set pane border colors for worker window
    await runTmuxCommand([
      "set-option", "-t", paneId, "-p", "pane-border-style", `fg=${color.border}`
    ]);

    await runTmuxCommand([
      "set-option", "-t", paneId, "-p", "pane-active-border-style", `fg=${color.border},bold`
    ]);
  } catch (error) {
    throw new Error(`Failed to set window style: ${(error as Error).message}`);
  }
}

// Rename window with role prefix
export async function setWindowName(
  windowId: string,
  name: string
): Promise<void> {
  await checkTmux();

  try {
    await runTmuxCommand(["rename-window", "-t", windowId, name]);
  } catch (error) {
    throw new Error(`Failed to rename window: ${(error as Error).message}`);
  }
}

export async function checkTmux(): Promise<void> {
  try {
    await $`which tmux`.quiet();
  } catch {
    throw new Error("tmux is not installed or not in PATH");
  }
}

export async function listSessions(): Promise<string> {
  await checkTmux();
  try {
    const result =
      await $`tmux list-sessions -F "#{session_name}: #{session_windows} windows"`.text();
    return result || "No tmux sessions found";
  } catch (error) {
    if ((error as Error).message.includes("no server running")) {
      return "No tmux server running";
    }
    throw new Error(`Failed to list sessions: ${(error as Error).message}`);
  }
}

export async function listPanes(target?: string): Promise<string> {
  await checkTmux();
  try {
    const targetArg = target ? `-t ${target}` : "";
    const result =
      await $`tmux list-panes ${targetArg} -F "#{pane_id} (#{pane_index}): #{pane_current_command} [#{pane_width}x#{pane_height}]"`.text();
    return result || "No panes found";
  } catch (error) {
    throw new Error(`Failed to list panes: ${(error as Error).message}`);
  }
}

export async function splitPane(
  direction: "horizontal" | "vertical",
  command?: string,
  target?: string
): Promise<string> {
  await checkTmux();
  try {
    const dirFlag = direction === "horizontal" ? "-h" : "-v";

    // Build command array for proper escaping
    const args: string[] = ["tmux", "split-window", dirFlag];

    if (target) {
      args.push("-t", target);
    }

    // Return the new pane ID
    args.push("-P", "-F", "#{pane_id}");

    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(stderr);
    }

    const paneId = output.trim();

    // If command provided, send it to the new pane via send-keys
    // This allows shell expansion like $(...)
    if (command) {
      await sendKeys(paneId, command, true);
    }

    return paneId;
  } catch (error) {
    throw new Error(`Failed to split pane: ${(error as Error).message}`);
  }
}

export async function sendKeys(
  target: string,
  keys: string,
  enter: boolean = true
): Promise<void> {
  await checkTmux();
  try {
    const args = ["tmux", "send-keys", "-t", target, keys];
    if (enter) {
      args.push("Enter");
    }

    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(stderr);
    }
  } catch (error) {
    throw new Error(`Failed to send keys: ${(error as Error).message}`);
  }
}

export async function killPane(target: string): Promise<void> {
  await checkTmux();
  try {
    await $`tmux kill-pane -t ${target}`.quiet();
  } catch (error) {
    throw new Error(`Failed to kill pane: ${(error as Error).message}`);
  }
}

export async function newWindow(
  command?: string,
  target?: string
): Promise<string> {
  await checkTmux();
  try {
    // Build command array for proper escaping
    const args: string[] = ["tmux", "new-window"];

    if (target) {
      args.push("-t", target);
    }

    // Return the new window ID
    args.push("-P", "-F", "#{window_id}");

    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(stderr);
    }

    const windowId = output.trim();

    // If command provided, send it to the new window via send-keys
    // This allows shell expansion like $(...)
    if (command) {
      await sendKeys(windowId, command, true);
    }

    return windowId;
  } catch (error) {
    throw new Error(`Failed to create new window: ${(error as Error).message}`);
  }
}

export async function killWindow(target: string): Promise<void> {
  await checkTmux();
  try {
    await $`tmux kill-window -t ${target}`.quiet();
  } catch (error) {
    throw new Error(`Failed to kill window: ${(error as Error).message}`);
  }
}

export async function getPaneId(): Promise<string> {
  await checkTmux();
  try {
    const result = await $`tmux display-message -p "#{pane_id}"`.text();
    return result.trim();
  } catch (error) {
    throw new Error(`Failed to get pane ID: ${(error as Error).message}`);
  }
}
