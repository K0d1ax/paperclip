import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";

/**
 * Minimal session codec for copilot_local.
 * Copilot CLI is one-shot and does not resume sessions, but the codec is
 * still needed for session metadata tracking in the Paperclip runtime.
 */
export const sessionCodec: AdapterSessionCodec = {
  deserialize(_raw: unknown) {
    // copilot_local is one-shot only — no session to resume.
    return null;
  },
  serialize(_params: Record<string, unknown> | null) {
    return null;
  },
  getDisplayId(_params: Record<string, unknown> | null) {
    return null;
  },
};

export { execute } from "./execute.js";
export { testEnvironment } from "./test.js";
export { parseCopilotOutput } from "./parse.js";
export { getConfigSchema } from "./config-schema.js";
