export function splitModelChannelGeneratorListSection(value) {
  return String(value || "")
    .split(/[\r\n,，；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildModelChannelGeneratorSharedOptionsSection(elements) {
  return {
    api: elements.modelChannelGenerateApiInput?.value?.trim() || "openai-responses",
    reasoning: Boolean(elements.modelChannelGenerateReasoningCheckbox?.checked),
    allowImageInput: Boolean(elements.modelChannelGenerateImageInputCheckbox?.checked),
    createRoundRobinGroup: Boolean(elements.modelChannelGenerateRoundRobinCheckbox?.checked),
  };
}

export function buildSingleModelChannelGeneratorPayloadSection(baseSettings, elements) {
  const sharedOptions = buildModelChannelGeneratorSharedOptionsSection(elements);
  return {
    settings: baseSettings,
    generator: {
      baseUrl: elements.modelChannelGenerateBaseUrlInput?.value?.trim() || "",
      api: sharedOptions.api,
      channelIdPrefix: elements.modelChannelGenerateIdPrefixInput?.value?.trim() || "",
      channelNamePrefix: elements.modelChannelGenerateNamePrefixInput?.value?.trim() || "",
      apiKeys: elements.modelChannelGenerateApiKeysTextarea?.value ?? "",
      modelIds: elements.modelChannelGenerateModelsTextarea?.value ?? "",
      reasoning: sharedOptions.reasoning,
      allowImageInput: sharedOptions.allowImageInput,
      createRoundRobinGroup: sharedOptions.createRoundRobinGroup,
    },
  };
}

export function getModelChannelGenerateCardsSection(elements) {
  return Array.from(elements.modelChannelGenerateCards?.querySelectorAll(".generator-card") ?? []);
}

export function readModelChannelGenerateCardFieldSection(card, field) {
  return card.querySelector(`[data-field="${field}"]`)?.value?.trim() || "";
}

export function renumberModelChannelGenerateCardsSection(elements) {
  getModelChannelGenerateCardsSection(elements).forEach((card, index) => {
    const title = card.querySelector("[data-model-channel-generate-card-title]");
    if (!title) {
      return;
    }
    const name = readModelChannelGenerateCardFieldSection(card, "channelNamePrefix");
    const id = readModelChannelGenerateCardFieldSection(card, "channelIdPrefix");
    const summary = name || id;
    title.textContent = summary ? `配置 ${index + 1} / ${summary}` : `配置 ${index + 1}`;
  });
}

export function buildModelChannelGenerateCardDefaultValuesSection(elements) {
  return {
    channelNamePrefix: elements.modelChannelGenerateNamePrefixInput?.value?.trim() || "",
    channelIdPrefix: elements.modelChannelGenerateIdPrefixInput?.value?.trim() || "",
    baseUrl: elements.modelChannelGenerateBaseUrlInput?.value?.trim() || "",
    api: elements.modelChannelGenerateApiInput?.value?.trim() || "",
    apiKeys: elements.modelChannelGenerateApiKeysTextarea?.value?.trim() || "",
    modelIds: elements.modelChannelGenerateModelsTextarea?.value?.trim() || "",
  };
}

export function createModelChannelGenerateCardSection(documentRef, escapeHtml, values = {}) {
  const channelNamePrefix = String(values.channelNamePrefix || "").trim();
  const channelIdPrefix = String(values.channelIdPrefix || "").trim();
  const baseUrl = String(values.baseUrl || "").trim();
  const api = String(values.api || "").trim();
  const modelIds = String(values.modelIds || "").trim();
  const apiKeys = String(values.apiKeys || "").trim();
  const card = documentRef.createElement("section");
  card.className = "generator-card";
  card.innerHTML = `
    <div class="generator-card-header">
      <p class="generator-card-title" data-model-channel-generate-card-title>配置</p>
      <div class="inline-actions">
        <button class="button" type="button" data-action="duplicate-model-channel-generate-card">复制卡片</button>
        <button class="button" type="button" data-action="remove-model-channel-generate-card">删除此卡片</button>
      </div>
    </div>
    <div class="generator-card-grid">
      <label class="field">
        <span>渠道名称前缀</span>
        <input data-field="channelNamePrefix" type="text" spellcheck="false" placeholder="OpenAI Main" value="${escapeHtml(channelNamePrefix)}" />
      </label>
      <label class="field">
        <span>渠道 ID 前缀</span>
        <input data-field="channelIdPrefix" type="text" spellcheck="false" placeholder="openai-main" value="${escapeHtml(channelIdPrefix)}" />
      </label>
      <label class="field">
        <span>渠道 URL</span>
        <input data-field="baseUrl" type="text" spellcheck="false" placeholder="https://api.openai.com/v1" value="${escapeHtml(baseUrl)}" />
      </label>
      <label class="field">
        <span>API 类型</span>
        <input data-field="api" type="text" spellcheck="false" placeholder="留空则沿用上方 API 类型" value="${escapeHtml(api)}" />
      </label>
      <label class="field field-span-2">
        <span>模型 ID</span>
        <textarea data-field="modelIds" rows="3" spellcheck="false" placeholder="gpt-5-mini">${escapeHtml(modelIds)}</textarea>
      </label>
      <label class="field field-span-2">
        <span>API Key</span>
        <textarea data-field="apiKeys" rows="3" spellcheck="false" placeholder="sk-xxx">${escapeHtml(apiKeys)}</textarea>
      </label>
    </div>
  `;
  return card;
}

export function appendModelChannelGenerateCardSection(elements, documentRef, escapeHtml, values = {}) {
  if (!elements.modelChannelGenerateCards) {
    return null;
  }
  const card = createModelChannelGenerateCardSection(documentRef, escapeHtml, values);
  elements.modelChannelGenerateCards.appendChild(card);
  renumberModelChannelGenerateCardsSection(elements);
  return card;
}

export function clearModelChannelGenerateCardsSection(elements, documentRef, escapeHtml, { keepOneBlank = true } = {}) {
  if (!elements.modelChannelGenerateCards) {
    return;
  }
  elements.modelChannelGenerateCards.innerHTML = "";
  if (keepOneBlank) {
    appendModelChannelGenerateCardSection(elements, documentRef, escapeHtml);
  }
}

export function ensureModelChannelGenerateCardsInitializedSection(elements, documentRef, escapeHtml) {
  if (!elements.modelChannelGenerateCards) {
    return;
  }
  if (getModelChannelGenerateCardsSection(elements).length === 0) {
    appendModelChannelGenerateCardSection(elements, documentRef, escapeHtml);
  }
}

export function collectBatchCardModelChannelGeneratorsSection(elements) {
  const sharedOptions = buildModelChannelGeneratorSharedOptionsSection(elements);
  const generators = [];
  const cards = getModelChannelGenerateCardsSection(elements);
  for (const [index, card] of cards.entries()) {
    const channelNamePrefix = readModelChannelGenerateCardFieldSection(card, "channelNamePrefix");
    const channelIdPrefix = readModelChannelGenerateCardFieldSection(card, "channelIdPrefix");
    const baseUrl = readModelChannelGenerateCardFieldSection(card, "baseUrl");
    const api = readModelChannelGenerateCardFieldSection(card, "api");
    const modelIdsRaw = readModelChannelGenerateCardFieldSection(card, "modelIds");
    const apiKeysRaw = readModelChannelGenerateCardFieldSection(card, "apiKeys");
    const hasContent = [channelNamePrefix, channelIdPrefix, baseUrl, modelIdsRaw, apiKeysRaw].some(Boolean);
    if (!hasContent) {
      continue;
    }
    if (!channelNamePrefix || !channelIdPrefix || !baseUrl || !modelIdsRaw || !apiKeysRaw) {
      throw new Error(`Card ${index + 1} is missing required fields.`);
    }
    const modelIds = splitModelChannelGeneratorListSection(modelIdsRaw);
    const apiKeys = splitModelChannelGeneratorListSection(apiKeysRaw);
    if (modelIds.length === 0) {
      throw new Error(`Card ${index + 1} needs at least one model ID.`);
    }
    if (apiKeys.length === 0) {
      throw new Error(`Card ${index + 1} needs at least one API key.`);
    }
    generators.push({
      baseUrl,
      api: api || sharedOptions.api,
      channelIdPrefix,
      channelNamePrefix,
      modelIds,
      apiKeys,
      reasoning: sharedOptions.reasoning,
      allowImageInput: sharedOptions.allowImageInput,
      createRoundRobinGroup: sharedOptions.createRoundRobinGroup,
    });
  }
  return generators;
}

export function setModelChannelGenerateCardsDisabledSection(elements, disabled) {
  if (elements.addModelChannelGenerateCardButton) {
    elements.addModelChannelGenerateCardButton.disabled = disabled;
  }
  if (elements.importModelChannelBatchButton) {
    elements.importModelChannelBatchButton.disabled = disabled;
  }
  if (elements.clearModelChannelCardsButton) {
    elements.clearModelChannelCardsButton.disabled = disabled;
  }
  const controls = elements.modelChannelGenerateCards?.querySelectorAll("input, textarea, button") ?? [];
  for (const control of controls) {
    control.disabled = disabled;
  }
}

export function parseBatchModelChannelGeneratorsSection(raw, elements) {
  const sharedOptions = buildModelChannelGeneratorSharedOptionsSection(elements);
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (lines.length === 0) {
    return [];
  }
  return lines.map((line, index) => {
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
    if (apiKeys.length === 0) {
      throw new Error(`Batch line ${index + 1} needs at least one API key.`);
    }
    return {
      baseUrl,
      api: apiRaw || sharedOptions.api,
      channelIdPrefix,
      channelNamePrefix,
      modelIds,
      apiKeys,
      reasoning: sharedOptions.reasoning,
      allowImageInput: sharedOptions.allowImageInput,
      createRoundRobinGroup: sharedOptions.createRoundRobinGroup,
    };
  });
}

export function importBatchModelChannelGeneratorsAsCardsSection(elements, documentRef, escapeHtml, raw) {
  const generators = parseBatchModelChannelGeneratorsSection(raw, elements);
  if (generators.length === 0) {
    return 0;
  }
  const cards = getModelChannelGenerateCardsSection(elements);
  const onlyBlankCard =
    cards.length === 1 &&
    ["channelNamePrefix", "channelIdPrefix", "baseUrl", "api", "modelIds", "apiKeys"].every(
      (field) => !readModelChannelGenerateCardFieldSection(cards[0], field),
    );
  if (onlyBlankCard) {
    clearModelChannelGenerateCardsSection(elements, documentRef, escapeHtml, { keepOneBlank: false });
  }
  for (const item of generators) {
    appendModelChannelGenerateCardSection(elements, documentRef, escapeHtml, {
      channelNamePrefix: item.channelNamePrefix,
      channelIdPrefix: item.channelIdPrefix,
      baseUrl: item.baseUrl,
      api: item.api,
      modelIds: Array.isArray(item.modelIds) ? item.modelIds.join("\n") : "",
      apiKeys: Array.isArray(item.apiKeys) ? item.apiKeys.join("\n") : "",
    });
  }
  return generators.length;
}
