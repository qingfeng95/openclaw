export function buildDiagnosticsNoteSection({ state, item, escapeHtml, formatRelativeTime }) {
  if (state.selectedDiagnosticsLoading) {
    return `<p class="connection-note">Loading diagnostics...</p>`;
  }
  if (item?.probe?.checkedAt) {
    return `<p class="connection-note">Diagnostics updated ${escapeHtml(formatRelativeTime(item.probe.checkedAt))}</p>`;
  }
  if (item?.probe?.error) {
    return `<p class="connection-note">Diagnostics degraded: ${escapeHtml(item.probe.error)}</p>`;
  }
  return "";
}

export function renderProbeGridSection(params) {
  const {
    state,
    elements,
    item,
    escapeHtml,
    formatDateTime,
    buildDiagnosticsNote,
  } = params;
  const diagnosticsNote = buildDiagnosticsNote(item);
  if (state.selectedDiagnosticsLoading) {
    elements.probeGrid.innerHTML = `
      <div class="empty-state" style="min-height: 180px; grid-column: 1 / -1;">
        <p>Loading diagnostics for this instance...</p>
        ${diagnosticsNote}
      </div>`;
    return;
  }
  if (!item.probe) {
    elements.probeGrid.innerHTML =
      '<div class="empty-state" style="min-height: 180px; grid-column: 1 / -1;">褰撳墠杩樻病鏈夋鏌ョ粨鏋溿€傚彲浠ュ厛鍒锋柊锛屾垨纭杩欎釜瀹炰緥宸茬粡鍚姩銆?/div>';
    return;
  }

  const pills = [
    {
      label: "瀛樻椿妫€鏌?",
      value: item.probe.live == null ? "鏈繑鍥?" : item.probe.live ? "閫氳繃" : "鏈€氳繃",
      className: item.probe.live === true ? "probe-pill-success" : item.probe.live === false ? "probe-pill-danger" : "",
    },
    {
      label: "灏辩华妫€鏌?",
      value: item.probe.ready == null ? "鏈繑鍥?" : item.probe.ready ? "閫氳繃" : "鏈€氳繃",
      className:
        item.probe.ready === true ? "probe-pill-success" : item.probe.ready === false ? "probe-pill-danger" : "",
    },
    {
      label: "鏈€杩戞鏌ユ椂闂?",
      value: formatDateTime(item.probe.checkedAt),
      className: "",
    },
    {
      label: "閿欒璇存槑",
      value: item.probe.error || "娌℃湁閿欒",
      className: item.probe.error ? "probe-pill-warning" : "",
    },
  ];

  elements.probeGrid.innerHTML = `${diagnosticsNote}${pills
    .map(
      (entry) => `
        <div class="probe-item">
          <span class="probe-label">${escapeHtml(entry.label)}</span>
          <div class="probe-value"><span class="probe-pill ${entry.className}">${escapeHtml(entry.value)}</span></div>
        </div>
      `,
    )
    .join("")}`;
}

export function renderUsageSummarySection(params) {
  const {
    state,
    elements,
    item,
    escapeHtml,
    formatRelativeTime,
    buildDiagnosticsNote,
    buildUsageTable,
    topEntries,
    explainOutcome,
    explainToolName,
    explainToolAction,
    explainRouteType,
    explainRuleId,
  } = params;
  const diagnosticsNote = buildDiagnosticsNote(item);
  if (state.selectedUsageLoading) {
    elements.usageSummary.innerHTML = `
      <div class="empty-state" style="min-height: 180px; grid-column: 1 / -1;">
        <p>Loading usage summary...</p>
        ${diagnosticsNote}
      </div>`;
    return;
  }
  const usageSummary = state.selectedUsageSummary;
  if (!usageSummary) {
    const usageErrorNote = state.selectedUsageError
      ? `<p class="connection-note">Usage summary unavailable: ${escapeHtml(state.selectedUsageError)}</p>`
      : "";
    elements.usageSummary.innerHTML = `
      <div class="empty-state" style="min-height: 180px; grid-column: 1 / -1;">
        <p>No usage summary available for this instance yet.</p>
        ${usageErrorNote}
        ${diagnosticsNote}
      </div>`;
    return;
  }
  const summary = usageSummary;
  const usageNote = state.selectedUsageCheckedAt
    ? `<p class="connection-note">Usage summary updated ${escapeHtml(formatRelativeTime(state.selectedUsageCheckedAt))}</p>`
    : "";
  const cards = [
    buildUsageTable(
      "杩欎釜瀹炰緥鏈€杩戠殑璇锋眰缁撴灉",
      topEntries(summary.countsByOutcome).map(([key, value]) => [explainOutcome(key), value]),
    ),
    buildUsageTable(
      "杩欎釜瀹炰緥鏈€杩戞渶甯哥敤鐨勮兘鍔涚被鍒?",
      topEntries(summary.countsByToolName).map(([key, value]) => [explainToolName(key), value]),
    ),
    buildUsageTable(
      "杩欎釜瀹炰緥鏈€杩戞渶甯哥敤鐨勫叿浣撹兘鍔?",
      topEntries(summary.countsByToolNameAction).map(([key, value]) => [explainToolAction(key), value]),
    ),
    buildUsageTable(
      "杩欎釜瀹炰緥鐨勮姹備富瑕佸湪鍝噷瀹屾垚",
      topEntries(summary.countsByRouteType).map(([key, value]) => [explainRouteType(key), value]),
    ),
    buildUsageTable(
      "杩欎釜瀹炰緥鏈€杩戞渶甯哥鍒扮殑鍏变韩闄愬埗",
      topEntries(summary.countsByRuleId).map(([key, value]) => [explainRuleId(key), value]),
    ),
    buildUsageTable("杩欎釜瀹炰緥鏈€杩戞渶甯歌鐨勫け璐ュ師鍥?", topEntries(summary.countsByDeniedReason)),
  ];

  const totalCount = Number(summary.totalCount ?? 0);
  const filePath = summary.filePath
    ? `<p class="connection-note">缁熻鏂囦欢锛?code>${escapeHtml(summary.filePath)}</code></p>`
    : "";

  elements.usageSummary.innerHTML = `
    <section class="detail-card" style="grid-column: 1 / -1;">
      <div class="detail-card-header">
        <h3>鏈€杩戣皟鐢ㄦ€昏</h3>
        <span class="chip chip-success">璋冪敤璁板綍 ${escapeHtml(totalCount)}</span>
      </div>
      ${diagnosticsNote}
      ${usageNote}
      ${filePath}
    </section>
    ${cards.join("")}
  `;
}

