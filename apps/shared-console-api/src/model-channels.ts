import fs from "node:fs/promises";
import path from "node:path";
import type { SharedInstanceRecord } from "./instances.js";

export type SharedConsoleModelChannelModel = {
  id: string;
  name: string;
  api?: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  contextWindow: number;
  maxTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

export type SharedConsoleModelChannel = {
  id: string;
  name: string;
  providerId: string;
  baseUrl: string;
  apiKey?: string;
  auth?: string;
  api?: string;
  headers?: Record<string, string>;
  models: SharedConsoleModelChannelModel[];
  defaultModel: string;
  imageModel?: string;
  imageGenerationModel?: string;
  pdfModel?: string;
};

export type SharedConsoleModelChannelGroup = {
  id: string;
  name: string;
  channelIds: string[];
  strategy: "round-robin";
};

export type SharedConsoleModelChannelCatalogItem = {
  id: string;
  name: string;
  kind: "channel" | "group";
  providerId?: string;
  defaultModel?: string;
  channelCount?: number;
  strategy?: "round-robin";
};

export type SharedConsoleModelChannelSettings = {
  userCanConfigureModels: boolean;
  channels: SharedConsoleModelChannel[];
  channelGroups: SharedConsoleModelChannelGroup[];
};

export type SharedConsoleModelChannelTarget =
  | {
      kind: "channel";
      id: string;
      name: string;
      channel: SharedConsoleModelChannel;
    }
  | {
      kind: "group";
      id: string;
      name: string;
      group: SharedConsoleModelChannelGroup;
      channels: SharedConsoleModelChannel[];
    };

const DEFAULT_ALLOWED_PATH_PREFIXES = ["./", ".\\\\", "tmp/", "tmp\\\\", "./tmp/", ".\\\\tmp\\\\"];
const SAFE_CHANNEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown, label: string, { required = false } = {}): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed && required) {
    throw new Error(`${label} is required.`);
  }
  return trimmed;
}

function normalizeNumber(value: unknown, fallback: number, label: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    if (value == null) {
      return fallback;
    }
    throw new Error(`${label} must be a non-negative number.`);
  }
  return parsed;
}

function normalizePositiveInteger(value: unknown, fallback: number, label: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) {
    if (value == null) {
      return fallback;
    }
    throw new Error(`${label} must be a positive integer.`);
  }
  return Math.trunc(parsed);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  return fallback;
}

function normalizeTextImageInputs(value: unknown): Array<"text" | "image"> {
  if (!Array.isArray(value) || value.length === 0) {
    return ["text"];
  }
  const inputs = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry): entry is "text" | "image" => entry === "text" || entry === "image");
  return inputs.length > 0 ? [...new Set(inputs)] : ["text"];
}

function normalizeHeaders(value: unknown): Record<string, string> | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const entries = Object.entries(value)
    .map(([key, headerValue]) => [key.trim(), typeof headerValue === "string" ? headerValue.trim() : ""] as const)
    .filter(([key, headerValue]) => key && headerValue);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeModelReference(
  value: unknown,
  providerId: string,
  label: string,
  fallbackModelId?: string,
): string | undefined {
  const raw = normalizeString(value, label);
  if (!raw) {
    return fallbackModelId ? `${providerId}/${fallbackModelId}` : undefined;
  }
  if (raw.includes("/")) {
    return raw;
  }
  return `${providerId}/${raw}`;
}

function normalizeChannelModel(
  value: unknown,
  index: number,
): SharedConsoleModelChannelModel {
  if (!isObject(value)) {
    throw new Error(`channels[${index}].models entries must be objects.`);
  }
  const id = normalizeString(value.id, `channels[${index}].models[].id`, { required: true });
  if (!SAFE_CHANNEL_ID.test(id)) {
    throw new Error(`channels[${index}].models[].id is invalid: ${id}`);
  }
  return {
    id,
    name: normalizeString(value.name, `channels[${index}].models[].name`) || id,
    api: normalizeString(value.api, `channels[${index}].models[].api`) || undefined,
    reasoning: normalizeBoolean(value.reasoning, false),
    input: normalizeTextImageInputs(value.input),
    contextWindow: normalizePositiveInteger(
      value.contextWindow,
      128_000,
      `channels[${index}].models[].contextWindow`,
    ),
    maxTokens: normalizePositiveInteger(value.maxTokens, 16_384, `channels[${index}].models[].maxTokens`),
    cost: {
      input: normalizeNumber(
        isObject(value.cost) ? value.cost.input : undefined,
        0,
        `channels[${index}].models[].cost.input`,
      ),
      output: normalizeNumber(
        isObject(value.cost) ? value.cost.output : undefined,
        0,
        `channels[${index}].models[].cost.output`,
      ),
      cacheRead: normalizeNumber(
        isObject(value.cost) ? value.cost.cacheRead : undefined,
        0,
        `channels[${index}].models[].cost.cacheRead`,
      ),
      cacheWrite: normalizeNumber(
        isObject(value.cost) ? value.cost.cacheWrite : undefined,
        0,
        `channels[${index}].models[].cost.cacheWrite`,
      ),
    },
  };
}

