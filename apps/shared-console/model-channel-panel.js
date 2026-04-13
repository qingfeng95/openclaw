export function loadModelChannelConfigSection(params) {
  const {
    state,
    announce = false,
    fetchJson,
    isAdminModeEnabled,
    ensureModelChannelCatalogShape,
    normalizeModelChannelSettingsForEditor,
    pushStatus,
  } = params;

  return (async () => {
    const payload = await fetchJson("/api/model-channels", {
      adminAuth: isAdminModeEnabled(),
    });
    state.modelChannelCatalog = ensureModelChannelCatalogShape(payload?.catalog);
    if (payload?.admin && payload?.settings) {
      state.modelChannelSettings = normalizeModelChannelSettingsForEditor(payload.settings);
      state.modelChannelSettingsText = JSON.stringify(state.modelChannelSettings, null, 2);
      state.modelChannelEditorDirty = false;
    } else if (!isAdminModeEnabled()) {
      state.modelChannelSettings = null;
      state.modelChannelSettingsText = "";
      state.modelChannelEditorDirty = false;
    }
    if (announce) {
      pushStatus(
        "info",
        "Reloaded model channels",
        `${state.modelChannelCatalog.channels.length} channels / user config ${
          state.modelChannelCatalog.userCanConfigureModels ? "enabled" : "disabled"
        }`,
      );
    }
    return payload;
  })();
}