export function renderDetailEmptyStateSection({ elements, renderPairingSummary, updateAdminModeUi }) {
  elements.detailBadge.textContent = "閺堫亪鈧瀚ㄧ€圭偘绶?";
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
  renderPairingSummary();
  updateAdminModeUi();
}

export function renderDetailActionStateSection(params) {
  const { elements, state, item, canOpenInstanceUi, instanceRuntimeLocation, isAdminModeEnabled } = params;
  if (elements.openUiButton) {
    elements.openUiButton.disabled = !canOpenInstanceUi(item);
    elements.openUiButton.title =
      instanceRuntimeLocation(item) === "container"
        ? "闁俺绻?Shared Console 娴狅絿鎮婇幍鎾崇磻鐎圭懓娅掗崘鍛杽娓?UI"
        : "闁俺绻?Shared Console 娴狅絿鎮婇幍鎾崇磻鐎圭偘绶?UI";
  }
  if (elements.copyUiLinkButton) {
    elements.copyUiLinkButton.disabled = !canOpenInstanceUi(item);
    elements.copyUiLinkButton.title =
      instanceRuntimeLocation(item) === "container"
        ? "婢跺秴鍩楃拠銉ョ杽娓氬绮?Shared Console 娴狅絿鎮婇惃?UI 閸︽澘娼?"
        : "婢跺秴鍩楃拠銉ョ杽娓氬绮?Shared Console 娴狅絿鎮婇惃?UI 閸︽澘娼?";
  }
  if (elements.copyTokenButton) {
    elements.copyTokenButton.disabled = !isAdminModeEnabled();
    elements.copyTokenButton.classList.toggle("hidden", !isAdminModeEnabled());
  }
  if (elements.refreshPairingButton) {
    elements.refreshPairingButton.disabled = !isAdminModeEnabled();
    elements.refreshPairingButton.classList.toggle("hidden", !isAdminModeEnabled());
  }
  if (elements.approveLatestPairingButton) {
    const pending = Array.isArray(state.pairingInfo?.pending) ? state.pairingInfo.pending : [];
    elements.approveLatestPairingButton.disabled =
      !isAdminModeEnabled() || !canOpenInstanceUi(item) || state.pairingLoading || pending.length === 0;
    elements.approveLatestPairingButton.classList.toggle("hidden", !isAdminModeEnabled());
  }
  if (elements.copyLoginGuideButton) {
    elements.copyLoginGuideButton.disabled = !isAdminModeEnabled() || !canOpenInstanceUi(item);
    elements.copyLoginGuideButton.classList.toggle("hidden", !isAdminModeEnabled());
  }
}

export function renderDetailContentSectionsSection(params) {
  const {
    elements,
    item,
    renderMetaGrid,
    renderPairingSummary,
    renderProbeGrid,
    renderUsageSummary,
    updateAdminModeUi,
  } = params;
  renderMetaGrid(item);
  renderPairingSummary();
  renderProbeGrid(item);
  renderUsageSummary(item);
  elements.detailEmpty.classList.add("hidden");
  elements.detailContent.classList.remove("hidden");
  updateAdminModeUi();
}
