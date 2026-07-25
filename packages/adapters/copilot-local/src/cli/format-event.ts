import picocolors from "picocolors";

/**
 * Format a copilot CLI stream event for CLI display.
 * Used by the paperclipai CLI's run output.
 */
export function printCopilotStreamEvent(
  line: string,
  write: (text: string) => void,
): void {
  const trimmed = line.trim();
  if (!trimmed) return;

  // Tool execution events
  const toolMatch = trimmed.match(/^\[Tool:\s*(.+?)\](?:\s*(.*))?$/);
  if (toolMatch) {
    const name = toolMatch[1].trim();
    const args = (toolMatch[2] ?? "").trim();
    write(picocolors.cyan(`  ⚡ ${name}`));
    if (args) write(picocolors.dim(` ${args}`));
    write("\n");
    return;
  }

  // Error lines
  if (/^(error|failed|✗|error:)/i.test(trimmed)) {
    write(picocolors.red(`  ✗ ${trimmed}\n`));
    return;
  }

  // Success/completion markers
  if (/^(ok|done|✓|completed)/i.test(trimmed)) {
    write(picocolors.green(`  ✓ ${trimmed}\n`));
    return;
  }

  // Regular text output
  write(picocolors.white(`  ${trimmed}\n`));
}
