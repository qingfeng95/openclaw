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
    ensureModelChannelGenerateCardsInitialized,
    setModelChannelGenerateCardsDisabled,
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
  ensureModelChannelGenerateCardsInitialized();
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
    elements.modelChannelGenerateBaseUrlInput,
    elements.modelChannelGenerateApiInput,
    elements.modelChannelGenerateIdPrefixInput,
    elements.modelChannelGenerateNamePrefixInput,
    elements.modelChannelGenerateApiKeysTextarea,
    elements.modelChannelGenerateModelsTextarea,
    elements.modelChannelGenerateBatchTextarea,
    elements.modelChannelGenerateReasoningCheckbox,
    elements.modelChannelGenerateImageInputCheckbox,
    elements.modelChannelGenerateRoundRobinCheckbox,
    elements.generateModelChannelsButton,
    elements.autoUnassignRemovedModelChannelsCheckbox,
    elements.reloadModelChannelsButton,
    elements.saveModelChannelsButton,
  ];
  for (const target of toggleTargets) {
    if (target) {
      target.disabled = !adminEnabled;
    }
  }
  setModelChannelGenerateCardsDisabled(!adminEnabled);

  if (!state.adminModeAvailable) {
    elements.modelChannelsPanel.textContent = "Server admin mode is not enabled.";
    return;
  }
  if (!adminEnabled) {
    elements.modelChannelsPanel.textContent = "Enter admin mode to manage global model channels.";
    return;
  }
  elements.modelChannelsPanel.textContent = `Channels: ${state.modelChannelCatalog.channels.length}. User model config: ${
    state.modelChannelCatalog.userCanConfigureModels ? "enabled" : "disabled"
  }. Saving updates global settings and may require instance restarts.`;
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
    collectBatchCardModelChannelGenerators,
    elements,
    parseBatchModelChannelGenerators,
    fetchJson,
    normalizeModelChannelSettingsForEditor,
    buildSingleModelChannelGeneratorPayload,
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
      const cardGenerators = collectBatchCardModelChannelGenerators();
      const batchRaw = elements.modelChannelGenerateBatchTextarea?.value?.trim() || "";
      let nextSettings = baseSettings;
      const generatedChannelIds = [];
      const generatedGroupIds = [];

      if (cardGenerators.length > 0 || batchRaw) {
        const generators = cardGenerators.length > 0 ? cardGenerators : parseBatchModelChannelGenerators(batchRaw);
        for (const generator of generators) {
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
      if (generatedChannelIds.length > 0) {
        detailParts.push(`Channels: ${generatedChannelIds.join(", ")}`);
      }
      if (generatedGroupIds.length > 0) {
        detailParts.push(`Groups: ${generatedGroupIds.join(", ")}`);
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
    appendModelChannelGenerateCard,
    buildModelChannelGenerateCardDefaultValues,
    readModelChannelGenerateCardField,
    ensureModelChannelGenerateCardsInitialized,
    renumberModelChannelGenerateCards,
    pushStatus,
    importBatchModelChannelGeneratorsAsCards,
    clearModelChannelGenerateCards,
    state,
    handleModelChannelGenerateSubmit,
    loadModelChannelConfig,
    renderAll,
    handleDetailModelChannelSubmit,
    updateSelectedInstanceModelChannel,
  } = params;

  elements.modelChannelsForm?.addEventListener("submit", (event) => {
    void handleModelChannelsSubmit(event);
  });
  elements.addModelChannelGenerateCardButton?.addEventListener("click", (event) => {
    event.preventDefault();
    const card = appendModelChannelGenerateCard(buildModelChannelGenerateCardDefaultValues());
    card?.querySelector('[data-field="channelNamePrefix"]')?.focus();
  });
  elements.modelChannelGenerateCards?.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) {
      return;
    }
    const card = actionButton.closest(".generator-card");
    if (!card) {
      return;
    }
    const action = actionButton.getAttribute("data-action");
    if (action === "remove-model-channel-generate-card") {
      card.remove();
      ensureModelChannelGenerateCardsInitialized();
      renumberModelChannelGenerateCards();
      return;
    }
    if (action === "duplicate-model-channel-generate-card") {
      const duplicate = appendModelChannelGenerateCard({
        channelNamePrefix: readModelChannelGenerateCardField(card, "channelNamePrefix"),
        channelIdPrefix: readModelChannelGenerateCardField(card, "channelIdPrefix"),
        baseUrl: readModelChannelGenerateCardField(card, "baseUrl"),
        api: readModelChannelGenerateCardField(card, "api"),
        modelIds: readModelChannelGenerateCardField(card, "modelIds"),
        apiKeys: readModelChannelGenerateCardField(card, "apiKeys"),
      });
      duplicate?.querySelector('[data-field="channelNamePrefix"]')?.focus();
    }
  });
  elements.modelChannelGenerateCards?.addEventListener("input", () => {
    renumberModelChannelGenerateCards();
  });
  elements.importModelChannelBatchButton?.addEventListener("click", () => {
    const raw = elements.modelChannelGenerateBatchTextarea?.value || "";
    if (!raw.trim()) {
      pushStatus("error", "Import failed", "Batch input is empty.");
      return;
    }
    try {
      const count = importBatchModelChannelGeneratorsAsCards(raw);
      pushStatus("success", "Imported batch definitions", `Added ${count} cards.`);
    } catch (error) {
      pushStatus("error", "Import failed", error.message);
    }
  });
  elements.clearModelChannelCardsButton?.addEventListener("click", () => {
    clearModelChannelGenerateCards({ keepOneBlank: true });
    pushStatus("info", "Cleared cards", "Kept one blank card.");
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
