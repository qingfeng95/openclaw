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
    elements.pairingSummary.innerHTML = `<p class="connection-note">閫夋嫨瀹炰緥鍚庡彲鏌ョ湅璁惧閰嶅鐘舵€併€?/p>`;
    return;
  }
  if (!state.adminModeAvailable) {
    elements.pairingSummary.innerHTML = `<p class="connection-note">褰撳墠鏈嶅姟鍣ㄦ湭鍚敤绠＄悊鍛樻ā寮忥紝鏃犳硶鏌ョ湅璁惧閰嶅銆?/p>`;
    return;
  }
  if (!isAdminModeEnabled()) {
    elements.pairingSummary.innerHTML =
      `<p class="connection-note">杩涘叆绠＄悊鍛樻ā寮忓悗锛屽彲鏌ョ湅寰呴厤瀵硅澶囧苟涓€閿壒鍑嗘渶鏂拌姹傘€?/p>`;
    return;
  }
  if (state.pairingLoading) {
    elements.pairingSummary.innerHTML = `<p class="connection-note">姝ｅ湪鍔犺浇璇ュ疄渚嬬殑璁惧閰嶅鐘舵€?..</p>`;
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
            const name = entry.displayName || entry.deviceId || "鏈懡鍚嶈澶?";
            const requestId = entry.requestId || "unknown";
            const role = entry.role || (Array.isArray(entry.roles) ? entry.roles.join(", ") : "") || "unknown";
            const scopes = Array.isArray(entry.scopes) && entry.scopes.length > 0 ? entry.scopes.join(", ") : "鏈０鏄?";
            return `<article class="callout"><strong>${escapeHtml(name)}</strong><br />璇锋眰 ID锛?code>${escapeHtml(requestId)}</code><br />瑙掕壊锛?${escapeHtml(role)}<br />鑼冨洿锛?${escapeHtml(scopes)}</article>`;
          })
          .join("")
      : `<p class="connection-note">褰撳墠娌℃湁寰呮壒鍑嗙殑璁惧閰嶅璇锋眰銆?/p>`;

  const pairedMarkup =
    paired.length > 0
      ? `<p class="connection-note">宸查厤瀵硅澶?${escapeHtml(paired.length)} 鍙般€?${
          paired[0]?.displayName || paired[0]?.deviceId
            ? `鏈€杩戣澶囷細<code>${escapeHtml(paired[0].displayName || paired[0].deviceId)}</code>`
            : ""
        }</p>`
      : `<p class="connection-note">褰撳墠杩樻病鏈夊凡閰嶅璁惧銆?/p>`;

  elements.pairingSummary.innerHTML = `
    <section class="detail-card" style="grid-column: 1 / -1;">
      <div class="detail-card-header">
        <h3>閰嶅鎬昏</h3>
        <div class="inline-actions">
          <span class="chip ${pending.length > 0 ? "chip-danger" : "chip-success"}">寰呮壒鍑?${escapeHtml(pending.length)}</span>
          <span class="chip ${paired.length > 0 ? "chip-success" : ""}">宸查厤瀵?${escapeHtml(paired.length)}</span>
        </div>
      </div>
      ${
        latestPending
          ? `<p class="connection-note">Latest request: <code>${escapeHtml(latestPending.requestId || "unknown")}</code> / ${escapeHtml(latestPending.displayName || latestPending.deviceId || "Unnamed device")}</p>`
          : `<p class="connection-note">No new pending pairing requests.</p>`
      }
      ${pendingMarkup}
      ${pairedMarkup}
    </section>
  `;
}