export async function updateSelectedInstanceModelChannelSection(params) {
  const {
    state,
    modelChannelId,
    isAdminModeEnabled,
    pushStatus,
    setBusy,
    fetchJson,
    instanceApiBase,
    formatModelChannelLabel,
    loadInstances,
    updateConnectionNote,
  } = params;

  if (!state.selectedId) {
    return;
  }
  if (!isAdminModeEnabled()) {
    pushStatus("error", "Save failed", "Admin mode is required.");
    return;
  }
  setBusy(true);
  try {
    await fetchJson(`${instanceApiBase(state.selectedScope)}/${encodeURIComponent(state.selectedId)}`, {
      method: "PATCH",
      body: JSON.stringify({ modelChannelId }),
    });
    pushStatus(
      "success",
      "Updated instance model channel",
      `${state.selectedId} -> ${formatModelChannelLabel(modelChannelId || "")}`,
    );
    await loadInstances({ preserveSelection: true });
  } catch (error) {
    pushStatus("error", "Failed to update instance model channel", error.message);
    updateConnectionNote(`Save failed: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

export function updateGenerateButtonTextSection(elements) {
  const generateButton = elements.generateModelChannelsButton;
  const buttonText = document.querySelector("#generate-model-channels-button-text");
  const buttonHint = document.querySelector("#generate-model-channels-button-hint");

  if (!generateButton || !buttonText) {
    return;
  }

  const mode = elements.modelChannelGenerateModeSingleInput?.checked ? "single" : "multi";
  const hasRoundRobin = elements.modelChannelGenerateRoundRobinCheckbox?.checked ?? false;

  if (mode === "single") {
    if (hasRoundRobin) {
      buttonText.textContent = "生成渠道 + 轮询组";
      if (buttonHint) {
        buttonHint.textContent = "将生成多个渠道并自动创建轮询组";
      }
    } else {
      buttonText.textContent = "生成渠道到草稿";
      if (buttonHint) {
        buttonHint.textContent = "将生成渠道添加到上方草稿卡片";
      }
    }
  } else {
    buttonText.textContent = "生成多 URL 轮询组";
    if (buttonHint) {
      buttonHint.textContent = "将生成所有 URL 的渠道并创建统一轮询组";
    }
  }
}

export function renderModelChannelsPanelSection(params) {
  const {
    state,
    elements,
    isAdminModeEnabled,
    defaultModelChannelSettings,
    setModelChannelGenerateRowsDisabled,
  } = params;

  if (
    !elements.modelChannelsPanel ||
    !elements.userModelConfigCheckbox ||
    !elements.reloadModelChannelsButton ||
    !elements.saveModelChannelsButton
  ) {
    return;
  }

  const adminEnabled = isAdminModeEnabled();
  const settings = state.modelChannelSettings || defaultModelChannelSettings();
  if (!state.modelChannelEditorDirty) {
    elements.userModelConfigCheckbox.checked = Boolean(
      state.modelChannelSettings?.userCanConfigureModels ?? state.modelChannelCatalog.userCanConfigureModels,
    );
  }

  const toggleTargets = [
    elements.userModelConfigCheckbox,
    elements.modelChannelGenerateModeSingleInput,
    elements.modelChannelGenerateModeMultiInput,
    elements.modelChannelSingleBaseUrlInput,
    elements.modelChannelSingleApiInput,
    elements.modelChannelSingleIdPrefixInput,
    elements.modelChannelSingleNamePrefixInput,
    elements.modelChannelSingleApiKeysTextarea,
    elements.modelChannelSingleModelsTextarea,
    elements.modelChannelMultiModelsTextarea,
    elements.modelChannelMultiGroupIdInput,
    elements.modelChannelMultiGroupNameInput,
    elements.modelChannelGenerateBatchTextarea,
    elements.modelChannelGenerateReasoningCheckbox,
    elements.modelChannelGenerateImageInputCheckbox,
    elements.modelChannelGenerateRoundRobinCheckbox,
    elements.addModelChannelMultiRowButton,
    elements.importModelChannelBatchButton,
    elements.clearModelChannelMultiRowsButton,
    elements.generateModelChannelsButton,
    elements.addModelChannelDraftChannelButton,
    elements.addModelChannelDraftGroupButton,
    elements.copyModelChannelsExportButton,
    elements.modelChannelsImportTextarea,
    elements.importModelChannelsButton,
    elements.autoUnassignRemovedModelChannelsCheckbox,
    elements.saveModelChannelsButton,
  ];
  for (const target of toggleTargets) {
    if (target) {
      target.disabled = !adminEnabled;
    }
  }
  if (elements.reloadModelChannelsButton) {
    elements.reloadModelChannelsButton.disabled = !state.adminModeAvailable;
  }
  if (elements.modelChannelsExportTextarea) {
    elements.modelChannelsExportTextarea.disabled = true;
  }
  setModelChannelGenerateRowsDisabled(!adminEnabled);

  const channelCount = state.modelChannelCatalog.channels.length;
  const draftChannelCount = Array.isArray(settings.channels) ? settings.channels.length : 0;
  const draftGroupCount = Array.isArray(settings.channelGroups) ? settings.channelGroups.length : 0;
  const userConfigLabel = state.modelChannelCatalog.userCanConfigureModels ? "允许" : "关闭";
  const draftStateLabel = state.modelChannelEditorDirty ? "有未保存变更" : "已与当前配置同步";

  const panelToneClass = adminEnabled ? " channel-status-panel-live" : " channel-status-panel-locked";

  if (!state.adminModeAvailable) {
    elements.modelChannelsPanel.innerHTML = `
      <div class="channel-status-summary${panelToneClass}">
        <article class="channel-status-card">
          <span class="channel-status-label">管理员模式</span>
          <div class="channel-status-value">服务端未启用</div>
        </article>
        <article class="channel-status-card">
          <span class="channel-status-label">当前渠道数</span>
          <div class="channel-status-value">${channelCount}</div>
        </article>
        <article class="channel-status-card">
          <span class="channel-status-label">用户自定义模型</span>
          <div class="channel-status-value">${userConfigLabel}</div>
        </article>
        <article class="channel-status-card">
          <span class="channel-status-label">当前状态</span>
          <div class="channel-status-value">只能查看，不能维护全局渠道。</div>
        </article>
      </div>
      <div class="channel-status-actions">
        <div class="callout">Server admin mode is not enabled.</div>
      </div>
    `;
    return;
  }

  if (!adminEnabled) {
    elements.modelChannelsPanel.innerHTML = `
      <div class="channel-status-summary${panelToneClass}">
        <article class="channel-status-card">
          <span class="channel-status-label">管理员模式</span>
          <div class="channel-status-value">未进入</div>
        </article>
        <article class="channel-status-card">
          <span class="channel-status-label">当前渠道数</span>
          <div class="channel-status-value">${channelCount}</div>
        </article>
        <article class="channel-status-card">
          <span class="channel-status-label">用户自定义模型</span>
          <div class="channel-status-value">${userConfigLabel}</div>
        </article>
        <article class="channel-status-card">
          <span class="channel-status-label">下一步</span>
          <div class="channel-status-value">先进入管理员模式，再维护草稿卡片；需要批量起草时可展开快速生成辅助器。</div>
        </article>
      </div>
      <div class="channel-status-actions">
        <div class="callout">Enter admin mode to manage global model channels.</div>
      </div>
    `;
    return;
  }

  elements.modelChannelsPanel.innerHTML = `
    <div class="channel-status-summary${panelToneClass}">
      <article class="channel-status-card">
        <span class="channel-status-label">管理员模式</span>
        <div class="channel-status-value">已进入，可维护全局渠道</div>
      </article>
      <article class="channel-status-card">
        <span class="channel-status-label">当前渠道数</span>
        <div class="channel-status-value">${channelCount}</div>
      </article>
      <article class="channel-status-card">
        <span class="channel-status-label">草稿内容</span>
        <div class="channel-status-value">${draftChannelCount} 个渠道 / ${draftGroupCount} 个轮询组</div>
      </article>
      <article class="channel-status-card">
        <span class="channel-status-label">草稿状态</span>
        <div class="channel-status-value">${draftStateLabel}</div>
      </article>
    </div>
    <div class="channel-status-actions">
      <div class="callout">卡片是唯一主编辑区；快速生成辅助器只负责批量补草稿，高级 JSON 只保留导入 / 导出。</div>
    </div>
  `;
}

export function handleModelChannelsSubmitSection(params) {
  const {
    event,
    isAdminModeEnabled,
    pushStatus,
    setBusy,
    buildModelChannelSettingsDraft,
    fetchJson,
    elements,
    state,
    ensureModelChannelCatalogShape,
    normalizeModelChannelSettingsForEditor,
    renderAll,
    formatModelChannelSaveDetail,
    loadInstances,
    updateConnectionNote,
  } = params;

  return (async () => {
    event.preventDefault();
    if (!isAdminModeEnabled()) {
      pushStatus("error", "Save failed", "Admin mode is required.");
      return;
    }
    setBusy(true);
    try {
      const settings = buildModelChannelSettingsDraft();
      const payload = await fetchJson("/api/model-channels", {
        method: "PUT",
        adminAuth: true,
        body: JSON.stringify({
          settings,
          autoUnassignRemovedChannels: Boolean(elements.autoUnassignRemovedModelChannelsCheckbox?.checked),
        }),
      });
      state.modelChannelCatalog = ensureModelChannelCatalogShape(payload?.catalog);
      state.modelChannelSettings = normalizeModelChannelSettingsForEditor(payload?.settings ?? settings);
      state.modelChannelSettingsText = JSON.stringify(state.modelChannelSettings, null, 2);
      state.modelChannelEditorDirty = false;
      state.modelChannelEditorSyncSourceKey = JSON.stringify(state.modelChannelSettings);
      renderAll();
      pushStatus("success", "Saved global model channels", formatModelChannelSaveDetail(payload));
      await loadInstances({ preserveSelection: true });
    } catch (error) {
      const detail = String(error?.message || "");
      const hint = detail.includes("Cannot remove channels that are still assigned to instances")
        ? `${detail} Enable auto-unassign or manually clear instance mappings first.`
        : detail;
      pushStatus("error", "Failed to save global model channels", hint);
      updateConnectionNote(`Save failed: ${error.message}`, true);
    } finally {
      setBusy(false);
    }
  })();
}

export function handleModelChannelGenerateSubmitSection(params) {
  const {
    isAdminModeEnabled,
    pushStatus,
    setBusy,
    buildModelChannelGeneratorBaseSettings,
    getModelChannelGeneratorMode,
    buildMultiUrlModelChannelGenerationPlan,
    fetchJson,
    normalizeModelChannelSettingsForEditor,
    buildSingleModelChannelGeneratorPayload,
    applyGeneratedMultiUrlRoundRobinGroup,
    replaceModelChannelDraft,
    updateConnectionNote,
  } = params;

  return (async () => {
    if (!isAdminModeEnabled()) {
      pushStatus("error", "Generate failed", "Admin mode is required.");
      return;
    }
    setBusy(true);
    try {
      const baseSettings = buildModelChannelGeneratorBaseSettings();
      const mode = getModelChannelGeneratorMode();
      let nextSettings = baseSettings;
      const generatedChannelIds = [];
      const generatedGroupIds = [];

      if (mode === "multi") {
        const plan = buildMultiUrlModelChannelGenerationPlan();
        for (const generator of plan.generators) {
          const response = await fetchJson("/api/model-channels/generate", {
            method: "POST",
            adminAuth: true,
            body: JSON.stringify({
              settings: nextSettings,
              generator,
            }),
          });
          nextSettings = normalizeModelChannelSettingsForEditor(response?.settings ?? nextSettings);
          const channelIds = Array.isArray(response?.meta?.generatedChannelIds) ? response.meta.generatedChannelIds : [];
          const groupId = String(response?.meta?.generatedGroupId || "").trim();
          generatedChannelIds.push(...channelIds);
          if (groupId) {
            generatedGroupIds.push(groupId);
          }
        }
        const groupResult = applyGeneratedMultiUrlRoundRobinGroup(nextSettings, generatedChannelIds, plan.group);
        nextSettings = normalizeModelChannelSettingsForEditor(groupResult.settings ?? nextSettings);
        if (groupResult.groupId) {
          generatedGroupIds.push(groupResult.groupId);
        }
      } else {
        const payload = buildSingleModelChannelGeneratorPayload(baseSettings);
        const response = await fetchJson("/api/model-channels/generate", {
          method: "POST",
          adminAuth: true,
          body: JSON.stringify(payload),
        });
        nextSettings = normalizeModelChannelSettingsForEditor(response?.settings ?? payload.settings);
        const channelIds = Array.isArray(response?.meta?.generatedChannelIds) ? response.meta.generatedChannelIds : [];
        const groupId = String(response?.meta?.generatedGroupId || "").trim();
        generatedChannelIds.push(...channelIds);
        if (groupId) {
          generatedGroupIds.push(groupId);
        }
      }

      replaceModelChannelDraft(nextSettings, { dirty: true });
      const detailParts = [];
      const uniqueChannelIds = [...new Set(generatedChannelIds.map((channelId) => String(channelId || "").trim()).filter(Boolean))];
      const uniqueGroupIds = [...new Set(generatedGroupIds.map((groupId) => String(groupId || "").trim()).filter(Boolean))];
      if (uniqueChannelIds.length > 0) {
        detailParts.push(`Channels: ${uniqueChannelIds.join(", ")}`);
      }
      if (uniqueGroupIds.length > 0) {
        detailParts.push(`Groups: ${uniqueGroupIds.join(", ")}`);
      }
      detailParts.push("草稿已更新，可直接保存。");
      pushStatus("success", "Generated model channel draft", detailParts.join(" "));
    } catch (error) {
      pushStatus("error", "Failed to generate model channels", error.message);
      updateConnectionNote(`Generate failed: ${error.message}`, true);
    } finally {
      setBusy(false);
    }
  })();
}

export function handleDetailModelChannelSubmitSection({ event, elements, updateSelectedInstanceModelChannel }) {
  return (async () => {
    event.preventDefault();
    const modelChannelId = elements.detailModelChannelSelect?.value?.trim() || null;
    await updateSelectedInstanceModelChannel(modelChannelId);
  })();
}

export function bindModelChannelEventsSection(params) {
  const {
    elements,
    handleModelChannelsSubmit,
    appendMultiUrlModelChannelRow,
    readMultiUrlModelChannelRowField,
    renumberMultiUrlModelChannelRows,
    pushStatus,
    importBatchModelChannelGeneratorsAsRows,
    clearMultiUrlModelChannelRows,
    setModelChannelGenerateMode,
    state,
    handleModelChannelGenerateSubmit,
    loadModelChannelConfig,
    renderAll,
    handleDetailModelChannelSubmit,
    updateSelectedInstanceModelChannel,
    isAdminModeEnabled,
    handleModelChannelUserConfigChange,
    addModelChannelDraftChannel,
    addModelChannelDraftGroup,
    removeModelChannelDraftChannel,
    removeModelChannelDraftGroup,
    updateModelChannelDraftChannelField,
    updateModelChannelDraftModels,
    updateModelChannelDraftGroupField,
    toggleModelChannelDraftGroupChannel,
    copyModelChannelDraftExport,
    importModelChannelDraft,
  } = params;

  elements.modelChannelsForm?.addEventListener("submit", (event) => {
    void handleModelChannelsSubmit(event);
  });
  elements.modelChannelGenerateModeSingleInput?.addEventListener("change", () => {
    if (elements.modelChannelGenerateModeSingleInput.checked) {
      setModelChannelGenerateMode("single");
      updateGenerateButtonTextSection(elements);
    }
  });
  elements.modelChannelGenerateModeMultiInput?.addEventListener("change", () => {
    if (elements.modelChannelGenerateModeMultiInput.checked) {
      setModelChannelGenerateMode("multi");
      updateGenerateButtonTextSection(elements);
    }
  });
  elements.modelChannelGenerateRoundRobinCheckbox?.addEventListener("change", () => {
    updateGenerateButtonTextSection(elements);
  });
  elements.addModelChannelMultiRowButton?.addEventListener("click", (event) => {
    event.preventDefault();
    const row = appendMultiUrlModelChannelRow();
    row?.querySelector('[data-field="channelNamePrefix"]')?.focus();
  });
  elements.modelChannelMultiRows?.addEventListener("click", (event) => {
    const target = event.target;
    if (!target || typeof target !== "object" || !("closest" in target)) {
      return;
    }
    const actionButton = target.closest("[data-action]");
    if (!actionButton) {
      return;
    }
    const row = actionButton.closest(".channel-multi-row");
    if (!row) {
      return;
    }
    const action = actionButton.getAttribute("data-action");
    if (action === "remove-model-channel-multi-row") {
      row.remove();
      renumberMultiUrlModelChannelRows();
      return;
    }
    if (action === "duplicate-model-channel-multi-row") {
      const duplicate = appendMultiUrlModelChannelRow({
        channelNamePrefix: readMultiUrlModelChannelRowField(row, "channelNamePrefix"),
        channelIdPrefix: readMultiUrlModelChannelRowField(row, "channelIdPrefix"),
        baseUrl: readMultiUrlModelChannelRowField(row, "baseUrl"),
        api: readMultiUrlModelChannelRowField(row, "api"),
        apiKey: readMultiUrlModelChannelRowField(row, "apiKey"),
      });
      duplicate?.querySelector('[data-field="channelNamePrefix"]')?.focus();
    }
  });
  elements.modelChannelMultiRows?.addEventListener("input", () => {
    renumberMultiUrlModelChannelRows();
  });
  elements.importModelChannelBatchButton?.addEventListener("click", () => {
    const raw = elements.modelChannelGenerateBatchTextarea?.value || "";
    if (!raw.trim()) {
      pushStatus("error", "Import failed", "Batch input is empty.");
      return;
    }
    try {
      const count = importBatchModelChannelGeneratorsAsRows(raw);
      pushStatus("success", "Imported batch definitions", `Added ${count} rows.`);
    } catch (error) {
      pushStatus("error", "Import failed", error.message);
    }
  });
  elements.clearModelChannelMultiRowsButton?.addEventListener("click", () => {
    clearMultiUrlModelChannelRows();
    pushStatus("info", "Cleared multi URL rows", "Multi URL mode is now empty.");
  });
  elements.userModelConfigCheckbox?.addEventListener("change", () => {
    handleModelChannelUserConfigChange();
  });
  elements.generateModelChannelsButton?.addEventListener("click", () => {
    void handleModelChannelGenerateSubmit();
  });
  elements.reloadModelChannelsButton?.addEventListener("click", () => {
    if (!isAdminModeEnabled()) {
      pushStatus("error", "Reload failed", "请先进入管理员模式。", "channels");
      return;
    }
    void loadModelChannelConfig({ announce: true })
      .then(() => renderAll())
      .catch((error) => {
        pushStatus("error", "Reload failed", error.message);
      });
  });
  elements.addModelChannelDraftChannelButton?.addEventListener("click", () => {
    addModelChannelDraftChannel();
  });
  elements.addModelChannelDraftGroupButton?.addEventListener("click", () => {
    addModelChannelDraftGroup();
  });
  elements.copyModelChannelsExportButton?.addEventListener("click", () => {
    void copyModelChannelDraftExport();
  });
  elements.importModelChannelsButton?.addEventListener("click", () => {
    importModelChannelDraft();
  });
  const handleDraftClick = (event) => {
    const target = event.target;
    if (!target || typeof target !== "object" || !("closest" in target)) {
      return;
    }
    const actionButton = target.closest("[data-action]");
    if (!actionButton) {
      return;
    }
    const action = actionButton.getAttribute("data-action");
    if (action === "remove-model-channel-draft-channel") {
      removeModelChannelDraftChannel(Number(actionButton.getAttribute("data-channel-index") || "-1"));
      return;
    }
    if (action === "remove-model-channel-draft-group") {
      removeModelChannelDraftGroup(Number(actionButton.getAttribute("data-group-index") || "-1"));
    }
  };
  elements.modelChannelDraftChannels?.addEventListener("click", handleDraftClick);
  elements.modelChannelDraftGroups?.addEventListener("click", handleDraftClick);
  elements.modelChannelDraftChannels?.addEventListener("input", (event) => {
    const target = event.target;
    if (!target || typeof target !== "object" || !("getAttribute" in target)) {
      return;
    }
    const channelIndex = Number(target.getAttribute("data-channel-index") || "-1");
    const field = target.getAttribute("data-field") || "";
    if (channelIndex < 0 || !field) {
      return;
    }
    if (field === "models") {
      updateModelChannelDraftModels(channelIndex, target.value);
      return;
    }
    updateModelChannelDraftChannelField(channelIndex, field, target.value);
  });
  elements.modelChannelDraftGroups?.addEventListener("input", (event) => {
    const target = event.target;
    if (!target || typeof target !== "object" || !("getAttribute" in target)) {
      return;
    }
    const groupIndex = Number(target.getAttribute("data-group-index") || "-1");
    const field = target.getAttribute("data-field") || "";
    if (groupIndex < 0 || !field) {
      return;
    }
    updateModelChannelDraftGroupField(groupIndex, field, target.value);
  });
  elements.modelChannelDraftGroups?.addEventListener("change", (event) => {
    const target = event.target;
    if (!target || typeof target !== "object" || !("getAttribute" in target)) {
      return;
    }
    const action = target.getAttribute("data-action") || "";
    if (action !== "toggle-model-channel-draft-group-member") {
      return;
    }
    toggleModelChannelDraftGroupChannel(
      Number(target.getAttribute("data-group-index") || "-1"),
      target.getAttribute("data-channel-id") || "",
      Boolean(target.checked),
    );
  });
  elements.detailModelChannelForm?.addEventListener("submit", (event) => {
    void handleDetailModelChannelSubmit(event);
  });
  elements.clearDetailModelChannelButton?.addEventListener("click", () => {
    if (elements.detailModelChannelSelect) {
      elements.detailModelChannelSelect.value = "";
    }
    void updateSelectedInstanceModelChannel(null);
  });
}
