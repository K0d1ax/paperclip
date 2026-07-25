import type { AdapterConfigSchema } from "@paperclipai/adapter-utils";

export function getConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: "command",
        label: "Command",
        type: "text",
        default: "copilot",
        hint: "The copilot CLI command (defaults to 'copilot'). Use a full path if needed.",
      },
      {
        key: "model",
        label: "Model",
        type: "text",
        default: "",
        hint: "Model hint passed via --model. Leave empty to let Copilot choose.",
      },
      {
        key: "instructionsFilePath",
        label: "Instructions File",
        type: "text",
        default: "",
        hint: "Absolute path to a markdown instructions file prepended to each run prompt.",
      },
      {
        key: "allowAllTools",
        label: "Allow All Tools",
        type: "toggle",
        default: true,
        hint: "Pass --allow-all-tools for unattended execution. Disable and use allowedTools for granular control.",
      },
      {
        key: "allowedTools",
        label: "Allowed Tools",
        type: "textarea",
        default: "",
        hint: "Specific tool specs to allow (e.g. 'shell(git:*)', 'write'). Takes precedence over allowAllTools. One per line.",
      },
      {
        key: "denyTools",
        label: "Denied Tools",
        type: "textarea",
        default: "",
        hint: "Specific tool specs to deny (e.g. 'shell(rm)', 'shell(git push)'). One per line.",
      },
      {
        key: "cwd",
        label: "Working Directory",
        type: "text",
        default: "",
        hint: "Default absolute working directory for the agent process.",
      },
      {
        key: "extraArgs",
        label: "Extra CLI Args",
        type: "textarea",
        default: "",
        hint: "Additional CLI arguments passed to copilot. One per line.",
      },
      {
        key: "timeoutSec",
        label: "Timeout (seconds)",
        type: "number",
        default: 0,
        hint: "Run timeout in seconds. 0 = no timeout.",
      },
      {
        key: "graceSec",
        label: "Grace Period (seconds)",
        type: "number",
        default: 20,
        hint: "SIGTERM grace period in seconds before SIGKILL.",
      },
    ],
  };
}
