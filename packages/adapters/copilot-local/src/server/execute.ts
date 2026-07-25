import fs from "node:fs/promises";
import path from "node:path";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  adapterExecutionTargetIsRemote,
  adapterExecutionTargetRemoteCwd,
  adapterExecutionTargetSessionMatches,
  describeAdapterExecutionTarget,
  ensureAdapterExecutionTargetCommandResolvable,
  ensureAdapterExecutionTargetRuntimeCommandInstalled,
  overrideAdapterExecutionTargetRemoteCwd,
  prepareAdapterExecutionTargetRuntime,
  readAdapterExecutionTarget,
  resolveAdapterExecutionTargetCommandForLogs,
  resolveAdapterExecutionTargetTimeoutSec,
  runAdapterExecutionTargetProcess,
} from "@paperclipai/adapter-utils/execution-target";
import {
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  buildInvocationEnvForLogs,
  buildPaperclipEnv,
  ensureAbsoluteDirectory,
  ensurePathInEnv,
  joinPromptSections,
  parseObject,
  readPaperclipIssueWorkModeFromContext,
  renderTemplate,
  renderPaperclipWakePrompt,
  isPaperclipRecoveryWakePayload,
  resolvePaperclipDesiredSkillNames,
  stringifyPaperclipWakePayload,
  refreshPaperclipWorkspaceEnvForExecution,
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
} from "@paperclipai/adapter-utils/server-utils";
import { parseCopilotOutput } from "./parse.js";

function renderPaperclipEnvNote(env: Record<string, string>): string {
  const paperclipKeys = Object.keys(env)
    .filter((key) => key.startsWith("PAPERCLIP_"))
    .sort();
  if (paperclipKeys.length === 0) return "";
  return [
    "Paperclip runtime note:",
    `The following PAPERCLIP_* environment variables are available in this run: ${paperclipKeys.join(", ")}`,
    "Do not assume these variables are missing without checking your shell environment.",
    "",
    "",
  ].join("\n");
}

