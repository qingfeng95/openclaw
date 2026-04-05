export function renderMetaGridSection(params) {
  const {
    state,
    elements,
    item,
    instanceScopeLabel,
    formatModelChannelLabel,
    instanceRuntimeLocation,
    formatDateTime,
    instanceRuntimeDescription,
    escapeHtml,
    formatMaybe,
  } = params;

  const entries = [
    ["Instance type", instanceScopeLabel(state.selectedScope)],
    ["Instance ID", item.id],
    ["Display name", item.name],
    ["Model channel", formatModelChannelLabel(item.modelChannelId || "")],
    ["Process state", item.process?.state === "running" ? "running" : "stopped"],
    ["Runtime location", instanceRuntimeLocation(item) === "container" ? "container" : "host"],
    [
      "Container",
      instanceRuntimeLocation(item) === "container"
        ? item.runtime?.containerName || "unknown-container"
        : "not-bound",
    ],
    ["PID", item.process?.pid],
    ["Bind", item.bind],
    ["Port", item.port],
    ["Profile", item.profile],
    ["Template", item.template],
    ["Config path", item.paths?.configPath],
    ["State dir", item.paths?.stateDir],
    ["Log dir", item.paths?.logDir],
    ["Created at", formatDateTime(item.timestamps?.createdAt)],
    ["Updated at", formatDateTime(item.timestamps?.updatedAt)],
    ["Version", item.probe?.version],
    ["Runtime note", instanceRuntimeDescription(item)],
  ];

  elements.detailMeta.innerHTML = entries
    .map(
      ([label, value]) => `
        <div class="meta-item">
          <span class="meta-label">${escapeHtml(label)}</span>
          <div class="meta-value"><code>${escapeHtml(formatMaybe(value))}</code></div>
        </div>
      `,
    )
    .join("");
}

export function renderDetailSection(params) {
  const {
    state,
    elements,
    isAdminModeEnabled,
    renderModelChannelSelect,
    canOpenInstanceUi,
    renderMetaGrid,
    renderPairingSummary,
    renderProbeGrid,
    renderUsageSummary,
    updateAdminModeUi,
  } = params;

  const item = state.selectedItem;
  const adminEnabled = isAdminModeEnabled();
  if (!item) {
    elements.detailBadge.textContent = "No instance selected";
    elements.detailEmpty.classList.remove("hidden");
    elements.detailContent.classList.add("hidden");
    if (elements.openUiButton) {
      elements.openUiButton.disabled = true;
    }
    if (elements.copyTokenButton) {
      elements.copyTokenButton.classList.add("hidden");
      elements.copyTokenButton.disabled = true;
    }
    if (elements.copyUiLinkButton) {
      elements.copyUiLinkButton.disabled = true;
    }
    if (elements.copyLoginGuideButton) {
      elements.copyLoginGuideButton.classList.add("hidden");
      elements.copyLoginGuideButton.disabled = true;
    }
    if (elements.refreshPairingButton) {
      elements.refreshPairingButton.classList.add("hidden");
      elements.refreshPairingButton.disabled = true;
    }
    if (elements.approveLatestPairingButton) {
      elements.approveLatestPairingButton.classList.add("hidden");
      elements.approveLatestPairingButton.disabled = true;
    }
    if (elements.detailModelChannelSelect) {
      elements.detailModelChannelSelect.disabled = true;
    }
    if (elements.clearDetailModelChannelButton) {
      elements.clearDetailModelChannelButton.disabled = true;
    }
    if (elements.saveDetailModelChannelButton) {
      elements.saveDetailModelChannelButton.disabled = true;
    }
    renderPairingSummary();
    updateAdminModeUi();
    return;
  }

  elements.detailBadge.textContent = item.id;
  elements.detailTitle.textContent = item.name || item.id;
  elements.renameInput.value = item.name || "";
  renderModelChannelSelect(elements.detailModelChannelSelect, item.modelChannelId || "");
  if (elements.detailModelChannelSelect) {
    elements.detailModelChannelSelect.disabled = !adminEnabled;
  }
  if (elements.clearDetailModelChannelButton) {
    elements.clearDetailModelChannelButton.disabled = !adminEnabled;
  }
  if (elements.saveDetailModelChannelButton) {
    elements.saveDetailModelChannelButton.disabled = !adminEnabled;
  }
  if (elements.openUiButton) {
    elements.openUiButton.disabled = !canOpenInstanceUi(item);
  }
  if (elements.copyUiLinkButton) {
    elements.copyUiLinkButton.disabled = !canOpenInstanceUi(item);
  }
  if (elements.copyTokenButton) {
    elements.copyTokenButton.disabled = !adminEnabled;
    elements.copyTokenButton.classList.toggle("hidden", !adminEnabled);
  }
  if (elements.refreshPairingButton) {
    elements.refreshPairingButton.disabled = !adminEnabled;
    elements.refreshPairingButton.classList.toggle("hidden", !adminEnabled);
  }
  if (elements.approveLatestPairingButton) {
    const pending = Array.isArray(state.pairingInfo?.pending) ? state.pairingInfo.pending : [];
    elements.approveLatestPairingButton.disabled =
      !adminEnabled || !canOpenInstanceUi(item) || state.pairingLoading || pending.length === 0;
    elements.approveLatestPairingButton.classList.toggle("hidden", !adminEnabled);
  }
  if (elements.copyLoginGuideButton) {
    elements.copyLoginGuideButton.disabled = !adminEnabled || !canOpenInstanceUi(item);
    elements.copyLoginGuideButton.classList.toggle("hidden", !adminEnabled);
  }
  renderMetaGrid(item);
  renderPairingSummary();
  renderProbeGrid(item);
  renderUsageSummary(item);
  elements.detailEmpty.classList.add("hidden");
  elements.detailContent.classList.remove("hidden");
  updateAdminModeUi();
}

export function enableAdminModeSection(params) {
  const {
    state,
    elements,
    fetchJson,
    updateAdminModeUi,
    loadInstances,
    pushStatus,
    sessionStorageRef,
    adminTokenStorageKey,
  } = params;

  return (async () => {
    if (!state.adminModeAvailable) {
      pushStatus("error", "Admin mode unavailable", "Server admin mode is not enabled.");
      return;
    }
    const token = elements.adminTokenInput.value.trim();
    if (!token) {
      pushStatus("error", "Admin mode unavailable", "Admin token is required.");
      return;
    }
    await fetchJson("/api/admin/validate", {
      adminAuth: false,
      headers: { "X-Shared-Console-Admin-Token": token },
    });
    state.adminToken = token;
    sessionStorageRef.setItem(adminTokenStorageKey, token);
    updateAdminModeUi();
    await loadInstances({ preserveSelection: true });
    pushStatus("success", "Admin mode enabled", "Global settings and instance tokens are now available.");
  })();
}

export function clearAdminModeSection(params) {
  const {
    state,
    elements,
    resetPairingState,
    updateAdminModeUi,
    renderAll,
    loadInstances,
    pushStatus,
    sessionStorageRef,
    adminTokenStorageKey,
  } = params;

  state.adminToken = "";
  sessionStorageRef.removeItem(adminTokenStorageKey);
  elements.adminTokenInput.value = "";
  resetPairingState();
  state.modelChannelSettings = null;
  state.modelChannelSettingsText = "";
  state.modelChannelEditorDirty = false;
  updateAdminModeUi();
  renderAll();
  void loadInstances({ preserveSelection: true });
  pushStatus("info", "Admin mode cleared");
}
