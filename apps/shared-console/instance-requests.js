export async function loadInstanceDetailSection(params) {
  const {
    state,
    scope,
    id,
    announce = true,
    fetchJson,
    instanceApiBase,
    applySelectedInstanceCore,
    resetPairingState,
    resetUsageState,
    renderDetail,
    refreshSelectedInstanceAsync,
    isAdminModeEnabled,
    loadInstanceDiagnostics,
    loadInstanceUsageSummary,
    loadSelectedInstancePairing,
    configurePairingAutoRefresh,
    pushStatus,
    instanceScopeLabel,
    isCurrentDetailRequest,
  } = params;

  const requestToken = ++state.detailRequestToken;
  const payload = await fetchJson(`${instanceApiBase(scope)}/${encodeURIComponent(id)}`);
  if (requestToken !== state.detailRequestToken) {
    return;
  }
  applySelectedInstanceCore(state, scope, id, payload.item, resetPairingState, resetUsageState);
  renderDetail();
  void refreshSelectedInstanceAsync({
    state,
    scope,
    id,
    requestToken,
    isAdminModeEnabled,
    loadInstanceDiagnostics,
    loadInstanceUsageSummary,
    loadSelectedInstancePairing,
    configurePairingAutoRefresh,
    isCurrentDetailRequest,
  });
  if (announce) {
    pushStatus("info", `已切换到${instanceScopeLabel(scope)} ${id}`, payload.item?.probe?.version || "暂无版本信息");
  }
}

export async function loadInstanceDiagnosticsSection(params) {
  const {
    state,
    scope,
    id,
    requestToken = state.detailRequestToken,
    fetchJson,
    instanceApiBase,
    applySelectedInstanceDiagnostics,
    buildDiagnosticsFailureProbe,
    isCurrentDetailRequest,
    renderDetail,
  } = params;

  if (!isCurrentDetailRequest(state, scope, id, requestToken)) {
    return;
  }

  try {
    const payload = await fetchJson(`${instanceApiBase(scope)}/${encodeURIComponent(id)}/diagnostics`);
    applySelectedInstanceDiagnostics(state, scope, id, requestToken, payload?.item?.probe ?? null);
  } catch (error) {
    applySelectedInstanceDiagnostics(state, scope, id, requestToken, buildDiagnosticsFailureProbe(error.message));
  } finally {
    if (isCurrentDetailRequest(state, scope, id, requestToken)) {
      state.selectedDiagnosticsLoading = false;
      renderDetail();
    }
  }
}

export async function loadInstanceUsageSummarySection(params) {
  const {
    state,
    scope,
    id,
    requestToken = state.detailRequestToken,
    fetchJson,
    instanceApiBase,
    applySelectedInstanceUsageSummary,
    buildUsageSummaryFailureResult,
    isCurrentDetailRequest,
    renderDetail,
  } = params;

  if (!isCurrentDetailRequest(state, scope, id, requestToken)) {
    return;
  }

  try {
    const payload = await fetchJson(`${instanceApiBase(scope)}/${encodeURIComponent(id)}/usage-summary`);
    applySelectedInstanceUsageSummary(state, scope, id, requestToken, payload?.item ?? null);
  } catch (error) {
    applySelectedInstanceUsageSummary(state, scope, id, requestToken, buildUsageSummaryFailureResult(error.message));
  } finally {
    if (isCurrentDetailRequest(state, scope, id, requestToken)) {
      state.selectedUsageLoading = false;
      renderDetail();
    }
  }
}

export async function loadSelectedInstancePairingSection(params) {
  const {
    state,
    announce = true,
    requestToken = state.detailRequestToken,
    resetPairingState,
    renderPairingSummary,
    isAdminModeEnabled,
    fetchJson,
    instanceApiBase,
    isCurrentDetailRequest,
    pushStatus,
    renderDetail,
  } = params;

  if (!state.selectedItem || !state.selectedId) {
    resetPairingState();
    renderPairingSummary();
    return;
  }
  if (!isAdminModeEnabled()) {
    resetPairingState();
    renderPairingSummary();
    return;
  }

  const scope = state.selectedScope;
  const selectedId = state.selectedId;
  if (!isCurrentDetailRequest(state, scope, selectedId, requestToken)) {
    return;
  }
  state.pairingLoading = true;
  state.pairingError = "";
  renderPairingSummary();

  try {
    const payload = await fetchJson(`${instanceApiBase(scope)}/${encodeURIComponent(selectedId)}/pairing`, {
      adminAuth: true,
    });
    if (!isCurrentDetailRequest(state, scope, selectedId, requestToken)) {
      return;
    }
    state.pairingInfo = payload?.item?.pairing ?? { pending: [], paired: [] };
    state.pairingError = "";
    if (announce) {
      const pendingCount = Array.isArray(state.pairingInfo?.pending) ? state.pairingInfo.pending.length : 0;
      pushStatus("info", `Refreshed pairing for ${state.selectedId}`, `Pending approvals: ${pendingCount}`);
    }
  } catch (error) {
    if (!isCurrentDetailRequest(state, scope, selectedId, requestToken)) {
      return;
    }
    state.pairingInfo = null;
    state.pairingError = error.message;
    throw error;
  } finally {
    if (isCurrentDetailRequest(state, scope, selectedId, requestToken)) {
      state.pairingLoading = false;
      renderDetail();
    }
  }
}

export async function approveLatestSelectedInstancePairingSection(params) {
  const {
    state,
    isAdminModeEnabled,
    canOpenInstanceUi,
    pushStatus,
    renderDetail,
    fetchJson,
    instanceApiBase,
  } = params;

  if (!state.selectedItem || !state.selectedId) {
    return;
  }
  if (!isAdminModeEnabled()) {
    pushStatus("error", "批准配对失败", "请先进入管理员模式。");
    return;
  }
  if (!canOpenInstanceUi(state.selectedItem)) {
    pushStatus("error", "批准配对失败", "实例尚未运行，先启动实例再处理设备配对。");
    return;
  }

  state.pairingLoading = true;
  renderDetail();

  try {
    const payload = await fetchJson(
      `${instanceApiBase(state.selectedScope)}/${encodeURIComponent(state.selectedId)}/pairing/approve-latest`,
      {
        method: "POST",
        adminAuth: true,
      },
    );
    state.pairingInfo = payload?.item?.pairing ?? { pending: [], paired: [] };
    state.pairingError = "";
    const requestId = payload?.result?.requestId || "latest";
    const deviceId = payload?.result?.device?.deviceId || "unknown-device";
    pushStatus("success", `Approved latest pairing for ${state.selectedId}`, `${deviceId} (${requestId})`);
  } catch (error) {
    state.pairingError = error.message;
    throw error;
  } finally {
    state.pairingLoading = false;
    renderDetail();
  }
}
