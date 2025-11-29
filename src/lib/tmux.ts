import { $ } from "bun";

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

export async function getPaneId(): Promise<string> {
  await checkTmux();
  try {
    const result = await $`tmux display-message -p "#{pane_id}"`.text();
    return result.trim();
  } catch (error) {
    throw new Error(`Failed to get pane ID: ${(error as Error).message}`);
  }
}
