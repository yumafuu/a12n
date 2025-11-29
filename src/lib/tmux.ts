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
    const args = [dirFlag];

    if (target) {
      args.push("-t", target);
    }

    // Return the new pane ID
    args.push("-P", "-F", "#{pane_id}");

    if (command) {
      args.push(command);
    }

    const result = await $`tmux split-window ${args}`.text();
    return result.trim();
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
    if (enter) {
      await $`tmux send-keys -t ${target} ${keys} Enter`.quiet();
    } else {
      await $`tmux send-keys -t ${target} ${keys}`.quiet();
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
