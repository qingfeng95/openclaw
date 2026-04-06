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

function buildDefaultRoundRobinGroupIdentity(groupId, groupName, generatedChannelIds) {
  const preferredGroupId = String(groupId || "").trim();
  const firstGeneratedId = String(generatedChannelIds[0] || "").trim();
  const baseId =
    preferredGroupId ||
    `${stripTrailingOrdinal(firstGeneratedId) || sanitizeModelChannelSafeId(firstGeneratedId, "channel")}-rr`;
  const normalizedId = sanitizeModelChannelSafeId(baseId, "channel-rr");
  const groupTitleBase = stripTrailingRoundRobinSuffix(groupName) || stripTrailingRoundRobinSuffix(normalizedId) || "Channel";
  return {
    id: normalizedId,
    name: String(groupName || "").trim() || `${groupTitleBase} RR`,
  };
}

export function splitModelChannelGeneratorListSection(value) {
  return String(value || "")
    .split(/[\r\n,，；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
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
