import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import {
  asNumber,
  asString,
  asStringArray,
  ensurePathInEnv,
  parseObject,
} from "@paperclipai/adapter-utils/server-utils";
import {
  describeAdapterExecutionTarget,
  ensureAdapterExecutionTargetCommandResolvable,
  ensureAdapterExecutionTargetDirectory,
  resolveAdapterExecutionTargetCwd,
  runAdapterExecutionTargetProcess,
} from "@paperclipai/adapter-utils/execution-target";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function summarizeProbeDetail(stdout: string, stderr: string): string | null {
  const raw = firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout);
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  const max = 240;
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

function normalizeEnv(input: unknown): Record<string, string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

const COPILOT_AUTH_REQUIRED_RE =
  /(?:not\s+logged\s+in|login\s+required|authentication\s+required|unauthorized|auth.*fail|not\s+authenticated)/i;

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, "copilot");
  const target = ctx.executionTarget ?? null;
  const targetIsRemote = target?.kind === "remote";
  const cwd = resolveAdapterExecutionTargetCwd(target, asString(config.cwd, ""), process.cwd());
  const targetLabel = targetIsRemote
    ? ctx.environmentName ?? describeAdapterExecutionTarget(target)
    : null;
  const runId = `copilot-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (targetLabel) {
    checks.push({
      code: "copilot_environment_target",
      level: "info",
      message: `Probing inside environment: ${targetLabel}`,
    });
  }

  // Check working directory
  try {
    await ensureAdapterExecutionTargetDirectory(runId, target, cwd, {
      cwd,
      env: {},
      createIfMissing: true,
    });
    checks.push({
      code: "copilot_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "copilot_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  const env = normalizeEnv(config.env);
  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });

  // Check command resolvable
  try {
    await ensureAdapterExecutionTargetCommandResolvable(command, target, cwd, runtimeEnv);
    checks.push({
      code: "copilot_command_resolvable",
      level: "info",
      message: `Command is executable: ${command}`,
    });
  } catch (err) {
    checks.push({
      code: "copilot_command_unresolvable",
      level: "error",
      message: err instanceof Error ? err.message : "Command is not executable",
      detail: command,
    });
  }

  const canRunProbe =
    checks.every((check) => check.code !== "copilot_cwd_invalid" && check.code !== "copilot_command_unresolvable");

  if (canRunProbe) {
    // Run a --version probe to check the CLI is installed and working
    const versionProbe = await runAdapterExecutionTargetProcess(
      runId,
      target,
      command,
      ["--version"],
      {
        cwd,
        env,
        timeoutSec: Math.max(1, asNumber(config.helloProbeTimeoutSec, 30)),
        graceSec: 5,
        onLog: async () => {},
      },
    );

    const probeOutput = `${versionProbe.stdout}\n${versionProbe.stderr}`;
    const authRequired = COPILOT_AUTH_REQUIRED_RE.test(probeOutput);

    if (versionProbe.timedOut) {
      checks.push({
        code: "copilot_version_probe_timed_out",
        level: "warn",
        message: "`copilot --version` timed out.",
        hint: "Verify the Copilot CLI is responsive on the target host.",
      });
    } else if ((versionProbe.exitCode ?? 1) !== 0) {
      checks.push({
        code: authRequired ? "copilot_auth_required" : "copilot_version_probe_failed",
        level: authRequired ? "warn" : "error",
        message: authRequired
          ? "GitHub Copilot CLI is not authenticated."
          : "`copilot --version` failed.",
        detail: summarizeProbeDetail(versionProbe.stdout, versionProbe.stderr),
        hint: authRequired
          ? "Run `github-copilot-cli auth` or `gh auth login` on the target host, then retry."
          : undefined,
      });
    } else {
      checks.push({
        code: "copilot_version_probe_passed",
        level: "info",
        message: `GitHub Copilot CLI is installed: ${versionProbe.stdout.trim() || command}`,
      });
    }
  }

  if (canRunProbe) {
    // Run a simple hello probe to verify the CLI can execute prompts
    const probeArgs = ["-p", "Respond with exactly one word: hello"];
    const allowAllTools = config.allowAllTools !== false;
    if (allowAllTools) {
      probeArgs.push("--allow-all-tools");
    }

    const helloProbe = await runAdapterExecutionTargetProcess(
      runId,
      target,
      command,
      probeArgs,
      {
        cwd,
        env,
        timeoutSec: Math.max(1, asNumber(config.helloProbeTimeoutSec, 60)),
        graceSec: 5,
        onLog: async () => {},
      },
    );

    const probeOutput = `${helloProbe.stdout}\n${helloProbe.stderr}`;
    const authRequired = COPILOT_AUTH_REQUIRED_RE.test(probeOutput);
    const detail = summarizeProbeDetail(helloProbe.stdout, helloProbe.stderr);

    if (helloProbe.timedOut) {
      checks.push({
        code: "copilot_hello_probe_timed_out",
        level: "warn",
        message: "Copilot hello probe timed out.",
        hint: "Retry the probe. If this persists, verify Copilot can run a simple `-p` prompt manually.",
      });
    } else if ((helloProbe.exitCode ?? 1) !== 0) {
      checks.push({
        code: authRequired ? "copilot_hello_probe_auth_required" : "copilot_hello_probe_failed",
        level: authRequired ? "warn" : "error",
        message: authRequired
          ? "GitHub Copilot CLI could not answer the hello probe because authentication is missing."
          : "Copilot hello probe failed.",
        ...(detail ? { detail } : {}),
        hint: authRequired ? "Run `github-copilot-cli auth` or `gh auth login` then retry." : undefined,
      });
    } else {
      checks.push({
        code: "copilot_hello_probe_passed",
        level: "info",
        message: "Copilot hello probe succeeded.",
      });
    }
  }

  return {
    adapterType: "copilot_local",
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
