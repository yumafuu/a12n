import { $ } from "bun";

// Role-based color configuration
// Using distinct colors for easy visual identification
export const ROLE_COLORS = {
  planner: {
    fg: "white",
    bg: "colour54",      // Purple - for human interaction
    border: "colour54",
  },
  orche: {
    fg: "white",
    bg: "colour24",      // Blue - orchestrator
    border: "colour24",
  },
  reviewer: {
    fg: "black",
    bg: "colour142",     // Yellow/olive - reviewer
    border: "colour142",
  },
  worker: {
    fg: "white",
    bg: "colour22",      // Green - workers
    border: "colour22",
  },
} as const;

export type RoleType = keyof typeof ROLE_COLORS;

// Set pane border style for same-window roles (Orche, Reviewer)
export async function setPaneBorderColor(
  paneId: string,
  role: RoleType
): Promise<void> {
  await checkTmux();
  const color = ROLE_COLORS[role];

  try {
    // Set pane border style
    const proc = Bun.spawn(
      [
        "tmux",
        "select-pane",
        "-t",
        paneId,
        "-P",
        `fg=${color.fg},bg=default`,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await proc.exited;

    // Set pane-specific border style using pane-border-style
    // This sets the border color when this pane is active
    const proc2 = Bun.spawn(
      [
        "tmux",
        "set-option",
        "-t",
        paneId,
        "-p",
        "pane-border-style",
        `fg=${color.border}`,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await proc2.exited;

    const proc3 = Bun.spawn(
      [
        "tmux",
        "set-option",
        "-t",
        paneId,
        "-p",
        "pane-active-border-style",
        `fg=${color.border},bold`,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await proc3.exited;
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
    const proc = Bun.spawn(
      ["tmux", "select-pane", "-t", paneId, "-T", title],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await proc.exited;
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
    const proc1 = Bun.spawn(
      ["tmux", "display-message", "-t", windowId, "-p", "#{pane_id}"],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const paneId = (await new Response(proc1.stdout).text()).trim();
    await proc1.exited;

    // Set subtle background tint for worker identification
    // Using a dark variant to not interfere with readability
    const proc2 = Bun.spawn(
      [
        "tmux",
        "select-pane",
        "-t",
        paneId,
        "-P",
        `bg=colour234`,  // Very dark gray as base
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await proc2.exited;

    // Set window status format with color
    const proc3 = Bun.spawn(
      [
        "tmux",
        "set-window-option",
        "-t",
        windowId,
        "window-status-style",
        `bg=${color.bg},fg=${color.fg}`,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await proc3.exited;

    // Set active window status format
    const proc4 = Bun.spawn(
      [
        "tmux",
        "set-window-option",
        "-t",
        windowId,
        "window-status-current-style",
        `bg=${color.bg},fg=${color.fg},bold`,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await proc4.exited;

    // Set pane border colors for worker window
    const proc5 = Bun.spawn(
      [
        "tmux",
        "set-option",
        "-t",
        paneId,
        "-p",
        "pane-border-style",
        `fg=${color.border}`,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await proc5.exited;

    const proc6 = Bun.spawn(
      [
        "tmux",
        "set-option",
        "-t",
        paneId,
        "-p",
        "pane-active-border-style",
        `fg=${color.border},bold`,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await proc6.exited;
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
    const proc = Bun.spawn(
      ["tmux", "rename-window", "-t", windowId, name],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await proc.exited;
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