function normalizeChannel(value: unknown, index: number): SharedConsoleModelChannel {
  if (!isObject(value)) {
    throw new Error(`channels[${index}] must be an object.`);
  }
  const id = normalizeString(value.id, `channels[${index}].id`, { required: true });
  if (!SAFE_CHANNEL_ID.test(id)) {
    throw new Error(`channels[${index}].id is invalid: ${id}`);
  }
  const providerId =
    normalizeString(value.providerId, `channels[${index}].providerId`, { required: true }) || id;
  if (!SAFE_CHANNEL_ID.test(providerId)) {
    throw new Error(`channels[${index}].providerId is invalid: ${providerId}`);
  }
  const models = Array.isArray(value.models)
    ? value.models.map((entry, modelIndex) => normalizeChannelModel(entry, index))
    : [];
  if (models.length === 0) {
    throw new Error(`channels[${index}].models must contain at least one model.`);
  }
  const fallbackModelId = models[0]?.id;
  const defaultModel = normalizeModelReference(
    value.defaultModel,
    providerId,
    `channels[${index}].defaultModel`,
    fallbackModelId,
  );
  if (!defaultModel) {
    throw new Error(`channels[${index}].defaultModel is required.`);
  }
  return {
    id,
    name: normalizeString(value.name, `channels[${index}].name`) || id,
    providerId,
    baseUrl: normalizeString(value.baseUrl, `channels[${index}].baseUrl`, { required: true }),
    apiKey: normalizeString(value.apiKey, `channels[${index}].apiKey`) || undefined,
    auth: normalizeString(value.auth, `channels[${index}].auth`) || undefined,
    api: normalizeString(value.api, `channels[${index}].api`) || undefined,
    headers: normalizeHeaders(value.headers),
    models,
    defaultModel,
    imageModel: normalizeModelReference(
      value.imageModel,
      providerId,
      `channels[${index}].imageModel`,
    ),
    imageGenerationModel: normalizeModelReference(
      value.imageGenerationModel,
      providerId,
      `channels[${index}].imageGenerationModel`,
    ),
    pdfModel: normalizeModelReference(value.pdfModel, providerId, `channels[${index}].pdfModel`),
  };
}

function normalizeChannelGroup(
  value: unknown,
  index: number,
): SharedConsoleModelChannelGroup {
  if (!isObject(value)) {
    throw new Error(`channelGroups[${index}] must be an object.`);
  }
  const id = normalizeString(value.id, `channelGroups[${index}].id`, { required: true });
  if (!SAFE_CHANNEL_ID.test(id)) {
    throw new Error(`channelGroups[${index}].id is invalid: ${id}`);
  }
  const rawChannelIds = Array.isArray(value.channelIds)
    ? value.channelIds.map((entry) => normalizeString(entry, `channelGroups[${index}].channelIds[]`))
    : [];
  const channelIds = [...new Set(rawChannelIds.filter(Boolean))];
  if (channelIds.length === 0) {
    throw new Error(`channelGroups[${index}].channelIds must contain at least one channel id.`);
  }
  for (const channelId of channelIds) {
    if (!SAFE_CHANNEL_ID.test(channelId)) {
      throw new Error(`channelGroups[${index}].channelIds contains invalid id: ${channelId}`);
    }
  }
  const strategyRaw = normalizeString(value.strategy, `channelGroups[${index}].strategy`);
  if (strategyRaw && strategyRaw !== "round-robin") {
    throw new Error(`channelGroups[${index}].strategy must be "round-robin".`);
  }
  return {
    id,
    name: normalizeString(value.name, `channelGroups[${index}].name`) || id,
    channelIds,
    strategy: "round-robin",
  };
}

export function getDefaultSharedConsoleModelChannelSettings(): SharedConsoleModelChannelSettings {
  return {
    userCanConfigureModels: false,
    channels: [],
    channelGroups: [],
  };
}

