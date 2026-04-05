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
      '<div class="empty-state" style="min-height: 180px; grid-column: 1 / -1;">当前还没有检查结果。可以先刷新，或确认这个实例已经启动。</div>';
    return;
  }

  const pills = [
    {
      label: "存活检查",
      value: item.probe.live == null ? "未返回" : item.probe.live ? "通过" : "未通过",
      className: item.probe.live === true ? "probe-pill-success" : item.probe.live === false ? "probe-pill-danger" : "",
    },
    {
      label: "就绪检查",
      value: item.probe.ready == null ? "未返回" : item.probe.ready ? "通过" : "未通过",
      className:
        item.probe.ready === true ? "probe-pill-success" : item.probe.ready === false ? "probe-pill-danger" : "",
    },
    {
      label: "最近检查时间",
      value: formatDateTime(item.probe.checkedAt),
      className: "",
    },
    {
      label: "错误说明",
      value: item.probe.error || "没有错误",
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
      "这个实例最近的请求结果",
      topEntries(summary.countsByOutcome).map(([key, value]) => [explainOutcome(key), value]),
    ),
    buildUsageTable(
      "这个实例最近最常用的能力类别",
      topEntries(summary.countsByToolName).map(([key, value]) => [explainToolName(key), value]),
    ),
    buildUsageTable(
      "这个实例最近最常用的具体能力",
      topEntries(summary.countsByToolNameAction).map(([key, value]) => [explainToolAction(key), value]),
    ),
    buildUsageTable(
      "这个实例的请求主要在哪里完成",
      topEntries(summary.countsByRouteType).map(([key, value]) => [explainRouteType(key), value]),
    ),
    buildUsageTable(
      "这个实例最近最常碰到的共享限制",
      topEntries(summary.countsByRuleId).map(([key, value]) => [explainRuleId(key), value]),
    ),
    buildUsageTable("这个实例最近最常见的失败原因", topEntries(summary.countsByDeniedReason)),
  ];

  const totalCount = Number(summary.totalCount ?? 0);
  const filePath = summary.filePath
    ? `<p class="connection-note">统计文件：<code>${escapeHtml(summary.filePath)}</code></p>`
    : "";

  elements.usageSummary.innerHTML = `
    <section class="detail-card" style="grid-column: 1 / -1;">
      <div class="detail-card-header">
        <h3>最近调用总览</h3>
        <span class="chip chip-success">调用记录 ${escapeHtml(totalCount)}</span>
      </div>
      ${diagnosticsNote}
      ${usageNote}
      ${filePath}
    </section>
    ${cards.join("")}
  `;
}

export function renderDetailEmptyStateSection({ elements, renderPairingSummary, updateAdminModeUi }) {
  elements.detailBadge.textContent = "未选择实例";
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
        ? "通过 Shared Console 代理打开该容器实例的 UI"
        : "通过 Shared Console 打开该实例的 UI";
  }
  if (elements.copyUiLinkButton) {
    elements.copyUiLinkButton.disabled = !canOpenInstanceUi(item);
    elements.copyUiLinkButton.title =
      instanceRuntimeLocation(item) === "container"
        ? "复制通过 Shared Console 代理访问该容器实例 UI 的链接"
        : "复制通过 Shared Console 访问该实例 UI 的链接";
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
