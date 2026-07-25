/**
 * Parse copilot CLI stdout into a structured result.
 *
 * GitHub Copilot CLI in one-shot mode (-p) outputs:
 * - Tool call/progress lines (stderr typically)
 * - Final output text (stdout typically)
 * - Errors may appear in either stream
 */
export interface ParsedCopilotOutput {
  summary: string;
  errorMessage: string | null;
}

export function parseCopilotOutput(stdout: string): ParsedCopilotOutput {
  const lines = stdout.split(/\r?\n/);
  const textParts: string[] = [];
  let errorMessage: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // Skip empty lines
    if (!line) continue;

    // Collect text output
    textParts.push(line);
  }

  // The summary is the entire output text, trimmed
  const summary = textParts.join("\n").trim();

  return {
    summary,
    errorMessage,
  };
}

/**
 * Check if the copilot output indicates an auth error or similar
 * transient failure that could be resolved by re-authenticating.
 */
export function isCopilotAuthError(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`;
  return /(?:not\s+logged\s+in|login\s+required|authentication\s+required|unauthorized)/i.test(haystack);
}
