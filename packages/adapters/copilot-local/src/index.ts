import type { AdapterModelProfileDefinition } from "@paperclipai/adapter-utils";

export const type = "copilot_local";
export const label = "GitHub Copilot";

export const SANDBOX_INSTALL_COMMAND = "npm install -g @github/copilot-cli";

export const models: Array<{ id: string; label: string }> = [
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "claude-sonnet-4", label: "Claude Sonnet 4" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
];

export const modelProfiles: AdapterModelProfileDefinition[] = [
  {
    key: "cheap",
    label: "Cheap",
    description: "Use the lowest-cost model lane for recovery retries and other low-cost tasks.",
    adapterConfig: {
      model: "gpt-4o",
    },
    source: "adapter_default",
  },
];

export const agentConfigurationDoc = `# copilot_local agent configuration

Adapter: copilot_local

Use when:
- You want Paperclip to run the GitHub Copilot CLI locally as an agent runtime
- You need a one-shot prompt executed via \`copilot -p\` for each heartbeat
- You have GitHub Copilot installed and authenticated on the host machine

Don't use when:
- You need webhook-style external invocation (use http or openclaw_gateway)
- You only need one-shot shell commands (use process)
- GitHub Copilot CLI is not installed or authenticated on the machine

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to the run prompt
- model (string, optional): model hint passed via \`--model\` flag. Defaults to letting Copilot choose.
- allowAllTools (boolean, optional, default true): pass \`--allow-all-tools\` for unattended execution.
- allowedTools (string[], optional): specific tools to allow via \`--allow-tool\` flags. Takes precedence over allowAllTools when set.
- denyTools (string[], optional): specific tools to deny via \`--deny-tool\` flags.
- promptTemplate (string, optional): run prompt template
- command (string, optional): defaults to "copilot"
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables
- workspaceStrategy (object, optional): execution workspace strategy; currently supports { type: "git_worktree", baseRef?, branchTemplate?, worktreeParentDir? }

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- Paperclip runs Copilot in one-shot mode: \`copilot -p "<prompt>" [flags]\`.
- Copilot CLI must be installed and authenticated before use. The CLI binary is typically installed via \`npm install -g @github/copilot-cli\`, Homebrew, or the GitHub CLI extension.
- Authentication is handled by \`gh auth login\` and \`gh extension install github/gh-copilot\` in recent versions, or the standalone copilot binary.
- For non-interactive Paperclip runs, \`--allow-all-tools\` is used by default so Copilot can execute shell commands and write files without prompting.
- When \`allowedTools\` is explicitly configured, it takes precedence over \`allowAllTools\`.
- This adapter does not support session resumption across heartbeats each run starts fresh.
`;
