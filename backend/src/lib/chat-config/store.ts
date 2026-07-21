/**
 * Chat-agent configuration — one org-wide config per organisation (tenant).
 *
 * Right now the only setting is a custom system prompt that is appended to the
 * built-in wiki-assistant prompt (see ../../ai/tools/wiki). It lets an
 * organisation steer the assistant's tone, focus and house rules without any
 * code change. The value is stored in the framework's generic
 * `tenant_specific_data` key/value store under a single key, so no dedicated
 * table or migration is needed.
 *
 * Everything is scoped by `tenantId` (the organisation id): a member of one
 * organisation can never read or change another organisation's prompt.
 */
import {
  getOrganisationSpecificData,
  createOrganisationSpecificData,
  updateOrganisationSpecificData,
} from "@framework/lib/specific-data";

/** Key under which the config lives in `tenant_specific_data`. */
export const CHAT_AGENT_CONFIG_KEY = "chat-agent-config";

/** Hard cap on the custom prompt so it can never blow the model context. */
export const MAX_SYSTEM_PROMPT_CHARS = 8_000;

export interface ChatAgentConfig {
  /** Extra instructions appended to the assistant's base system prompt. */
  systemPrompt: string;
}

const EMPTY_CONFIG: ChatAgentConfig = { systemPrompt: "" };

function normalise(data: unknown): ChatAgentConfig {
  const value = data as Partial<ChatAgentConfig> | null | undefined;
  return {
    systemPrompt:
      typeof value?.systemPrompt === "string" ? value.systemPrompt : "",
  };
}

/**
 * Read the organisation's chat-agent config. Returns an empty config (no
 * custom prompt) when nothing has been saved yet — the assistant then runs on
 * its built-in prompt only.
 */
export async function getChatAgentConfig(
  tenantId: string,
): Promise<ChatAgentConfig> {
  try {
    const row = await getOrganisationSpecificData(
      tenantId,
      CHAT_AGENT_CONFIG_KEY,
    );
    return normalise(row?.data);
  } catch {
    // Not found (or first access) → no custom prompt yet.
    return { ...EMPTY_CONFIG };
  }
}

/**
 * Upsert the organisation's chat-agent config. The prompt is trimmed to the
 * hard character cap. Returns the stored value.
 */
export async function setChatAgentConfig(
  tenantId: string,
  config: ChatAgentConfig,
): Promise<ChatAgentConfig> {
  const stored: ChatAgentConfig = {
    systemPrompt: (config.systemPrompt ?? "").slice(0, MAX_SYSTEM_PROMPT_CHARS),
  };

  let exists = true;
  try {
    await getOrganisationSpecificData(tenantId, CHAT_AGENT_CONFIG_KEY);
  } catch {
    exists = false;
  }

  if (exists) {
    await updateOrganisationSpecificData(tenantId, CHAT_AGENT_CONFIG_KEY, {
      data: stored,
    });
  } else {
    await createOrganisationSpecificData({
      tenantId,
      key: CHAT_AGENT_CONFIG_KEY,
      data: stored,
    });
  }

  return stored;
}
