const MODEL_CHANNEL_GENERATOR_API_OPTIONS = [
  { value: "openai-responses", label: "openai-responses" },
  { value: "openai-completions", label: "/v1/chat/completions" },
  { value: "anthropic-messages", label: "Anthropic" },
];

const MODEL_CHANNEL_GENERATOR_API_ALIASES = new Map([
  ["openai-responses", "openai-responses"],
  ["openai-completions", "openai-completions"],
  ["openai-chat-completions", "openai-completions"],
  ["/v1/chat/completions", "openai-completions"],
  ["anthropic", "anthropic-messages"],
  ["anthropic-messages", "anthropic-messages"],
]);

function buildModelChannelGeneratorApiOptionsHtmlSection(escapeHtml, { selectedValue = "", allowBlank = false } = {}) {
  const normalizedSelected = normalizeModelChannelGeneratorApiValueSection(selectedValue, { allowBlank });
  const options = [
    ...(allowBlank ? [{ value: "", label: "沿用默认 API 类型" }] : []),
    ...MODEL_CHANNEL_GENERATOR_API_OPTIONS,
  ];
  if (normalizedSelected && !options.some((option) => option.value === normalizedSelected)) {
    options.push({ value: normalizedSelected, label: normalizedSelected });
  }
  return options
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}"${option.value === normalizedSelected ? " selected" : ""}>${escapeHtml(option.label)}</option>`,
    )
    .join("");
}

function sanitizeModelChannelSafeId(value, fallback = "channel") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-{2,}/g, "-")
    .replace(/[._-]+$/g, "");
  return normalized || fallback;
}

function reserveUniqueModelChannelSafeId(baseValue, takenIds) {
  const base = sanitizeModelChannelSafeId(baseValue, "channel");
  let candidate = base;
  let suffix = 2;
  while (takenIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  takenIds.add(candidate);
  return candidate;
}

function stripTrailingOrdinal(value) {
  return String(value || "")
    .trim()
    .replace(/(?:[\s._-]+)?\d+$/g, "")
    .replace(/[\s._-]+$/g, "")
    .trim();
}

function stripTrailingRoundRobinSuffix(value) {
  return String(value || "")
    .trim()
    .replace(/[\s._-]*rr$/i, "")
    .replace(/[\s._-]+$/g, "")
    .trim();
}

function deriveCommonStem(values, fallback = "") {
  const stems = values.map((value) => stripTrailingOrdinal(value)).filter(Boolean);
  if (stems.length === 0) {
    return fallback;
  }
  return stems.every((value) => value === stems[0]) ? stems[0] : fallback;
}

function deriveChannelIdPrefixFromBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "channel";
  }
  try {
    const url = new URL(raw);
    return sanitizeModelChannelSafeId(url.hostname.replace(/^www\./i, ""), "channel");
  } catch {
    return sanitizeModelChannelSafeId(raw, "channel");
  }
}

function getChannelModelIds(channel) {
  return Array.isArray(channel?.models)
    ? channel.models.map((model) => String(model?.id || "").trim()).filter(Boolean)
    : [];
}

function areModelIdListsEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function resolveSettingsChannels(settings) {
  return Array.isArray(settings?.channels)
    ? settings.channels.filter((channel) => String(channel?.id || "").trim())
    : [];
}

function resolveSettingsGroups(settings) {
  return Array.isArray(settings?.channelGroups)
    ? settings.channelGroups.filter((group) => String(group?.id || "").trim())
    : [];
}

function resolveHydrationSeed(settings) {
  const channels = resolveSettingsChannels(settings);
  const groups = resolveSettingsGroups(settings);
  const channelMap = new Map(channels.map((channel) => [String(channel.id).trim(), channel]));
  const fullCoverageGroup = groups.find((group) => {
    if (group?.strategy !== "round-robin" || !Array.isArray(group.channelIds)) {
      return false;
    }
    const groupChannelIds = group.channelIds.map((channelId) => String(channelId || "").trim()).filter(Boolean);
    return groupChannelIds.length > 1 && groupChannelIds.length === channels.length && groupChannelIds.every((id) => channelMap.has(id));
  });
  const candidateChannels = fullCoverageGroup
    ? fullCoverageGroup.channelIds.map((channelId) => channelMap.get(String(channelId || "").trim())).filter(Boolean)
    : channels;
  const firstChannel = candidateChannels[0] || null;
  const firstModelIds = firstChannel ? getChannelModelIds(firstChannel) : [];
  const modelsMatch =
    firstModelIds.length > 0 && candidateChannels.every((channel) => areModelIdListsEqual(getChannelModelIds(channel), firstModelIds));
  const firstModel = Array.isArray(firstChannel?.models) && firstChannel.models.length > 0 ? firstChannel.models[0] : null;
  const createRoundRobinGroup = candidateChannels.length > 1 ? Boolean(fullCoverageGroup) : true;
  const mode = candidateChannels.length > 1 && !candidateChannels.every((channel) => channel?.baseUrl === firstChannel?.baseUrl) ? "multi" : "single";
  const singleIdPrefix =
    stripTrailingRoundRobinSuffix(fullCoverageGroup?.id) ||
    deriveCommonStem(candidateChannels.map((channel) => channel?.id), String(firstChannel?.id || "").trim());
  const singleNamePrefix =
    stripTrailingRoundRobinSuffix(fullCoverageGroup?.name) ||
    deriveCommonStem(
      candidateChannels.map((channel) => String(channel?.name || channel?.id || "").trim()),
      String(firstChannel?.name || firstChannel?.id || "").trim(),
    );

  return {
    mode,
    shared: {
      reasoning: firstModel?.reasoning !== false,
      allowImageInput: Boolean(firstModel?.input?.image),
      createRoundRobinGroup,
    },
    single: {
      baseUrl: String(firstChannel?.baseUrl || "").trim(),
      api: normalizeModelChannelGeneratorApiValueSection(firstChannel?.api),
      channelIdPrefix: singleIdPrefix,
      channelNamePrefix: singleNamePrefix,
      apiKeys: candidateChannels.map((channel) => String(channel?.apiKey || "").trim()).filter(Boolean).join("\n"),
      modelIds: firstModelIds.join("\n"),
    },
    multi: {
      modelIds: (modelsMatch ? firstModelIds : firstModelIds).join("\n"),
      groupId: String(fullCoverageGroup?.id || "").trim(),
      groupName: String(fullCoverageGroup?.name || "").trim(),
      rows: candidateChannels.map((channel) => ({
        channelNamePrefix: String(channel?.name || channel?.id || "").trim(),
        channelIdPrefix: String(channel?.id || "").trim(),
        baseUrl: String(channel?.baseUrl || "").trim(),
        api: normalizeModelChannelGeneratorApiValueSection(channel?.api),
        apiKey: String(channel?.apiKey || "").trim(),
      })),
    },
  };
}

