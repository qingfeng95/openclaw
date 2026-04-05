function applyModelChannelPayload(state, modelChannelsPayload, isAdminModeEnabled, ensureModelChannelCatalogShape, normalizeModelChannelSettingsForEditor) {
  if (!modelChannelsPayload?.catalog) {
    return;
  }
  state.modelChannelCatalog = ensureModelChannelCatalogShape(modelChannelsPayload.catalog);
  if (modelChannelsPayload?.admin && modelChannelsPayload?.settings) {
    state.modelChannelSettings = normalizeModelChannelSettingsForEditor(modelChannelsPayload.settings);
    state.modelChannelSettingsText = JSON.stringify(state.modelChannelSettings, null, 2);
    return;
  }
  if (!isAdminModeEnabled()) {
    state.modelChannelSettings = null;
    state.modelChannelSettingsText = "";
  }
}

function restoreSelectedInstance(state, preserveSelection) {
  if (preserveSelection && state.selectedId) {
    const activeList = state.selectedScope === "dedicated" ? state.dedicatedInstances : state.sharedInstances;
    const selected = activeList.find((item) => item.id === state.selectedId);
    state.selectedItem = selected ?? null;
    if (selected) {
      return;
    }
  }

  if (state.sharedInstances[0]) {
    state.selectedScope = "shared";
    state.selectedId = state.sharedInstances[0].id;
    return;
  }
  if (state.dedicatedInstances[0]) {
    state.selectedScope = "dedicated";
    state.selectedId = state.dedicatedInstances[0].id;
    return;
  }
  state.selectedId = null;
}

export async function loadInstancesSection(params) {
  const {
    state,
    preserveSelection = true,
    setBusy,
    fetchJson,
    isAdminModeEnabled,
    buildFallbackContainerMeta,
    ensureModelChannelCatalogShape,
    normalizeModelChannelSettingsForEditor,
    loadInstanceDetail,
    configurePairingAutoRefresh,
    updateConnectionNote,
    formatDateTime,
    renderAll,
    pushStatus,
  } = params;

  setBusy(true);
  try {
    const [payload, dedicatedPayload, containersPayload, modelChannelsPayload] = await Promise.all([
      fetchJson("/api/instances"),
      fetchJson("/api/dedicated-instances"),
      fetchJson("/api/containers").catch((error) => ({
        ok: false,
        items: [],
        meta: null,
        error,
      })),
      fetchJson("/api/model-channels", {
        adminAuth: isAdminModeEnabled(),
      }).catch(() => null),
    ]);

    state.sharedInstances = payload.items ?? [];
    state.dedicatedInstances = dedicatedPayload.items ?? [];
    state.instances = state.sharedInstances;
    state.containers = containersPayload?.items ?? [];
    state.containersMeta =
      containersPayload?.meta ??
      buildFallbackContainerMeta(
        [...state.sharedInstances, ...state.dedicatedInstances],
        containersPayload?.error?.message || "Container metadata unavailable",
      );

    applyModelChannelPayload(
      state,
      modelChannelsPayload,
      isAdminModeEnabled,
      ensureModelChannelCatalogShape,
      normalizeModelChannelSettingsForEditor,
    );

    state.lastLoadedAt = new Date().toISOString();
    restoreSelectedInstance(state, preserveSelection);

    if (state.selectedId) {
      await loadInstanceDetail(state.selectedScope, state.selectedId, false);
    } else {
      state.selectedItem = null;
      state.selectedDiagnosticsLoading = false;
      configurePairingAutoRefresh(false);
    }

    updateConnectionNote(`Connected to ${state.apiBase}; last refresh: ${formatDateTime(state.lastLoadedAt)}`);
    renderAll();
  } catch (error) {
    pushStatus("error", "Failed to load instances", error.message);
    updateConnectionNote(`Connection failed: ${error.message}`, true);
    renderAll();
  } finally {
    setBusy(false);
  }
}