function renderApiAccessNote(env: Record<string, string>): string {
  if (!env.PAPERCLIP_API_URL || !env.PAPERCLIP_API_KEY) return "";
  return [
    "Paperclip API access note:",
    "Use shell commands with curl to make Paperclip API requests when needed.",
    "Include X-Paperclip-Run-Id on mutating requests.",
    "",
    "",
  ].join("\n");
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta, onSpawn, authToken } = ctx;
  const executionTarget = readAdapterExecutionTarget({
    executionTarget: ctx.executionTarget,
    legacyRemoteExecution: ctx.executionTransport?.remoteExecution,
  });
  const executionTargetIsRemote = adapterExecutionTargetIsRemote(executionTarget);

  const promptTemplate = asString(config.promptTemplate, DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE);
  const command = asString(config.command, "copilot");
  const model = asString(config.model, "").trim();
  const allowAllTools = asBoolean(config.allowAllTools, true);
  const allowedTools = asStringArray(config.allowedTools);
  const denyTools = asStringArray(config.denyTools);

  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceId = asString(workspaceContext.workspaceId, "");
  const workspaceRepoUrl = asString(workspaceContext.repoUrl, "");
  const workspaceRepoRef = asString(workspaceContext.repoRef, "");
  const agentHome = asString(workspaceContext.agentHome, "");
  const workspaceHints = Array.isArray(context.paperclipWorkspaces)
    ? context.paperclipWorkspaces.filter(
        (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const configuredCwd = asString(config.cwd, "");
  const useConfiguredInsteadOfAgentHome = workspaceSource === "agent_home" && configuredCwd.length > 0;
  const effectiveWorkspaceCwd = useConfiguredInsteadOfAgentHome ? "" : workspaceCwd;
  const cwd = effectiveWorkspaceCwd || configuredCwd || process.cwd();
  let effectiveExecutionCwd = adapterExecutionTargetRemoteCwd(executionTarget, cwd);
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  let restoreRemoteWorkspace: (() => Promise<void>) | null = null;

  try {
    const envConfig = parseObject(config.env);
    const env: Record<string, string> = { ...buildPaperclipEnv(agent) };
    env.PAPERCLIP_RUN_ID = runId;
    const wakeTaskId =
      (typeof context.taskId === "string" && context.taskId.trim().length > 0 && context.taskId.trim()) ||
      (typeof context.issueId === "string" && context.issueId.trim().length > 0 && context.issueId.trim()) ||
      null;
    const wakeReason =
      typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0
        ? context.wakeReason.trim()
        : null;
    const wakeCommentId =
      (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim().length > 0 && context.wakeCommentId.trim()) ||
      (typeof context.commentId === "string" && context.commentId.trim().length > 0 && context.commentId.trim()) ||
      null;
    const approvalId =
      typeof context.approvalId === "string" && context.approvalId.trim().length > 0
        ? context.approvalId.trim()
        : null;
    const approvalStatus =
      typeof context.approvalStatus === "string" && context.approvalStatus.trim().length > 0
        ? context.approvalStatus.trim()
        : null;
    const linkedIssueIds = Array.isArray(context.issueIds)
      ? context.issueIds.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const wakePayloadJson = stringifyPaperclipWakePayload(context.paperclipWake);
    const issueWorkMode = readPaperclipIssueWorkModeFromContext(context);
    if (wakeTaskId) env.PAPERCLIP_TASK_ID = wakeTaskId;
    if (issueWorkMode) env.PAPERCLIP_ISSUE_WORK_MODE = issueWorkMode;
    if (wakeReason) env.PAPERCLIP_WAKE_REASON = wakeReason;
    if (wakeCommentId) env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
    if (approvalId) env.PAPERCLIP_APPROVAL_ID = approvalId;
    if (approvalStatus) env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
    if (linkedIssueIds.length > 0) env.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");
    if (wakePayloadJson) env.PAPERCLIP_WAKE_PAYLOAD_JSON = wakePayloadJson;
    refreshPaperclipWorkspaceEnvForExecution({
      env,
      envConfig,
      workspaceCwd: effectiveWorkspaceCwd,
      workspaceSource,
      workspaceId,
      workspaceRepoUrl,
      workspaceRepoRef,
      workspaceHints,
      agentHome,
      executionTargetIsRemote,
      executionCwd: effectiveExecutionCwd,
    });
    if (authToken) {
      env.PAPERCLIP_API_KEY = authToken;
    }

    const timeoutSec = resolveAdapterExecutionTargetTimeoutSec(
      executionTarget,
      asNumber(config.timeoutSec, 0),
    );
    const graceSec = asNumber(config.graceSec, 20);
    await ensureAdapterExecutionTargetRuntimeCommandInstalled({
      runId,
      target: executionTarget,
      installCommand: ctx.runtimeCommandSpec?.installCommand,
      detectCommand: ctx.runtimeCommandSpec?.detectCommand,
      cwd,
      env,
      timeoutSec,
      graceSec,
      onLog,
    });

    if (executionTargetIsRemote) {
      await onLog(
        "stdout",
        `[paperclip] Syncing workspace to ${describeAdapterExecutionTarget(executionTarget)}.\n`,
      );
      const preparedExecutionTargetRuntime = await prepareAdapterExecutionTargetRuntime({
        runId,
        target: executionTarget,
        adapterKey: "copilot",
        workspaceLocalDir: cwd,
        timeoutSec,
        installCommand: ctx.runtimeCommandSpec?.installCommand ?? null,
        detectCommand: ctx.runtimeCommandSpec?.detectCommand ?? command,
        onProgress: (line) => onLog("stdout", line),
        onRuntimeProgress: ctx.onRuntimeProgress,
      });
      restoreRemoteWorkspace = () =>
        preparedExecutionTargetRuntime.restoreWorkspace((line) => onLog("stdout", line));
      effectiveExecutionCwd = preparedExecutionTargetRuntime.workspaceRemoteDir ?? effectiveExecutionCwd;
      refreshPaperclipWorkspaceEnvForExecution({
        env,
        envConfig,
        workspaceCwd: effectiveWorkspaceCwd,
        workspaceSource,
        workspaceId,
        workspaceRepoUrl,
        workspaceRepoRef,
        workspaceHints,
        agentHome,
        executionTargetIsRemote,
        executionCwd: effectiveExecutionCwd,
      });
    }

    const runtimeExecutionTarget = overrideAdapterExecutionTargetRemoteCwd(executionTarget, effectiveExecutionCwd);
    const effectiveEnv = Object.fromEntries(
      Object.entries({ ...process.env, ...env }).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    const runtimeEnv = ensurePathInEnv(effectiveEnv);
    await ensureAdapterExecutionTargetCommandResolvable(command, executionTarget, cwd, runtimeEnv, {
      installCommand: ctx.runtimeCommandSpec?.installCommand ?? null,
      timeoutSec,
    });
    const resolvedCommand = await resolveAdapterExecutionTargetCommandForLogs(command, executionTarget, cwd, runtimeEnv);
    const loggedEnv = buildInvocationEnvForLogs(env, {
      runtimeEnv,
      includeRuntimeKeys: ["HOME"],
      resolvedCommand,
    });

    const runtimeSessionParams = parseObject(runtime.sessionParams);
    const runtimeSessionId = asString(runtimeSessionParams.sessionId, runtime.sessionId ?? "");
    const runtimeSessionCwd = asString(runtimeSessionParams.cwd, "");
    const runtimeRemoteExecution = parseObject(runtimeSessionParams.remoteExecution);
    const canResumeSession =
      runtimeSessionId.length > 0 &&
      (runtimeSessionCwd.length === 0 || path.resolve(runtimeSessionCwd) === path.resolve(effectiveExecutionCwd)) &&
      adapterExecutionTargetSessionMatches(runtimeRemoteExecution, runtimeExecutionTarget);

    // copilot_local is one-shot — only resume if we have a session from a previous run
    // that matches the current execution target. In practice, Copilot CLI doesn't
    // support session resume, so this will typically be null.
    const sessionId = canResumeSession ? runtimeSessionId : null;
    if (runtimeSessionId && !canResumeSession) {
      await onLog(
        "stdout",
        `[paperclip] Copilot does not support session resume; starting fresh.\n`,
      );
    }

    const templateData = {
      agentId: agent.id,
      companyId: agent.companyId,
      runId,
      company: { id: agent.companyId },
      agent,
      run: { id: runId, source: "on_demand" },
      context,
    };
    const wakePrompt = renderPaperclipWakePrompt(context.paperclipWake, { resumedSession: false });
    const shouldUseResumeDeltaPrompt = false; // copilot is always one-shot
    const renderedPrompt = shouldUseResumeDeltaPrompt || isPaperclipRecoveryWakePayload(context.paperclipWake)
      ? ""
      : renderTemplate(promptTemplate, templateData);
    const sessionHandoffNote = asString(context.paperclipSessionHandoffMarkdown, "").trim();
    const paperclipEnvNote = renderPaperclipEnvNote(env);
    const apiAccessNote = renderApiAccessNote(env);
    const prompt = joinPromptSections([
      wakePrompt,
      sessionHandoffNote,
      paperclipEnvNote,
      apiAccessNote,
      renderedPrompt,
    ]);

    const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
    const fullPrompt = instructionsFilePath
      ? (await fs.readFile(instructionsFilePath, "utf-8")) + "\n\n" + prompt
      : prompt;

    const promptMetrics = {
      promptChars: fullPrompt.length,
      wakePromptChars: wakePrompt.length,
      sessionHandoffChars: sessionHandoffNote.length,
      runtimeNoteChars: paperclipEnvNote.length + apiAccessNote.length,
      heartbeatPromptChars: renderedPrompt.length,
    };

    const args: string[] = ["-p", fullPrompt];

    // Tool authorization flags
    if (allowedTools.length > 0) {
      for (const tool of allowedTools) {
        args.push("--allow-tool", tool);
      }
    } else if (allowAllTools) {
      args.push("--allow-all-tools");
    }
    for (const tool of denyTools) {
      args.push("--deny-tool", tool);
    }

    // Optional model hint
    if (model) {
      args.push("--model", model);
    }

    const extraArgs = asStringArray(config.extraArgs);
    if (extraArgs.length > 0) args.push(...extraArgs);

    const commandNotes = (() => {
      const notes: string[] = ["Prompt passed to Copilot via -p in one-shot mode."];
      if (allowAllTools) notes.push("Added --allow-all-tools for unattended execution.");
      if (allowedTools.length > 0) notes.push(`Allowed specific tools: ${allowedTools.join(", ")}`);
      if (denyTools.length > 0) notes.push(`Denied specific tools: ${denyTools.join(", ")}`);
      return notes;
    })();

    if (onMeta) {
      await onMeta({
        adapterType: "copilot_local",
        command: resolvedCommand,
        cwd: effectiveExecutionCwd,
        commandNotes,
        commandArgs: args.map((value, index) => (
          index === 1 ? `<prompt ${fullPrompt.length} chars>` : value
        )),
        env: loggedEnv,
        prompt: fullPrompt,
        promptMetrics,
        context,
      });
    }

    const proc = await runAdapterExecutionTargetProcess(runId, runtimeExecutionTarget, command, args, {
      cwd,
      env,
      timeoutSec,
      graceSec,
      onSpawn,
      onRuntimeProgress: ctx.onRuntimeProgress,
      onLog,
    });

    const parsed = parseCopilotOutput(proc.stdout);

    if (proc.timedOut) {
      return {
        exitCode: proc.exitCode,
        signal: proc.signal,
        timedOut: true,
        errorMessage: `Timed out after ${timeoutSec}s`,
      };
    }

    const failed = (proc.exitCode ?? 0) !== 0;

    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: false,
      errorMessage: failed ? (parsed.errorMessage || `copilot exited with code ${proc.exitCode ?? -1}`) : null,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
      },
      // copilot_local is one-shot — no session to persist
      sessionId: null,
      sessionParams: null,
      sessionDisplayId: null,
      provider: "github",
      biller: "github",
      model: model || "copilot-default",
      billingType: "subscription",
      costUsd: null,
      resultJson: {
        summary: parsed.summary,
        ...(failed ? { stderr: proc.stderr } : {}),
      },
      summary: parsed.summary,
    };
  } finally {
    await restoreRemoteWorkspace?.();
  }
}
