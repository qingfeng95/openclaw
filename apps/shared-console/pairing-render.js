export function renderPairingSummarySection(params) {
  const {
    elements,
    state,
    escapeHtml,
    isAdminModeEnabled,
  } = params;

  if (!elements.pairingSummary) {
    return;
  }
  if (!state.selectedItem) {
    elements.pairingSummary.innerHTML = `<p class="connection-note">选择实例后可查看设备配对状态。</p>`;
    return;
  }
  if (!state.adminModeAvailable) {
    elements.pairingSummary.innerHTML = `<p class="connection-note">当前服务器未启用管理员模式，无法查看设备配对。</p>`;
    return;
  }
  if (!isAdminModeEnabled()) {
    elements.pairingSummary.innerHTML =
      `<p class="connection-note">进入管理员模式后，可查看待配对设备并一键批准最新请求。</p>`;
    return;
  }
  if (state.pairingLoading) {
    elements.pairingSummary.innerHTML = `<p class="connection-note">正在加载该实例的设备配对状态...</p>`;
    return;
  }
  if (state.pairingError) {
    elements.pairingSummary.innerHTML = `<p class="connection-note">${escapeHtml(state.pairingError)}</p>`;
    return;
  }

  const pairing = state.pairingInfo || {};
  const pending = Array.isArray(pairing.pending) ? pairing.pending : [];
  const paired = Array.isArray(pairing.paired) ? pairing.paired : [];
  const latestPending =
    pending.length > 0
      ? [...pending].sort((left, right) => Number(right?.ts ?? 0) - Number(left?.ts ?? 0))[0]
      : null;

  const pendingMarkup =
    pending.length > 0
      ? pending
          .slice(0, 5)
          .map((entry) => {
            const name = entry.displayName || entry.deviceId || "未命名设备";
            const requestId = entry.requestId || "unknown";
            const role = entry.role || (Array.isArray(entry.roles) ? entry.roles.join(", ") : "") || "unknown";
            const scopes = Array.isArray(entry.scopes) && entry.scopes.length > 0 ? entry.scopes.join(", ") : "未声明";
            return `<article class="callout"><strong>${escapeHtml(name)}</strong><br />请求 ID：<code>${escapeHtml(requestId)}</code><br />角色：${escapeHtml(role)}<br />范围：${escapeHtml(scopes)}</article>`;
          })
          .join("")
      : `<p class="connection-note">当前没有待批准的设备配对请求。</p>`;

  const pairedMarkup =
    paired.length > 0
      ? `<p class="connection-note">已配对设备 ${escapeHtml(paired.length)} 台。${
          paired[0]?.displayName || paired[0]?.deviceId
            ? `最近设备：<code>${escapeHtml(paired[0].displayName || paired[0].deviceId)}</code>`
            : ""
        }</p>`
      : `<p class="connection-note">当前还没有已配对设备。</p>`;

  elements.pairingSummary.innerHTML = `
    <section class="detail-card detail-card-span-2">
      <div class="detail-card-header">
        <h3>配对总览</h3>
        <div class="inline-actions">
          <span class="chip ${pending.length > 0 ? "chip-danger" : "chip-success"}">待批准 ${escapeHtml(pending.length)}</span>
          <span class="chip ${paired.length > 0 ? "chip-success" : ""}">已配对 ${escapeHtml(paired.length)}</span>
        </div>
      </div>
      ${
        latestPending
          ? `<p class="connection-note">最新请求：<code>${escapeHtml(latestPending.requestId || "unknown")}</code> / ${escapeHtml(latestPending.displayName || latestPending.deviceId || "未命名设备")}</p>`
          : `<p class="connection-note">当前没有新的待处理配对请求。</p>`
      }
      ${pendingMarkup}
      ${pairedMarkup}
    </section>
  `;
}
