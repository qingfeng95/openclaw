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
    !elements.modelChannelsTextarea ||
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
  if (!state.modelChannelEditorDirty && (!elements.modelChannelsTextarea.value || adminEnabled)) {
    elements.modelChannelsTextarea.value = state.modelChannelSettingsText || JSON.stringify(settings, null, 2);
  }

  const toggleTargets = [
    elements.userModelConfigCheckbox,
    elements.modelChannelsTextarea,
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
  setModelChannelGenerateRowsDisabled(!adminEnabled);

  const channelCount = state.modelChannelCatalog.channels.length;
  const userConfigLabel = state.modelChannelCatalog.userCanConfigureModels ? "允许" : "关闭";
  const draftStateLabel = state.modelChannelEditorDirty ? "有未保存变更" : "已与当前配置同步";

  if (!state.adminModeAvailable) {
    elements.modelChannelsPanel.innerHTML = `
      <div class="channel-status-summary">
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
      <div class="channel-status-summary">
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
          <div class="channel-status-value">先进入管理员模式，再选择单 URL 或多 URL 模式生成草稿。</div>
        </article>
      </div>
      <div class="channel-status-actions">
        <div class="callout">Enter admin mode to manage global model channels.</div>
      </div>
    `;
    return;
  }

  elements.modelChannelsPanel.innerHTML = `
    <div class="channel-status-summary">
      <article class="channel-status-card">
        <span class="channel-status-label">管理员模式</span>
        <div class="channel-status-value">已进入，可维护全局渠道</div>
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
        <span class="channel-status-label">草稿状态</span>
        <div class="channel-status-value">${draftStateLabel}</div>
      </article>
    </div>
    <div class="channel-status-actions">
      <div class="callout">左侧明确区分单 URL 与多 URL 两种模式，生成后右侧 JSON 会立即更新；确认无误后再保存全局渠道。</div>
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
    elements,
    state,
    renderAll,
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

      state.modelChannelSettings = nextSettings;
      state.modelChannelSettingsText = JSON.stringify(state.modelChannelSettings, null, 2);
      if (elements.modelChannelsTextarea) {
        elements.modelChannelsTextarea.value = state.modelChannelSettingsText;
      }
      state.modelChannelEditorDirty = true;
      renderAll();
      const detailParts = [];
      const uniqueChannelIds = [...new Set(generatedChannelIds.map((channelId) => String(channelId || "").trim()).filter(Boolean))];
      const uniqueGroupIds = [...new Set(generatedGroupIds.map((groupId) => String(groupId || "").trim()).filter(Boolean))];
      if (uniqueChannelIds.length > 0) {
        detailParts.push(`Channels: ${uniqueChannelIds.join(", ")}`);
      }
      if (uniqueGroupIds.length > 0) {
        detailParts.push(`Groups: ${uniqueGroupIds.join(", ")}`);
      }
      detailParts.push("Draft JSON updated. Save to persist.");
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
  } = params;

  elements.modelChannelsForm?.addEventListener("submit", (event) => {
    void handleModelChannelsSubmit(event);
  });
  elements.modelChannelGenerateModeSingleInput?.addEventListener("change", () => {
    if (elements.modelChannelGenerateModeSingleInput.checked) {
      setModelChannelGenerateMode("single");
    }
  });
  elements.modelChannelGenerateModeMultiInput?.addEventListener("change", () => {
    if (elements.modelChannelGenerateModeMultiInput.checked) {
      setModelChannelGenerateMode("multi");
    }
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
  elements.modelChannelsTextarea?.addEventListener("input", () => {
    state.modelChannelEditorDirty = true;
  });
  elements.userModelConfigCheckbox?.addEventListener("change", () => {
    state.modelChannelEditorDirty = true;
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
