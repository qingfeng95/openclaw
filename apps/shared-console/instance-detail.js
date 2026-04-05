export function isCurrentDetailRequest(state, scope, id, requestToken) {
  return requestToken === state.detailRequestToken && state.selectedScope === scope && state.selectedId === id;
}

export function applySelectedInstanceCore(state, scope, id, item, resetPairingState, resetUsageState) {
  state.selectedScope = scope;
  state.selectedId = id;
  state.selectedItem = item;
  state.selectedDiagnosticsLoading = true;
  resetUsageState();
  state.selectedUsageLoading = true;
  resetPairingState();
}

export async function refreshSelectedInstanceAsync(params) {
  const {
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
  } = params;
  await loadInstanceDiagnostics(scope, id, requestToken);
  if (!isCurrentDetailRequest(state, scope, id, requestToken)) {
    configurePairingAutoRefresh(Boolean(state.selectedId) && isAdminModeEnabled());
    return;
  }
  await loadInstanceUsageSummary(scope, id, requestToken);
  if (!isCurrentDetailRequest(state, scope, id, requestToken)) {
    configurePairingAutoRefresh(Boolean(state.selectedId) && isAdminModeEnabled());
    return;
  }
  if (isAdminModeEnabled()) {
    await loadSelectedInstancePairing({ announce: false, requestToken }).catch(() => {
      // Keep instance detail usable even if pairing diagnostics fail.
    });
  }
  configurePairingAutoRefresh(Boolean(state.selectedId) && isAdminModeEnabled());
}

export function applySelectedInstanceDiagnostics(state, scope, id, requestToken, probe) {
  if (!isCurrentDetailRequest(state, scope, id, requestToken) || !state.selectedItem) {
    return false;
  }
  state.selectedItem = {
    ...state.selectedItem,
    probe,
  };
  return true;
}

export function applySelectedInstanceUsageSummary(state, scope, id, requestToken, result) {
  if (!isCurrentDetailRequest(state, scope, id, requestToken) || !state.selectedItem) {
    return false;
  }
  state.selectedUsageSummary = result?.usageSummary ?? null;
  state.selectedUsageCheckedAt = typeof result?.checkedAt === "string" ? result.checkedAt : null;
  state.selectedUsageError = typeof result?.error === "string" ? result.error : "";
  return true;
}

export function buildDiagnosticsFailureProbe(message) {
  return {
    checkedAt: new Date().toISOString(),
    live: null,
    ready: null,
    version: null,
    usageSummary: null,
    error: message,
  };
}

export function buildUsageSummaryFailureResult(message) {
  return {
    checkedAt: new Date().toISOString(),
    usageSummary: null,
    error: message,
  };
}
