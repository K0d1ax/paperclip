/**
 * Parse a single line of copilot CLI stdout for the UI.
 * Used by the real-time output rendering in the board UI.
 */
export type CopilotStdoutToken =
  | { kind: "text"; text: string }
  | { kind: "tool_call"; name: string; args: string }
  | { kind: "error"; text: string };

export function createCopilotStdoutParser() {
  let buffer = "";

  return {
    /**
     * Feed a line of stdout and return parsed tokens.
     */
    feed(line: string): CopilotStdoutToken[] {
      buffer += line + "\n";
      const tokens: CopilotStdoutToken[] = [];

      // Copilot CLI may emit plain text lines or tool execution markers
      const trimmed = line.trim();
      if (!trimmed) return tokens;

      // Detect tool execution lines (Copilot typically shows "[Tool: ...]" in output)
      const toolMatch = trimmed.match(/^\[Tool:\s*(.+?)\](?:\s*(.*))?$/);
      if (toolMatch) {
        tokens.push({ kind: "tool_call", name: toolMatch[1].trim(), args: (toolMatch[2] ?? "").trim() });
        return tokens;
      }

      // Detect error lines
      if (/^(error|failed|✗|error:)/i.test(trimmed)) {
        tokens.push({ kind: "error", text: trimmed });
        return tokens;
      }

      // Plain text
      tokens.push({ kind: "text", text: trimmed });
      return tokens;
    },

    /**
     * Flush buffered text and return remaining tokens.
     */
    flush(): CopilotStdoutToken[] {
      const remaining = buffer.trim();
      buffer = "";
      if (!remaining) return [];
      return [{ kind: "text", text: remaining }];
    },

    getBuffer(): string {
      return buffer;
    },
  };
}

/** Legacy single-line parser for backwards compatibility. */
export function parseCopilotStdoutLine(line: string): CopilotStdoutToken[] {
  return createCopilotStdoutParser().feed(line);
}