export function normalizeSharedConsoleModelChannelSettings(
  value: unknown,
): SharedConsoleModelChannelSettings {
  if (!isObject(value)) {
    return getDefaultSharedConsoleModelChannelSettings();
  }
  const channels = Array.isArray(value.channels)
    ? value.channels.map((entry, index) => normalizeChannel(entry, index))
    : [];
  const uniqueIds = new Set<string>();
  const providerIds = new Set<string>();
  for (const channel of channels) {
    if (uniqueIds.has(channel.id)) {
      throw new Error(`Duplicate channel id: ${channel.id}`);
    }
    uniqueIds.add(channel.id);
    if (providerIds.has(channel.providerId)) {
      throw new Error(`Duplicate channel providerId: ${channel.providerId}`);
    }
    providerIds.add(channel.providerId);
  }
  const channelGroups = Array.isArray(value.channelGroups)
    ? value.channelGroups.map((entry, index) => normalizeChannelGroup(entry, index))
    : [];
  for (const group of channelGroups) {
    if (uniqueIds.has(group.id)) {
      throw new Error(`Duplicate channel or group id: ${group.id}`);
    }
    uniqueIds.add(group.id);
    const missingChannelIds = group.channelIds.filter(
      (channelId) => !channels.some((channel) => channel.id === channelId),
    );
    if (missingChannelIds.length > 0) {
      throw new Error(
        `channelGroups[${group.id}].channelIds references unknown channels: ${missingChannelIds.join(", ")}`,
      );
    }
  }
  return {
    userCanConfigureModels: normalizeBoolean(value.userCanConfigureModels, false),
    channels,
    channelGroups,
  };
}

export function resolveSharedConsoleModelChannelsPath(
  env: NodeJS.ProcessEnv,
  sharedInstancesRoot: string,
): string {
  const configured = env.SHARED_CONSOLE_MODEL_CHANNELS_PATH?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(path.dirname(sharedInstancesRoot), ".shared-console-model-channels.json");
}

export async function readSharedConsoleModelChannelSettings(
  settingsPath: string,
): Promise<SharedConsoleModelChannelSettings> {
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    return normalizeSharedConsoleModelChannelSettings(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return getDefaultSharedConsoleModelChannelSettings();
    }
    throw error;
  }
}

export async function writeSharedConsoleModelChannelSettings(
  settingsPath: string,
  settings: SharedConsoleModelChannelSettings,
): Promise<void> {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export function resolveSharedConsoleModelChannelTarget(
  settings: SharedConsoleModelChannelSettings,
  channelId: string | null | undefined,
): SharedConsoleModelChannelTarget | null {
  const normalizedId = typeof channelId === "string" ? channelId.trim() : "";
  if (!normalizedId) {
    return null;
  }
  const channel = settings.channels.find((item) => item.id === normalizedId) ?? null;
  if (channel) {
    return {
      kind: "channel",
      id: channel.id,
      name: channel.name,
      channel,
    };
  }
  const group = settings.channelGroups.find((item) => item.id === normalizedId) ?? null;
  if (!group) {
    return null;
  }
  const channels = group.channelIds
    .map((channelRef) => settings.channels.find((item) => item.id === channelRef) ?? null)
    .filter((item): item is SharedConsoleModelChannel => Boolean(item));
  if (channels.length === 0) {
    return null;
  }
  return {
    kind: "group",
    id: group.id,
    name: group.name,
    group,
    channels,
  };
}

export function buildSharedConsoleModelChannelCatalog(
  settings: SharedConsoleModelChannelSettings,
): { userCanConfigureModels: boolean; channels: SharedConsoleModelChannelCatalogItem[] } {
  return {
    userCanConfigureModels: settings.userCanConfigureModels,
    channels: [
      ...settings.channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        kind: "channel" as const,
        providerId: channel.providerId,
        defaultModel: channel.defaultModel,
      })),
      ...settings.channelGroups.map((group) => {
        const firstChannel = settings.channels.find((channel) => channel.id === group.channelIds[0]);
        return {
          id: group.id,
          name: group.name,
          kind: "group" as const,
          defaultModel: firstChannel?.defaultModel,
          channelCount: group.channelIds.length,
          strategy: group.strategy,
        };
      }),
    ],
  };
}

