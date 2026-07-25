import type {
  AdapterSkillContext,
  AdapterSkillSnapshot,
  AdapterSkillSyncMode,
} from "@paperclipai/adapter-utils";

const snap: AdapterSkillSnapshot = {
  adapterType: "copilot_local",
  supported: false,
  mode: "none" as AdapterSkillSyncMode,
  desiredSkills: [],
  entries: [],
  warnings: [],
};

export async function listCopilotSkills(_ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot> {
  return snap;
}

export async function syncCopilotSkills(
  _ctx: AdapterSkillContext,
  _desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  return snap;
}