function isMultiUrlRowBlank(row) {
  return ["channelNamePrefix", "channelIdPrefix", "baseUrl", "apiKey"].every(
    (field) => !readMultiUrlModelChannelRowFieldSection(row, field),
  );
}

function trimModelChannelDraftOptional(value) {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

function cloneModelChannelDraftValue(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function buildDefaultModelChannelDraftModel(id, api) {
  const modelId = String(id || "").trim();
  return {
    id: modelId,
    name: modelId,
    api: trimModelChannelDraftOptional(normalizeModelChannelGeneratorApiValueSection(api, { allowBlank: true })),
    reasoning: true,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 16_384,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
  };
}

function reserveUniqueModelChannelProviderId(baseValue, takenIds) {
  const base = sanitizeModelChannelSafeId(baseValue, "channel");
  let candidate = base;
  let suffix = 2;
  while (takenIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  takenIds.add(candidate);
  return candidate;
}

function splitModelChannelReference(value, providerId) {
  const raw = String(value || "").trim();
  const normalizedProviderId = String(providerId || "").trim();
  if (!raw || !normalizedProviderId) {
    return raw;
  }
  const prefix = `${normalizedProviderId}/`;
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
}

function rewriteModelChannelReferenceProvider(value, previousProviderId, nextProviderId) {
  const raw = String(value || "").trim();
  const previous = String(previousProviderId || "").trim();
  const next = String(nextProviderId || "").trim();
  if (!raw || !previous || !next) {
    return raw;
  }
  const prefix = `${previous}/`;
  if (!raw.startsWith(prefix)) {
    return raw;
  }
  return `${next}/${raw.slice(prefix.length)}`;
}

function normalizeModelChannelDraftModelReferenceList(channel, nextModelIds) {
  const providerId = String(channel?.providerId || "").trim();
  const nextIds = nextModelIds.map((entry) => String(entry || "").trim()).filter(Boolean);
  const currentDefaultId = splitModelChannelReference(channel?.defaultModel, providerId);
  if (nextIds.length === 0) {
    channel.defaultModel = "";
  } else if (!nextIds.includes(currentDefaultId)) {
    channel.defaultModel = nextIds[0];
  }
  for (const field of ["imageModel", "imageGenerationModel", "pdfModel"]) {
    const modelId = splitModelChannelReference(channel?.[field], providerId);
    if (modelId && !nextIds.includes(modelId)) {
      channel[field] = undefined;
    }
  }
}

function channelHasAdvancedDraftFields(channel) {
  if (channel?.auth || (channel?.headers && Object.keys(channel.headers).length > 0)) {
    return true;
  }
  return (channel?.models ?? []).some((model) => {
    const inputKinds = Array.isArray(model?.input) ? model.input : [];
    const cost = model?.cost ?? {};
    return (
      String(model?.name || "").trim() !== String(model?.id || "").trim() ||
      String(model?.api || "").trim() !== "" ||
      model?.reasoning === false ||
      inputKinds.includes("image") ||
      Number(model?.contextWindow ?? 128_000) !== 128_000 ||
      Number(model?.maxTokens ?? 16_384) !== 16_384 ||
      Number(cost.input ?? 0) !== 0 ||
      Number(cost.output ?? 0) !== 0 ||
      Number(cost.cacheRead ?? 0) !== 0 ||
      Number(cost.cacheWrite ?? 0) !== 0
    );
  });
}

function describeModelChannelAdvancedDraftFields(channel) {
  const labels = [];
  if (channel?.auth) {
    labels.push("auth");
  }
  if (channel?.headers && Object.keys(channel.headers).length > 0) {
    labels.push("headers");
  }
  if (channelHasAdvancedDraftFields(channel)) {
    labels.push("model details");
  }
  return [...new Set(labels)];
}

function buildModelChannelDraftSummaryMarkup(settings, escapeHtml) {
  const channels = resolveSettingsChannels(settings);
  const groups = resolveSettingsGroups(settings);
  const advancedChannelCount = channels.filter(channelHasAdvancedDraftFields).length;
  const summary = `${channels.length} 个渠道 / ${groups.length} 个轮询组`;
  const detail =
    advancedChannelCount > 0
      ? `${advancedChannelCount} 个渠道还保留了 auth、headers 或细粒度 model 参数；需要细改时请用下方高级 JSON。`
      : "卡片是唯一主编辑入口；高级 JSON 仅用于低频导入 / 导出。";
  return `<strong>${escapeHtml(summary)}</strong><br />${escapeHtml(detail)}`;
}

function renderModelChannelDraftGroupCard(group, index, channels, escapeHtml) {
  const title = String(group?.name || group?.id || `轮询组 ${index + 1}`).trim();
  const selectedChannelIds = new Set(
    Array.isArray(group?.channelIds) ? group.channelIds.map((channelId) => String(channelId || "").trim()).filter(Boolean) : [],
  );
  const channelOptions =
    channels.length > 0
      ? channels
          .map((channel) => {
            const channelId = String(channel?.id || "").trim();
            const channelLabel = String(channel?.name || channelId).trim() || channelId;
            return `
              <label class="toggle channel-group-member-option">
                <input
                  type="checkbox"
                  data-action="toggle-model-channel-draft-group-member"
                  data-group-index="${index}"
                  data-channel-id="${escapeHtml(channelId)}"
                  ${selectedChannelIds.has(channelId) ? "checked" : ""}
                />
                <span>${escapeHtml(channelLabel)}<small class="field-note">${escapeHtml(channelId)}</small></span>
              </label>
            `;
          })
          .join("")
      : '<div class="field-note">先新增至少一个渠道，再把它加入轮询组。</div>';

  return `
    <section class="generator-card channel-draft-item channel-draft-group-card" data-model-channel-group-index="${index}">
      <div class="generator-card-header">
        <div>
          <p class="generator-card-title">轮询组 ${index + 1} · ${escapeHtml(title)}</p>
          <p class="field-note">把已存在的渠道加入这个 round-robin 组，作为统一调度入口。</p>
        </div>
        <div class="inline-actions">
          <button class="button" type="button" data-action="remove-model-channel-draft-group" data-group-index="${index}">删除轮询组</button>
        </div>
      </div>
      <div class="generator-card-grid">
        <label class="field">
          <span>轮询组 ID</span>
          <input data-field="id" data-group-index="${index}" type="text" spellcheck="false" value="${escapeHtml(String(group?.id || ""))}" />
        </label>
        <label class="field">
          <span>轮询组名称</span>
          <input data-field="name" data-group-index="${index}" type="text" spellcheck="false" value="${escapeHtml(String(group?.name || ""))}" />
        </label>
        <label class="field field-span-2">
          <span>策略</span>
          <input type="text" value="round-robin" disabled />
          <small class="field-note">当前值班台只支持 round-robin 轮询组。</small>
        </label>
      </div>
      <div class="channel-group-members">
        <span class="channel-group-members-label">包含渠道</span>
        <div class="channel-group-members-grid">${channelOptions}</div>
      </div>
    </section>
  `;
}

function renderModelChannelDraftChannelCard(channel, index, escapeHtml) {
  const title = String(channel?.name || channel?.id || `渠道 ${index + 1}`).trim();
  const modelIds = Array.isArray(channel?.models)
    ? channel.models.map((model) => String(model?.id || "").trim()).filter(Boolean).join("\n")
    : "";
  const advancedLabels = describeModelChannelAdvancedDraftFields(channel);
  const advancedNote =
    advancedLabels.length > 0
      ? `
          <div class="field-note channel-draft-advanced-note">
            已保留高级字段：${escapeHtml(advancedLabels.join(", "))}。要细改这些内容，请用下方高级 JSON。
          </div>
        `
      : "";

  return `
    <section class="generator-card channel-draft-item" data-model-channel-index="${index}">
      <div class="generator-card-header">
        <p class="generator-card-title">渠道 ${index + 1} · ${escapeHtml(title)}</p>
        <div class="inline-actions">
          <button class="button" type="button" data-action="remove-model-channel-draft-channel" data-channel-index="${index}">删除渠道</button>
        </div>
      </div>
      <div class="generator-card-grid">
        <label class="field">
          <span>渠道 ID</span>
          <input data-field="id" data-channel-index="${index}" type="text" spellcheck="false" value="${escapeHtml(String(channel?.id || ""))}" />
        </label>
        <label class="field">
          <span>渠道名称</span>
          <input data-field="name" data-channel-index="${index}" type="text" spellcheck="false" value="${escapeHtml(String(channel?.name || ""))}" />
        </label>
        <label class="field">
          <span>providerId</span>
          <input data-field="providerId" data-channel-index="${index}" type="text" spellcheck="false" value="${escapeHtml(String(channel?.providerId || ""))}" />
        </label>
        <label class="field">
          <span>API 类型</span>
          <select data-field="api" data-channel-index="${index}">
            ${buildModelChannelGeneratorApiOptionsHtmlSection(escapeHtml, { selectedValue: channel?.api || "", allowBlank: true })}
          </select>
        </label>
        <label class="field field-span-2">
          <span>渠道 URL</span>
          <input data-field="baseUrl" data-channel-index="${index}" type="text" spellcheck="false" value="${escapeHtml(String(channel?.baseUrl || ""))}" placeholder="https://api.openai.com/v1" />
        </label>
        <label class="field field-span-2">
          <span>API Key</span>
          <textarea data-field="apiKey" data-channel-index="${index}" rows="2" spellcheck="false" placeholder="sk-xxx">${escapeHtml(String(channel?.apiKey || ""))}</textarea>
        </label>
        <label class="field">
          <span>默认模型</span>
          <input data-field="defaultModel" data-channel-index="${index}" type="text" spellcheck="false" value="${escapeHtml(String(channel?.defaultModel || ""))}" placeholder="gpt-5-mini" />
        </label>
        <label class="field">
          <span>图片输入模型</span>
          <input data-field="imageModel" data-channel-index="${index}" type="text" spellcheck="false" value="${escapeHtml(String(channel?.imageModel || ""))}" />
        </label>
        <label class="field">
          <span>图片生成模型</span>
          <input data-field="imageGenerationModel" data-channel-index="${index}" type="text" spellcheck="false" value="${escapeHtml(String(channel?.imageGenerationModel || ""))}" />
        </label>
        <label class="field">
          <span>PDF 模型</span>
          <input data-field="pdfModel" data-channel-index="${index}" type="text" spellcheck="false" value="${escapeHtml(String(channel?.pdfModel || ""))}" />
        </label>
        <label class="field field-span-2">
          <span>模型 ID（每行一个）</span>
          <textarea data-field="models" data-channel-index="${index}" rows="4" spellcheck="false" placeholder="gpt-5-mini">${escapeHtml(modelIds)}</textarea>
          <small class="field-note">会保留已有模型的 reasoning / input / cost 等字段；新增模型使用默认参数。</small>
        </label>
      </div>
      ${advancedNote}
    </section>
  `;
}

export function getModelChannelDraftExportTextSection(settings) {
  return JSON.stringify(settings ?? { userCanConfigureModels: false, channels: [], channelGroups: [] }, null, 2);
}

export function renderModelChannelDraftWorkbenchSection(elements, escapeHtml, settings) {
  const currentSettings = settings ?? { userCanConfigureModels: false, channels: [], channelGroups: [] };
  const channels = resolveSettingsChannels(currentSettings);
  const groups = resolveSettingsGroups(currentSettings);
  if (elements.modelChannelDraftSummary) {
    elements.modelChannelDraftSummary.innerHTML = buildModelChannelDraftSummaryMarkup(currentSettings, escapeHtml);
  }
  if (elements.modelChannelsExportTextarea) {
    elements.modelChannelsExportTextarea.value = getModelChannelDraftExportTextSection(currentSettings);
  }
  if (elements.modelChannelDraftEmptyState) {
    const isEmpty = channels.length === 0 && groups.length === 0;
    elements.modelChannelDraftEmptyState.classList.toggle("hidden", !isEmpty);
  }
  if (elements.modelChannelDraftGroups) {
    elements.modelChannelDraftGroups.innerHTML = groups
      .map((group, index) => renderModelChannelDraftGroupCard(group, index, channels, escapeHtml))
      .join("");
  }
  if (elements.modelChannelDraftChannels) {
    elements.modelChannelDraftChannels.innerHTML = channels
      .map((channel, index) => renderModelChannelDraftChannelCard(channel, index, escapeHtml))
      .join("");
  }
}

export function cloneModelChannelSettingsDraftSection(settings) {
  return cloneModelChannelDraftValue(settings ?? { userCanConfigureModels: false, channels: [], channelGroups: [] });
}

export function addModelChannelDraftChannelSection(settings) {
  const nextSettings = cloneModelChannelSettingsDraftSection(settings);
  nextSettings.channels = Array.isArray(nextSettings.channels) ? nextSettings.channels : [];
  nextSettings.channelGroups = Array.isArray(nextSettings.channelGroups) ? nextSettings.channelGroups : [];
  const takenIds = new Set([
    ...nextSettings.channels.map((channel) => String(channel?.id || "").trim()).filter(Boolean),
    ...nextSettings.channelGroups.map((group) => String(group?.id || "").trim()).filter(Boolean),
  ]);
  const takenProviderIds = new Set(
    nextSettings.channels.map((channel) => String(channel?.providerId || "").trim()).filter(Boolean),
  );
  const channelId = reserveUniqueModelChannelSafeId("channel", takenIds);
  const providerId = reserveUniqueModelChannelProviderId(channelId, takenProviderIds);
  const modelId = "gpt-5-mini";
  nextSettings.channels.push({
    id: channelId,
    name: `渠道 ${nextSettings.channels.length + 1}`,
    providerId,
    baseUrl: "",
    api: "openai-responses",
    models: [buildDefaultModelChannelDraftModel(modelId, "openai-responses")],
    defaultModel: modelId,
  });
  return nextSettings;
}

export function removeModelChannelDraftChannelSection(settings, channelIndex) {
  const nextSettings = cloneModelChannelSettingsDraftSection(settings);
  nextSettings.channels = Array.isArray(nextSettings.channels) ? [...nextSettings.channels] : [];
  nextSettings.channelGroups = Array.isArray(nextSettings.channelGroups) ? [...nextSettings.channelGroups] : [];
  const [removedChannel] = nextSettings.channels.splice(channelIndex, 1);
  const removedChannelId = String(removedChannel?.id || "").trim();
  if (!removedChannelId) {
    return nextSettings;
  }
  nextSettings.channelGroups = nextSettings.channelGroups
    .map((group) => ({
      ...group,
      channelIds: Array.isArray(group?.channelIds)
        ? group.channelIds.map((channelId) => String(channelId || "").trim()).filter((channelId) => channelId && channelId !== removedChannelId)
        : [],
    }))
    .filter((group) => group.channelIds.length > 0);
  return nextSettings;
}

export function updateModelChannelDraftChannelFieldSection(settings, channelIndex, field, value) {
  const nextSettings = cloneModelChannelSettingsDraftSection(settings);
  nextSettings.channels = Array.isArray(nextSettings.channels) ? [...nextSettings.channels] : [];
  const channel = nextSettings.channels[channelIndex];
  if (!channel) {
    return nextSettings;
  }
  const previousProviderId = String(channel.providerId || "").trim();
  const rawValue = String(value ?? "").trim();
  const optionalFields = new Set(["api", "apiKey", "imageModel", "imageGenerationModel", "pdfModel", "auth"]);
  channel[field] = optionalFields.has(field) ? trimModelChannelDraftOptional(rawValue) : rawValue;
  if (field === "providerId" && previousProviderId && rawValue) {
    for (const referenceField of ["defaultModel", "imageModel", "imageGenerationModel", "pdfModel"]) {
      channel[referenceField] = rewriteModelChannelReferenceProvider(
        channel[referenceField],
        previousProviderId,
        rawValue,
      );
    }
  }
  return nextSettings;
}

export function updateModelChannelDraftModelsSection(settings, channelIndex, rawValue) {
  const nextSettings = cloneModelChannelSettingsDraftSection(settings);
  nextSettings.channels = Array.isArray(nextSettings.channels) ? [...nextSettings.channels] : [];
  const channel = nextSettings.channels[channelIndex];
  if (!channel) {
    return nextSettings;
  }
  const nextModelIds = splitModelChannelGeneratorListSection(rawValue);
  const existingModels = new Map(
    (Array.isArray(channel.models) ? channel.models : [])
      .map((model) => [String(model?.id || "").trim(), model])
      .filter(([modelId]) => modelId),
  );
  channel.models = nextModelIds.map((modelId) => {
    const existing = existingModels.get(modelId);
    return existing ? { ...existing } : buildDefaultModelChannelDraftModel(modelId, channel.api);
  });
  normalizeModelChannelDraftModelReferenceList(channel, nextModelIds);
  return nextSettings;
}

export function addModelChannelDraftGroupSection(settings) {
  const nextSettings = cloneModelChannelSettingsDraftSection(settings);
  nextSettings.channels = Array.isArray(nextSettings.channels) ? nextSettings.channels : [];
  nextSettings.channelGroups = Array.isArray(nextSettings.channelGroups) ? nextSettings.channelGroups : [];
  const firstChannelId = String(nextSettings.channels[0]?.id || "").trim();
  if (!firstChannelId) {
    return nextSettings;
  }
  const takenIds = new Set([
    ...nextSettings.channels.map((channel) => String(channel?.id || "").trim()).filter(Boolean),
    ...nextSettings.channelGroups.map((group) => String(group?.id || "").trim()).filter(Boolean),
  ]);
  const groupId = reserveUniqueModelChannelSafeId("channel-group", takenIds);
  nextSettings.channelGroups.push({
    id: groupId,
    name: `轮询组 ${nextSettings.channelGroups.length + 1}`,
    strategy: "round-robin",
    channelIds: [firstChannelId],
  });
  return nextSettings;
}

export function removeModelChannelDraftGroupSection(settings, groupIndex) {
  const nextSettings = cloneModelChannelSettingsDraftSection(settings);
  nextSettings.channelGroups = Array.isArray(nextSettings.channelGroups) ? [...nextSettings.channelGroups] : [];
  nextSettings.channelGroups.splice(groupIndex, 1);
  return nextSettings;
}

export function updateModelChannelDraftGroupFieldSection(settings, groupIndex, field, value) {
  const nextSettings = cloneModelChannelSettingsDraftSection(settings);
  nextSettings.channelGroups = Array.isArray(nextSettings.channelGroups) ? [...nextSettings.channelGroups] : [];
  const group = nextSettings.channelGroups[groupIndex];
  if (!group) {
    return nextSettings;
  }
  group[field] = String(value ?? "").trim();
  return nextSettings;
}

export function toggleModelChannelDraftGroupChannelSection(settings, groupIndex, channelId, checked) {
  const nextSettings = cloneModelChannelSettingsDraftSection(settings);
  nextSettings.channels = Array.isArray(nextSettings.channels) ? [...nextSettings.channels] : [];
  nextSettings.channelGroups = Array.isArray(nextSettings.channelGroups) ? [...nextSettings.channelGroups] : [];
  const group = nextSettings.channelGroups[groupIndex];
  if (!group) {
    return nextSettings;
  }
  const selectedIds = new Set(
    Array.isArray(group.channelIds) ? group.channelIds.map((entry) => String(entry || "").trim()).filter(Boolean) : [],
  );
  const normalizedChannelId = String(channelId || "").trim();
  if (!normalizedChannelId) {
    return nextSettings;
  }
  if (checked) {
    selectedIds.add(normalizedChannelId);
  } else {
    selectedIds.delete(normalizedChannelId);
  }
  const orderedChannelIds = nextSettings.channels
    .map((channel) => String(channel?.id || "").trim())
    .filter((id) => id && selectedIds.has(id));
  group.channelIds = orderedChannelIds;
  return nextSettings;
}

function buildDefaultRoundRobinGroupIdentity(groupId, groupName, channelIds) {
  const normalizedChannelIds = channelIds.map((channelId) => String(channelId || "").trim()).filter(Boolean);
  const channelStem =
    stripTrailingRoundRobinSuffix(deriveCommonStem(normalizedChannelIds, normalizedChannelIds[0] || "channel")) || "channel";
  const nextId = String(groupId || "").trim() || `${channelStem}-rr`;
  const nextName = String(groupName || "").trim() || `${channelStem} round robin`;
  return {
    id: nextId,
    name: nextName,
  };
}

export function splitModelChannelGeneratorListSection(value) {
  const seen = new Set();
  return String(value || "")
    .split(/[\r\n,;；、]+/)
    .map((entry) => String(entry || "").trim())
    .filter((entry) => {
      if (!entry || seen.has(entry)) {
        return false;
      }
      seen.add(entry);
      return true;
    });
}

export function normalizeModelChannelGeneratorApiValueSection(
  value,
  { allowBlank = false, fallback = "openai-responses" } = {},
) {
  const raw = String(value || "").trim();
  if (!raw) {
    return allowBlank ? "" : fallback;
  }
  return MODEL_CHANNEL_GENERATOR_API_ALIASES.get(raw.toLowerCase()) || raw;
}

export function buildModelChannelGeneratorSharedOptionsSection(elements) {
  return {
    reasoning: Boolean(elements.modelChannelGenerateReasoningCheckbox?.checked),
    allowImageInput: Boolean(elements.modelChannelGenerateImageInputCheckbox?.checked),
    createRoundRobinGroup: Boolean(elements.modelChannelGenerateRoundRobinCheckbox?.checked),
  };
}

export function getModelChannelGeneratorModeSection(elements) {
  if (elements.modelChannelGenerateModeMultiInput?.checked) {
    return "multi";
  }
  return "single";
}

export function setModelChannelGeneratorModeSection(elements, mode) {
  const normalizedMode = mode === "multi" ? "multi" : "single";
  if (elements.modelChannelGenerateModeSingleInput) {
    elements.modelChannelGenerateModeSingleInput.checked = normalizedMode === "single";
    elements.modelChannelGenerateModeSingleInput.closest(".channel-mode-option")?.classList.toggle(
      "active",
      normalizedMode === "single",
    );
  }
  if (elements.modelChannelGenerateModeMultiInput) {
    elements.modelChannelGenerateModeMultiInput.checked = normalizedMode === "multi";
    elements.modelChannelGenerateModeMultiInput.closest(".channel-mode-option")?.classList.toggle(
      "active",
      normalizedMode === "multi",
    );
  }
  elements.modelChannelSinglePanel?.classList.toggle("hidden", normalizedMode !== "single");
  elements.modelChannelMultiPanel?.classList.toggle("hidden", normalizedMode !== "multi");
}

export function buildSingleModelChannelGeneratorPayloadSection(baseSettings, elements) {
  const sharedOptions = buildModelChannelGeneratorSharedOptionsSection(elements);
  return {
    settings: baseSettings,
    generator: {
      baseUrl: elements.modelChannelSingleBaseUrlInput?.value?.trim() || "",
      api: normalizeModelChannelGeneratorApiValueSection(elements.modelChannelSingleApiInput?.value),
      channelIdPrefix: elements.modelChannelSingleIdPrefixInput?.value?.trim() || "",
      channelNamePrefix: elements.modelChannelSingleNamePrefixInput?.value?.trim() || "",
      apiKeys: elements.modelChannelSingleApiKeysTextarea?.value ?? "",
      modelIds: elements.modelChannelSingleModelsTextarea?.value ?? "",
      reasoning: sharedOptions.reasoning,
      allowImageInput: sharedOptions.allowImageInput,
      createRoundRobinGroup: sharedOptions.createRoundRobinGroup,
    },
  };
}

export function getMultiUrlModelChannelRowsSection(elements) {
  return Array.from(elements.modelChannelMultiRows?.querySelectorAll(".channel-multi-row") ?? []);
}

export function readMultiUrlModelChannelRowFieldSection(row, field) {
  return row.querySelector(`[data-field="${field}"]`)?.value?.trim() || "";
}

export function syncMultiUrlModelChannelRowsEmptyStateSection(elements) {
  const hasRows = getMultiUrlModelChannelRowsSection(elements).length > 0;
  elements.modelChannelMultiRowsEmptyState?.classList.toggle("hidden", hasRows);
}

export function renumberMultiUrlModelChannelRowsSection(elements) {
  getMultiUrlModelChannelRowsSection(elements).forEach((row, index) => {
    const title = row.querySelector("[data-model-channel-multi-row-title]");
    if (!title) {
      return;
    }
    const name = readMultiUrlModelChannelRowFieldSection(row, "channelNamePrefix");
    const id = readMultiUrlModelChannelRowFieldSection(row, "channelIdPrefix");
    const baseUrl = readMultiUrlModelChannelRowFieldSection(row, "baseUrl");
    const summary = name || id || baseUrl;
    title.textContent = summary ? `URL 行 ${index + 1} / ${summary}` : `URL 行 ${index + 1}`;
  });
  syncMultiUrlModelChannelRowsEmptyStateSection(elements);
}

export function createMultiUrlModelChannelRowSection(documentRef, escapeHtml, values = {}) {
  const channelNamePrefix = String(values.channelNamePrefix || "").trim();
  const channelIdPrefix = String(values.channelIdPrefix || "").trim();
  const baseUrl = String(values.baseUrl || "").trim();
  const api = normalizeModelChannelGeneratorApiValueSection(values.api, { allowBlank: true }) || "openai-responses";
  const apiKey = String(values.apiKey || "").trim();
  const row = documentRef.createElement("section");
  row.className = "generator-card channel-multi-row";
  row.innerHTML = `
    <div class="generator-card-header">
      <p class="generator-card-title" data-model-channel-multi-row-title>URL 行</p>
      <div class="inline-actions">
        <button class="button" type="button" data-action="duplicate-model-channel-multi-row">复制此行</button>
        <button class="button" type="button" data-action="remove-model-channel-multi-row">删除此行</button>
      </div>
    </div>
    <div class="generator-card-grid">
      <label class="field">
        <span>渠道名称前缀</span>
        <input data-field="channelNamePrefix" type="text" spellcheck="false" placeholder="OpenAI HK" value="${escapeHtml(channelNamePrefix)}" />
      </label>
      <label class="field">
        <span>渠道 ID 前缀</span>
        <input data-field="channelIdPrefix" type="text" spellcheck="false" placeholder="openai-hk" value="${escapeHtml(channelIdPrefix)}" />
      </label>
      <label class="field field-span-2">
        <span>渠道 URL</span>
        <input data-field="baseUrl" type="text" spellcheck="false" placeholder="https://api.openai.com/v1" value="${escapeHtml(baseUrl)}" />
      </label>
      <label class="field">
        <span>API 类型</span>
        <select data-field="api">
          ${buildModelChannelGeneratorApiOptionsHtmlSection(escapeHtml, { selectedValue: api, allowBlank: false })}
        </select>
      </label>
      <label class="field field-span-2">
        <span>API Key</span>
        <textarea data-field="apiKey" rows="2" spellcheck="false" placeholder="sk-xxx">${escapeHtml(apiKey)}</textarea>
      </label>
    </div>
  `;
  return row;
}

export function appendMultiUrlModelChannelRowSection(elements, documentRef, escapeHtml, values = {}) {
  if (!elements.modelChannelMultiRows) {
    return null;
  }
  const row = createMultiUrlModelChannelRowSection(documentRef, escapeHtml, values);
  elements.modelChannelMultiRows.appendChild(row);
  renumberMultiUrlModelChannelRowsSection(elements);
  return row;
}

export function clearMultiUrlModelChannelRowsSection(elements) {
  if (!elements.modelChannelMultiRows) {
    return;
  }
  elements.modelChannelMultiRows.innerHTML = "";
  syncMultiUrlModelChannelRowsEmptyStateSection(elements);
}

export function buildMultiUrlModelChannelGenerationPlanSection(elements) {
  const sharedOptions = buildModelChannelGeneratorSharedOptionsSection(elements);
  const sharedModelIds = splitModelChannelGeneratorListSection(elements.modelChannelMultiModelsTextarea?.value ?? "");
  if (sharedModelIds.length === 0) {
    throw new Error("Multi URL mode needs at least one model ID.");
  }

  const generators = [];
  const rows = getMultiUrlModelChannelRowsSection(elements);
  for (const [index, row] of rows.entries()) {
    const channelNamePrefix = readMultiUrlModelChannelRowFieldSection(row, "channelNamePrefix");
    const channelIdPrefix = readMultiUrlModelChannelRowFieldSection(row, "channelIdPrefix");
    const baseUrl = readMultiUrlModelChannelRowFieldSection(row, "baseUrl");
    const api = normalizeModelChannelGeneratorApiValueSection(readMultiUrlModelChannelRowFieldSection(row, "api"));
    const apiKey = readMultiUrlModelChannelRowFieldSection(row, "apiKey");
    const hasContent = [channelNamePrefix, channelIdPrefix, baseUrl, apiKey].some(Boolean);
    if (!hasContent) {
      continue;
    }
    if (!baseUrl || !apiKey) {
      throw new Error(`Row ${index + 1} is missing URL or API key.`);
    }
    generators.push({
      baseUrl,
      api,
      channelIdPrefix,
      channelNamePrefix,
      modelIds: sharedModelIds,
      apiKeys: [apiKey],
      reasoning: sharedOptions.reasoning,
      allowImageInput: sharedOptions.allowImageInput,
      createRoundRobinGroup: false,
    });
  }

  if (generators.length === 0) {
    throw new Error("Add at least one URL row before generating the draft.");
  }

  return {
    generators,
    group: {
      enabled: sharedOptions.createRoundRobinGroup,
      groupId: elements.modelChannelMultiGroupIdInput?.value?.trim() || "",
      groupName: elements.modelChannelMultiGroupNameInput?.value?.trim() || "",
    },
  };
}

export function setModelChannelGenerateRowsDisabledSection(elements, disabled) {
  if (elements.addModelChannelMultiRowButton) {
    elements.addModelChannelMultiRowButton.disabled = disabled;
  }
  if (elements.importModelChannelBatchButton) {
    elements.importModelChannelBatchButton.disabled = disabled;
  }
  if (elements.clearModelChannelMultiRowsButton) {
    elements.clearModelChannelMultiRowsButton.disabled = disabled;
  }
  if (elements.modelChannelGenerateBatchTextarea) {
    elements.modelChannelGenerateBatchTextarea.disabled = disabled;
  }
  if (elements.modelChannelMultiModelsTextarea) {
    elements.modelChannelMultiModelsTextarea.disabled = disabled;
  }
  if (elements.modelChannelMultiGroupIdInput) {
    elements.modelChannelMultiGroupIdInput.disabled = disabled;
  }
  if (elements.modelChannelMultiGroupNameInput) {
    elements.modelChannelMultiGroupNameInput.disabled = disabled;
  }
  const controls = elements.modelChannelMultiRows?.querySelectorAll("input, textarea, button, select") ?? [];
  for (const control of controls) {
    control.disabled = disabled;
  }
}

export function parseBatchModelChannelRowsSection(raw) {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (lines.length === 0) {
    return {
      rows: [],
      sharedModelIds: [],
    };
  }

  let sharedModelIds = [];
  const rows = lines.map((line, index) => {
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length < 5 || parts.length > 6) {
      throw new Error(`Batch line ${index + 1} must contain 5 or 6 columns separated by "|".`);
    }
    const [channelNamePrefix, channelIdPrefix, baseUrl, modelIdsRaw, apiKeysRaw, apiRaw] = parts;
    if (!channelNamePrefix || !channelIdPrefix || !baseUrl || !modelIdsRaw || !apiKeysRaw) {
      throw new Error(`Batch line ${index + 1} is missing required fields.`);
    }
    const modelIds = splitModelChannelGeneratorListSection(modelIdsRaw);
    const apiKeys = splitModelChannelGeneratorListSection(apiKeysRaw);
    if (modelIds.length === 0) {
      throw new Error(`Batch line ${index + 1} needs at least one model ID.`);
    }
    if (apiKeys.length !== 1) {
      throw new Error(`Batch line ${index + 1} must contain exactly one API key in multi URL mode.`);
    }
    if (sharedModelIds.length === 0) {
      sharedModelIds = modelIds;
    } else if (!areModelIdListsEqual(sharedModelIds, modelIds)) {
      throw new Error(`Batch line ${index + 1} must use the same model list as the previous lines.`);
    }
    return {
      channelNamePrefix,
      channelIdPrefix,
      baseUrl,
      api: normalizeModelChannelGeneratorApiValueSection(apiRaw || "openai-responses"),
      apiKey: apiKeys[0],
    };
  });

  return {
    rows,
    sharedModelIds,
  };
}

export function importBatchModelChannelGeneratorsAsRowsSection(elements, documentRef, escapeHtml, raw) {
  const { rows, sharedModelIds } = parseBatchModelChannelRowsSection(raw);
  if (rows.length === 0) {
    return 0;
  }
  const currentRows = getMultiUrlModelChannelRowsSection(elements);
  if (currentRows.length > 0 && currentRows.every((row) => isMultiUrlRowBlank(row))) {
    clearMultiUrlModelChannelRowsSection(elements);
  }
  if (elements.modelChannelMultiModelsTextarea) {
    elements.modelChannelMultiModelsTextarea.value = sharedModelIds.join("\n");
  }
  for (const row of rows) {
    appendMultiUrlModelChannelRowSection(elements, documentRef, escapeHtml, row);
  }
  return rows.length;
}

export function hydrateModelChannelGeneratorEditorFromSettingsSection(elements, documentRef, escapeHtml, settings) {
  const seed = resolveHydrationSeed(settings);

  if (elements.modelChannelSingleBaseUrlInput) {
    elements.modelChannelSingleBaseUrlInput.value = seed.single.baseUrl;
  }
  if (elements.modelChannelSingleApiInput) {
    elements.modelChannelSingleApiInput.value = seed.single.api;
  }
  if (elements.modelChannelSingleIdPrefixInput) {
    elements.modelChannelSingleIdPrefixInput.value = seed.single.channelIdPrefix;
  }
  if (elements.modelChannelSingleNamePrefixInput) {
    elements.modelChannelSingleNamePrefixInput.value = seed.single.channelNamePrefix;
  }
  if (elements.modelChannelSingleApiKeysTextarea) {
    elements.modelChannelSingleApiKeysTextarea.value = seed.single.apiKeys;
  }
  if (elements.modelChannelSingleModelsTextarea) {
    elements.modelChannelSingleModelsTextarea.value = seed.single.modelIds;
  }
  if (elements.modelChannelMultiModelsTextarea) {
    elements.modelChannelMultiModelsTextarea.value = seed.multi.modelIds;
  }
  if (elements.modelChannelMultiGroupIdInput) {
    elements.modelChannelMultiGroupIdInput.value = seed.multi.groupId;
  }
  if (elements.modelChannelMultiGroupNameInput) {
    elements.modelChannelMultiGroupNameInput.value = seed.multi.groupName;
  }
  if (elements.modelChannelGenerateReasoningCheckbox) {
    elements.modelChannelGenerateReasoningCheckbox.checked = seed.shared.reasoning;
  }
  if (elements.modelChannelGenerateImageInputCheckbox) {
    elements.modelChannelGenerateImageInputCheckbox.checked = seed.shared.allowImageInput;
  }
  if (elements.modelChannelGenerateRoundRobinCheckbox) {
    elements.modelChannelGenerateRoundRobinCheckbox.checked = seed.shared.createRoundRobinGroup;
  }
  clearMultiUrlModelChannelRowsSection(elements);
  for (const row of seed.multi.rows) {
    appendMultiUrlModelChannelRowSection(elements, documentRef, escapeHtml, row);
  }
  if (!settings) {
    clearMultiUrlModelChannelRowsSection(elements);
  }
  setModelChannelGeneratorModeSection(elements, seed.mode);
  syncMultiUrlModelChannelRowsEmptyStateSection(elements);
  return {
    mode: seed.mode,
    rowCount: seed.multi.rows.length,
  };
}

export function applyGeneratedMultiUrlRoundRobinGroupSection(settings, generatedChannelIds, group) {
  const nextChannelIds = [...new Set(generatedChannelIds.map((channelId) => String(channelId || "").trim()).filter(Boolean))];
  if (!group?.enabled || nextChannelIds.length <= 1) {
    return {
      settings,
      groupId: "",
    };
  }

  const nextSettings = {
    ...settings,
    channels: Array.isArray(settings?.channels) ? [...settings.channels] : [],
    channelGroups: Array.isArray(settings?.channelGroups) ? [...settings.channelGroups] : [],
  };
  const takenIds = new Set([
    ...nextSettings.channels.map((channel) => String(channel?.id || "").trim()).filter(Boolean),
    ...nextSettings.channelGroups.map((item) => String(item?.id || "").trim()).filter(Boolean),
  ]);
  const identity = buildDefaultRoundRobinGroupIdentity(group.groupId, group.groupName, nextChannelIds);
  const groupId = reserveUniqueModelChannelSafeId(identity.id, takenIds);
  nextSettings.channelGroups.push({
    id: groupId,
    name: identity.name,
    strategy: "round-robin",
    channelIds: nextChannelIds,
  });
  return {
    settings: nextSettings,
    groupId,
  };
}