function buildBaseInstanceConfig(instance: SharedInstanceRecord): Record<string, unknown> {
  return {
    gateway: {
      mode: "local",
      port: instance.port ?? 0,
      auth: {
        mode: "none",
      },
      controlUi: {
        enabled: true,
        ...(instance.runtime.location === "container"
          ? { dangerouslyAllowHostHeaderOriginFallback: true }
          : {}),
      },
    },
    browser: {
      sharedRoutedExecutionEnabled: true,
    },
    tools: {
      shared: {
        localSourceValidation: {
          allowedPathPrefixes: DEFAULT_ALLOWED_PATH_PREFIXES,
        },
      },
    },
  };
}

function buildSingleChannelInstanceConfig(
  instance: SharedInstanceRecord,
  channel: SharedConsoleModelChannel | null,
): Record<string, unknown> {
  const base = buildBaseInstanceConfig(instance);
  if (!channel) {
    return base;
  }
  return {
    ...base,
    models: {
      providers: {
        [channel.providerId]: {
          baseUrl: channel.baseUrl,
          ...(channel.apiKey ? { apiKey: channel.apiKey } : {}),
          ...(channel.auth ? { auth: channel.auth } : {}),
          ...(channel.api ? { api: channel.api } : {}),
          ...(channel.headers ? { headers: channel.headers } : {}),
          models: channel.models,
        },
      },
    },
    agents: {
      defaults: {
        model: channel.defaultModel,
        ...(channel.imageModel ? { imageModel: channel.imageModel } : {}),
        ...(channel.imageGenerationModel ? { imageGenerationModel: channel.imageGenerationModel } : {}),
        ...(channel.pdfModel ? { pdfModel: channel.pdfModel } : {}),
      },
    },
  };
}

function buildGroupInstanceConfig(
  instance: SharedInstanceRecord,
  target: Extract<SharedConsoleModelChannelTarget, { kind: "group" }>,
): Record<string, unknown> {
  const base = buildBaseInstanceConfig(instance);
  const providers = Object.fromEntries(
    target.channels.map((channel) => [
      channel.providerId,
      {
        baseUrl: channel.baseUrl,
        ...(channel.apiKey ? { apiKey: channel.apiKey } : {}),
        ...(channel.auth ? { auth: channel.auth } : {}),
        ...(channel.api ? { api: channel.api } : {}),
        ...(channel.headers ? { headers: channel.headers } : {}),
        models: channel.models,
      },
    ]),
  );
  const defaultModels = target.channels.map((channel) => channel.defaultModel);
  const imageModels = target.channels
    .map((channel) => channel.imageModel)
    .filter((value): value is string => Boolean(value));
  const imageGenerationModels = target.channels
    .map((channel) => channel.imageGenerationModel)
    .filter((value): value is string => Boolean(value));
  const pdfModels = target.channels
    .map((channel) => channel.pdfModel)
    .filter((value): value is string => Boolean(value));
  const [primaryModel, ...fallbackModels] = defaultModels;
  const modelConfig: Record<string, unknown> = {
    primary: primaryModel,
    ...(fallbackModels.length > 0 ? { fallbacks: fallbackModels } : {}),
    rotation: {
      strategy: target.group.strategy,
      stateFile: "shared-console-model-rotation.json",
    },
  };

  return {
    ...base,
    models: {
      providers,
    },
    agents: {
      defaults: {
        model: modelConfig,
        ...(imageModels.length > 0
          ? {
              imageModel: {
                primary: imageModels[0],
                ...(imageModels.length > 1 ? { fallbacks: imageModels.slice(1) } : {}),
              },
            }
          : {}),
        ...(imageGenerationModels.length > 0
          ? {
              imageGenerationModel: {
                primary: imageGenerationModels[0],
                ...(imageGenerationModels.length > 1
                  ? { fallbacks: imageGenerationModels.slice(1) }
                  : {}),
              },
            }
          : {}),
        ...(pdfModels.length > 0
          ? {
              pdfModel: {
                primary: pdfModels[0],
                ...(pdfModels.length > 1 ? { fallbacks: pdfModels.slice(1) } : {}),
              },
            }
          : {}),
      },
    },
  };
}

export async function writeSharedConsoleInstanceModelConfig(
  instance: SharedInstanceRecord,
  target: SharedConsoleModelChannelTarget | null,
): Promise<void> {
  const configPath =
    instance.paths.configPath || path.join(instance.paths.dir, "config", "openclaw.instance.json5");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const config =
    !target || target.kind === "channel"
      ? buildSingleChannelInstanceConfig(instance, target?.channel ?? null)
      : buildGroupInstanceConfig(instance, target);
  await fs.writeFile(
    configPath,
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
}
