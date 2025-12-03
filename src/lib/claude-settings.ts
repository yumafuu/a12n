/**
 * Utilities for generating Claude Code settings.local.json
 */

export interface ClaudeSettings {
  permissions: {
    allow: string[];
    deny: string[];
    ask?: string[];
  };
}

/**
 * Default deny rules for security
 */
const DEFAULT_DENY_RULES = [
  "Bash(rm -rf /)",
  "Bash(rm -rf ~)",
  "Bash(rm -rf *)",
  "Bash(curl http://*)",
  "Bash(git push --force*)",
  "Bash(git reset --hard*)",
  "Read(./.env)",
  "Read(./.env.*)",
  "Read(./secrets/**)",
  "Read(**/credentials.json)",
  "Read(**/*.key)",
  "Read(**/*.pem)",
];

/**
 * Common allow rules for all agents (Planner, Worker, Reviewer)
 */
const COMMON_ALLOW_RULES = [
  // File reading
  "Read",
  "Grep",
  "Glob",
  // Basic bash commands
  "Bash(ls *)",
  "Bash(pwd)",
  "Bash(cd *)",
  "Bash(mkdir *)",
  "Bash(cp *)",
  "Bash(mv *)",
  "Bash(echo *)",
  "Bash(cat *)",
  "Bash(grep *)",
  "Bash(find *)",
  // Git commands
  "Bash(git *)",
  // GitHub CLI
  "Bash(gh *)",
  // All MCP aiorchestration tools (wildcard)
  "mcp__aiorchestration__*",
];

/**
 * Worker-specific allow rules (includes file editing and build tools)
 */
const WORKER_ALLOW_RULES = [
  ...COMMON_ALLOW_RULES,
  "Write",
  "Edit",
  "Bash(npm *)",
  "Bash(bun *)",
  "Bash(yarn *)",
  "Bash(pnpm *)",
  "Bash(node *)",
  "Bash(python *)",
];

/**
 * Reviewer-specific allow rules (read-only focus)
 */
const REVIEWER_ALLOW_RULES = [
  ...COMMON_ALLOW_RULES,
];

/**
 * Planner-specific allow rules (code exploration focus)
 */
const PLANNER_ALLOW_RULES = [
  ...COMMON_ALLOW_RULES,
];

/**
 * Generate settings.local.json for Worker
 */
export function generateWorkerSettings(): ClaudeSettings {
  return {
    permissions: {
      allow: WORKER_ALLOW_RULES,
      deny: DEFAULT_DENY_RULES,
    },
  };
}

/**
 * Generate settings.local.json for Reviewer
 */
export function generateReviewerSettings(): ClaudeSettings {
  return {
    permissions: {
      allow: REVIEWER_ALLOW_RULES,
      deny: DEFAULT_DENY_RULES,
    },
  };
}

/**
 * Generate settings.local.json for Planner
 */
export function generatePlannerSettings(): ClaudeSettings {
  return {
    permissions: {
      allow: PLANNER_ALLOW_RULES,
      deny: DEFAULT_DENY_RULES,
    },
  };
}

/**
 * Create .claude/settings.local.json file
 * @param targetPath - Directory where .claude/settings.local.json will be created
 * @param settings - Settings object to write
 */
export async function createClaudeSettings(
  targetPath: string,
  settings: ClaudeSettings
): Promise<void> {
  const claudeDir = `${targetPath}/.claude`;
  const settingsPath = `${claudeDir}/settings.local.json`;

  // Create .claude directory if it doesn't exist
  const mkdirProc = Bun.spawn(["mkdir", "-p", claudeDir], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await mkdirProc.exited;

  // Write settings file with a warning comment
  const fileContent = `{
  "_comment": "⚠️ WARNING: These settings grant Claude permission to use tools without confirmation. This is necessary for autonomous agent operation but reduces manual oversight. DO NOT modify unless you understand the security implications.",
  "permissions": ${JSON.stringify(settings.permissions, null, 4).replace(/\n/g, '\n  ')}
}
`;

  await Bun.write(settingsPath, fileContent);
}
