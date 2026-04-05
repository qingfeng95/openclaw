import {
  applySelectedInstanceCore,
  applySelectedInstanceDiagnostics,
  applySelectedInstanceUsageSummary,
  buildDiagnosticsFailureProbe,
  buildUsageSummaryFailureResult,
  isCurrentDetailRequest,
  refreshSelectedInstanceAsync,
} from "./instance-detail.js";
import {
  approveLatestSelectedInstancePairingSection,
  loadInstanceDetailSection,
  loadInstanceDiagnosticsSection,
  loadInstanceUsageSummarySection,
  loadSelectedInstancePairingSection,
} from "./instance-requests.js";
import { loadInstancesSection } from "./instance-list-load.js";
import {
  appendModelChannelGenerateCardSection,
  buildModelChannelGenerateCardDefaultValuesSection,
  buildModelChannelGeneratorSharedOptionsSection,
  buildSingleModelChannelGeneratorPayloadSection,
  clearModelChannelGenerateCardsSection,
  collectBatchCardModelChannelGeneratorsSection,
  ensureModelChannelGenerateCardsInitializedSection,
  getModelChannelGenerateCardsSection,
  importBatchModelChannelGeneratorsAsCardsSection,
  parseBatchModelChannelGeneratorsSection,
  readModelChannelGenerateCardFieldSection,
  renumberModelChannelGenerateCardsSection,
  setModelChannelGenerateCardsDisabledSection,
  splitModelChannelGeneratorListSection,
} from "./model-channel-generator.js";
import {
  bindModelChannelEventsSection,
  handleDetailModelChannelSubmitSection,
  handleModelChannelGenerateSubmitSection,
  handleModelChannelsSubmitSection,
  loadModelChannelConfigSection,
  renderModelChannelsPanelSection,
  updateSelectedInstanceModelChannelSection,
} from "./model-channel-panel.js";
import {
  clearAdminModeSection,
  enableAdminModeSection,
  renderDetailSection,
  renderMetaGridSection,
} from "./detail-panel.js";
import {
  buildDiagnosticsNoteSection,
  renderDetailActionStateSection,
  renderDetailContentSectionsSection,
  renderDetailEmptyStateSection,
  renderProbeGridSection,
  renderUsageSummarySection,
} from "./detail-render.js";
import { renderPairingSummarySection } from "./pairing-render.js";
import {
  buildFallbackContainerMetaSection,
  buildOverviewHotspotSectionsSection,
  buildOverviewSummaryCardsSection,
  buildOverviewUsageNoteSection,
  buildWatchNoteSection,
  canOpenInstanceUiSection,
  defaultModelChannelSettingsSection,
  describeContainerActionSection,
  describeInstanceActionSection,
  explainHotspotValueSection,
  explainOutcomeSection,
  explainRouteTypeSection,
  explainRuleIdSection,
  explainToolActionSection,
  explainToolNameSection,
  ensureModelChannelCatalogShapeSection,
  instanceApiBaseSection,
  instanceRuntimeChipLabelSection,
  instanceRuntimeDescriptionSection,
  instanceRuntimeLocationSection,
  instanceScopeLabelSection,
  normalizeBindModeInputSection,
  normalizeModelChannelSettingsForEditorSection,
  statusKindLabelSection,
  topEntriesSection,
} from "./shared-console-core.js";
import {
  buildUiUrlWithOperatorScopesSection,
  escapeHtmlSection,
  formatDateTimeSection,
  formatMaybeSection,
  formatRelativeTimeSection,
  isAbsoluteHttpUrlSection,
  joinApiUrlSection,
  normalizeApiBaseSection,
  normalizeApiPathSection,
  resolveInstanceUiUrlSection,
  resolveUserInstanceUiScopesSection,
} from "./shared-console-utils.js";

const DEFAULT_API_PORT = "43100";
const API_BASE_STORAGE_KEY = "crewclaw.sharedConsole.apiBase";
const AUTO_REFRESH_STORAGE_KEY = "crewclaw.sharedConsole.autoRefresh";
const ADMIN_TOKEN_STORAGE_KEY = "crewclaw.sharedConsole.adminToken";
const TAB_STORAGE_KEY = "crewclaw.sharedConsole.activeTab";
const AUTO_REFRESH_INTERVAL_MS = 15_000;
const PAIRING_REFRESH_INTERVAL_MS = 5_000;
const STATUS_LIMIT = 14;

const state = {
  apiBase: "",
  adminToken: "",
  adminModeAvailable: false,
  sharedInstances: [],
  dedicatedInstances: [],
  instances: [],
  containers: [],
  containersMeta: null,
  overviewUsageLoading: false,
  overviewUsageSummary: null,
  overviewUsageCheckedAt: null,
  overviewUsageError: "",
  overviewUsageInstanceCount: 0,
  overviewUsageReportedInstanceCount: 0,
  selectedContainerName: null,
  containerLogsText: "",
  containerLogsTail: 160,
  selectedScope: "shared",
  selectedId: null,
  selectedItem: null,
  selectedDiagnosticsLoading: false,
  selectedUsageLoading: false,
  selectedUsageSummary: null,
  selectedUsageCheckedAt: null,
  selectedUsageError: "",
  pairingInfo: null,
  pairingLoading: false,
  pairingError: "",
  modelChannelCatalog: {
    userCanConfigureModels: false,
    channels: [],
  },
  modelChannelSettings: null,
  modelChannelSettingsText: "",
  modelChannelEditorDirty: false,
  filter: "",
  activeTab: "overview",
  busy: false,
  timerId: null,
  pairingTimerId: null,
  lastLoadedAt: null,
  detailRequestToken: 0,
};

const elements = {
  apiBaseInput: document.querySelector("#api-base-input"),
  applyApiBaseButton: document.querySelector("#apply-api-base-button"),
  adminTokenInput: document.querySelector("#admin-token-input"),
  enableAdminModeButton: document.querySelector("#enable-admin-mode-button"),
  clearAdminModeButton: document.querySelector("#clear-admin-mode-button"),
  adminModeNote: document.querySelector("#admin-mode-note"),
  refreshButton: document.querySelector("#refresh-button"),
  autoRefreshCheckbox: document.querySelector("#auto-refresh-checkbox"),
  workspaceTabs: document.querySelector("#workspace-tabs"),
  tabStatusNotes: Array.from(document.querySelectorAll("[data-tab-status]")),
  connectionNote: document.querySelector("#connection-note"),
  summaryGrid: document.querySelector("#summary-grid"),
  watchlistPanel: document.querySelector("#watchlist-panel"),
  hotspotPanel: document.querySelector("#hotspot-panel"),
  containersPanel: document.querySelector("#containers-panel"),
  containerLogsPanel: document.querySelector("#container-logs-panel"),
  createContainerForm: document.querySelector("#create-container-form"),
  containerNameOptions: document.querySelector("#container-name-options"),
  createPoolSelect: document.querySelector("#create-pool-select"),
  createRuntimeKindSelect: document.querySelector("#create-runtime-kind-select"),
  createRuntimeKindNote: document.querySelector("#create-runtime-kind-note"),
  filterInput: document.querySelector("#instance-filter-input"),
  instancesList: document.querySelector("#instances-list"),
  dedicatedInstancesList: document.querySelector("#dedicated-instances-list"),
  detailBadge: document.querySelector("#detail-badge"),
  detailEmpty: document.querySelector("#detail-empty"),
  detailContent: document.querySelector("#detail-content"),
  detailTitle: document.querySelector("#detail-title"),
  detailMeta: document.querySelector("#detail-meta"),
  renameForm: document.querySelector("#rename-form"),
  renameInput: document.querySelector("#rename-input"),
  openUiButton: document.querySelector("#open-ui-button"),
  copyUiLinkButton: document.querySelector("#copy-ui-link-button"),
  refreshPairingButton: document.querySelector("#refresh-pairing-button"),
  approveLatestPairingButton: document.querySelector("#approve-latest-pairing-button"),
  copyLoginGuideButton: document.querySelector("#copy-login-guide-button"),
  copyTokenButton: document.querySelector("#copy-token-button"),
  modelChannelsPanel: document.querySelector("#model-channels-panel"),
  modelChannelsForm: document.querySelector("#model-channels-form"),
  modelChannelsTextarea: document.querySelector("#model-channels-textarea"),
  modelChannelGenerateBaseUrlInput: document.querySelector("#model-channel-generate-base-url"),
  modelChannelGenerateApiInput: document.querySelector("#model-channel-generate-api"),
  modelChannelGenerateIdPrefixInput: document.querySelector("#model-channel-generate-id-prefix"),
  modelChannelGenerateNamePrefixInput: document.querySelector("#model-channel-generate-name-prefix"),
  modelChannelGenerateApiKeysTextarea: document.querySelector("#model-channel-generate-api-keys"),
  modelChannelGenerateModelsTextarea: document.querySelector("#model-channel-generate-models"),
  modelChannelGenerateBatchTextarea: document.querySelector("#model-channel-generate-batch-textarea"),
  addModelChannelGenerateCardButton: document.querySelector("#add-model-channel-generate-card-button"),
  importModelChannelBatchButton: document.querySelector("#import-model-channel-batch-button"),
  clearModelChannelCardsButton: document.querySelector("#clear-model-channel-cards-button"),
  modelChannelGenerateCards: document.querySelector("#model-channel-generate-cards"),
  modelChannelGenerateReasoningCheckbox: document.querySelector("#model-channel-generate-reasoning"),
  modelChannelGenerateImageInputCheckbox: document.querySelector("#model-channel-generate-image-input"),
  modelChannelGenerateRoundRobinCheckbox: document.querySelector("#model-channel-generate-round-robin"),
  generateModelChannelsButton: document.querySelector("#generate-model-channels-button"),
  userModelConfigCheckbox: document.querySelector("#user-model-config-checkbox"),
  autoUnassignRemovedModelChannelsCheckbox: document.querySelector(
    "#auto-unassign-removed-model-channels-checkbox",
  ),
  reloadModelChannelsButton: document.querySelector("#reload-model-channels-button"),
  saveModelChannelsButton: document.querySelector("#save-model-channels-button"),
  createModelChannelSelect: document.querySelector("#create-model-channel-select"),
  detailModelChannelForm: document.querySelector("#detail-model-channel-form"),
  detailModelChannelSelect: document.querySelector("#detail-model-channel-select"),
  clearDetailModelChannelButton: document.querySelector("#clear-detail-model-channel-button"),
  saveDetailModelChannelButton: document.querySelector("#save-detail-model-channel-button"),
  startButton: document.querySelector("#start-button"),
  stopButton: document.querySelector("#stop-button"),
  restartButton: document.querySelector("#restart-button"),
  probeGrid: document.querySelector("#probe-grid"),
  pairingSummary: document.querySelector("#pairing-summary"),
  usageSummary: document.querySelector("#usage-summary"),
  createForm: document.querySelector("#create-form"),
  statusFeed: document.querySelector("#status-feed"),
};

function resolveDefaultApiBase() {
  const stored = localStorage.getItem(API_BASE_STORAGE_KEY)?.trim();
  if (stored) {
    return stored;
  }
  const configApiBase = window.__SHARED_CONSOLE_CONFIG__?.apiBase?.trim();
  if (configApiBase) {
    return configApiBase;
  }
  const { protocol, hostname } = window.location;
  const resolvedProtocol = protocol === "file:" ? "http:" : protocol;
  const resolvedHost = hostname || "127.0.0.1";
  return `${resolvedProtocol}//${resolvedHost}:${DEFAULT_API_PORT}`;
}

function resolveStoredAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY)?.trim() || "";
}

function resolveStoredActiveTab() {
  const stored = localStorage.getItem(TAB_STORAGE_KEY)?.trim();
  if (stored && ["overview", "containers", "instances", "channels", "activity"].includes(stored)) {
    return stored;
  }
  return "overview";
}

function defaultModelChannelSettings() {
  return defaultModelChannelSettingsSection();
}

function ensureModelChannelCatalogShape(payload) {
  return ensureModelChannelCatalogShapeSection(payload);
}

function normalizeModelChannelSettingsForEditor(value) {
  return normalizeModelChannelSettingsForEditorSection(value);
}

function formatModelChannelLabel(channelId) {
  const normalized = String(channelId || "").trim();
  if (!normalized) {
    return "未映射";
  }
  const match = state.modelChannelCatalog.channels.find((item) => item.id === normalized);
  if (!match) {
    return `${normalized}（已不存在）`;
  }
  const suffix = match.defaultModel ? ` · ${match.defaultModel}` : "";
  if (match.kind === "group") {
    const countLabel = match.channelCount ? ` · ${match.channelCount} 个渠道轮询` : " · 轮询组";
    return `${match.name || match.id}${countLabel}${suffix}`;
  }
  return `${match.name || match.id}${suffix}`;
}

function normalizeApiBase(value) {
  return normalizeApiBaseSection(value);
}

function isAbsoluteHttpUrl(value) {
  return isAbsoluteHttpUrlSection(value);
}

function normalizeApiPath(path) {
  return normalizeApiPathSection(path);
}

function joinApiUrl(base, path) {
  return joinApiUrlSection(base, path);
}

function isAdminModeEnabled() {
  return Boolean(state.adminToken);
}

function updateAdminModeUi() {
  if (!elements.adminTokenInput || !elements.adminModeNote) {
    return;
  }
  if (!state.adminModeAvailable) {
    elements.adminTokenInput.disabled = true;
    elements.enableAdminModeButton.disabled = true;
    elements.clearAdminModeButton.disabled = true;
    elements.adminModeNote.textContent = "当前服务器未启用管理员模式。";
    if (elements.copyTokenButton) {
      elements.copyTokenButton.classList.add("hidden");
    }
    if (elements.copyLoginGuideButton) {
      elements.copyLoginGuideButton.classList.add("hidden");
    }
    if (elements.refreshPairingButton) {
      elements.refreshPairingButton.classList.add("hidden");
    }
    if (elements.approveLatestPairingButton) {
      elements.approveLatestPairingButton.classList.add("hidden");
    }
    return;
  }
  elements.adminTokenInput.disabled = false;
  elements.enableAdminModeButton.disabled = false;
  elements.clearAdminModeButton.disabled = !isAdminModeEnabled();
  elements.adminModeNote.textContent = isAdminModeEnabled()
    ? "管理员模式已启用，可复制当前实例 Token。"
    : "当前未进入管理员模式。";
  if (elements.copyTokenButton) {
    elements.copyTokenButton.classList.toggle("hidden", !isAdminModeEnabled() || !state.selectedItem);
  }
  if (elements.copyLoginGuideButton) {
    elements.copyLoginGuideButton.classList.toggle("hidden", !isAdminModeEnabled() || !state.selectedItem);
  }
  if (elements.refreshPairingButton) {
    elements.refreshPairingButton.classList.toggle("hidden", !isAdminModeEnabled() || !state.selectedItem);
  }
  if (elements.approveLatestPairingButton) {
    elements.approveLatestPairingButton.classList.toggle("hidden", !isAdminModeEnabled() || !state.selectedItem);
  }
}

function setBusy(nextBusy) {
  state.busy = nextBusy;
  for (const button of document.querySelectorAll("button")) {
    button.disabled = nextBusy;
  }
}

function escapeHtml(value) {
  return escapeHtmlSection(value);
}

function formatRelativeTime(value) {
  return formatRelativeTimeSection(value);
}

function formatDateTime(value) {
  return formatDateTimeSection(value);
}

function formatMaybe(value) {
  return formatMaybeSection(value);
}

function instanceRuntimeLocation(item) {
  return instanceRuntimeLocationSection(item);
}

function instanceRuntimeChipLabel(item) {
  return instanceRuntimeChipLabelSection(item);
}

function instanceRuntimeDescription(item) {
  return instanceRuntimeDescriptionSection(item);
}

function setActiveTab(nextTab, { persist = true } = {}) {
  const tab = ["overview", "containers", "instances", "channels", "activity"].includes(nextTab)
    ? nextTab
    : "overview";
  state.activeTab = tab;
  if (persist) {
    localStorage.setItem(TAB_STORAGE_KEY, tab);
  }
  const tabButtons = elements.workspaceTabs?.querySelectorAll("[data-tab]") ?? [];
  for (const button of tabButtons) {
    const isActive = button.getAttribute("data-tab") === tab;
    button.classList.toggle("active", isActive);
  }
  const tabPages = document.querySelectorAll("[data-tab-page]");
  for (const page of tabPages) {
    const shouldShow = page.getAttribute("data-tab-page") === tab;
    page.classList.toggle("hidden", !shouldShow);
  }
  for (const note of elements.tabStatusNotes) {
    const shouldShow = note.getAttribute("data-tab-status") === tab;
    note.classList.toggle("hidden", !shouldShow);
  }
}

function buildFallbackContainerMeta(instances, error = null) {
  return buildFallbackContainerMetaSection(instances, error);
}

function findContainerByName(name) {
  return state.containers.find((item) => item.name === name || item.id === name) ?? null;
}

function isProvisionedConsoleContainer(container) {
  return container?.labels?.["ai.openclaw.shared-console"] === "managed";
}

function instanceApiBase(scope) {
  return instanceApiBaseSection(scope);
}

function instanceScopeLabel(scope) {
  return instanceScopeLabelSection(scope);
}

function aggregateCounts(usageSummary, key) {
  const totals = {};
  const record = usageSummary?.[key];
  if (!record || typeof record !== "object") {
    return totals;
  }
  for (const [entryKey, entryValue] of Object.entries(record)) {
    totals[entryKey] = Number(entryValue ?? 0);
  }
  return totals;
}

function buildOverviewUsageNote() {
  return buildOverviewUsageNoteSection(state, { formatDateTime });
}

function explainOutcome(key) {
  return explainOutcomeSection(key);
}

function explainRouteType(key) {
  return explainRouteTypeSection(key);
}

function explainRuleId(key) {
  return explainRuleIdSection(key);
}

function explainToolName(key) {
  return explainToolNameSection(key);
}

function explainToolAction(key) {
  return explainToolActionSection(key);
}

function explainHotspotValue(kind, key) {
  return explainHotspotValueSection(kind, key);
}

function probeHealthLabel(item) {
  if (!item?.probe) {
    return { label: "未检查", className: "" };
  }
  if (item.probe.error) {
    return { label: "检查失败", className: "chip-danger" };
  }
  if (item.probe.live && item.probe.ready) {
    return { label: "服务就绪", className: "chip-success" };
  }
  if (item.probe.live === false || item.probe.ready === false) {
    return { label: "待处理", className: "chip-danger" };
  }
  return { label: "待确认", className: "chip-warning" };
}

function processStateLabel(item) {
  return item?.process?.state === "running"
    ? { label: "运行中", className: "chip-success" }
    : { label: "未运行", className: "chip-warning" };
}

function statusKindLabel(kind) {
  return statusKindLabelSection(kind);
}

function describeInstanceAction(action) {
  return describeInstanceActionSection(action);
}

function describeContainerAction(action) {
  return describeContainerActionSection(action);
}

function buildWatchNote(item) {
  return buildWatchNoteSection(item, { instanceRuntimeLocation, formatMaybe });
}

function buildUiUrlWithOperatorScopes(baseUrl, scopes) {
  return buildUiUrlWithOperatorScopesSection(baseUrl, scopes);
}

function resolveUserInstanceUiScopes() {
  return resolveUserInstanceUiScopesSection(state.modelChannelCatalog);
}

function resolveInstanceUiUrl(scope, id, { userScoped = false } = {}) {
  return resolveInstanceUiUrlSection({
    scope,
    id,
    userScoped,
    apiBase: state.apiBase || "",
    origin: window.location.origin,
    instanceApiBase,
    joinApiUrl,
    resolveUserInstanceUiScopes: () => resolveUserInstanceUiScopes(),
    modelChannelCatalog: state.modelChannelCatalog,
  });
}

async function copyText(text, promptTitle) {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  window.prompt(promptTitle, text);
  return false;
}

function canOpenInstanceUi(item) {
  return canOpenInstanceUiSection(item);
}

function resetPairingState() {
  state.pairingInfo = null;
  state.pairingLoading = false;
  state.pairingError = "";
}

function resetUsageState() {
  state.selectedUsageLoading = false;
  state.selectedUsageSummary = null;
  state.selectedUsageCheckedAt = null;
  state.selectedUsageError = "";
}

async function fetchJson(path, options = {}) {
  const { adminAuth = false, headers: extraHeaders = {}, ...fetchOptions } = options;
  const response = await fetch(joinApiUrl(state.apiBase, path), {
    headers: {
      "Content-Type": "application/json",
      ...(adminAuth && state.adminToken
        ? {
            "X-Shared-Console-Admin-Token": state.adminToken,
          }
        : {}),
      ...extraHeaders,
    },
    ...fetchOptions,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error?.message || `${response.status} ${response.statusText}`.trim());
  }
  return payload;
}

async function loadModelChannelConfig({ announce = false } = {}) {
  return loadModelChannelConfigSection({
    state,
    announce,
    fetchJson,
    isAdminModeEnabled,
    ensureModelChannelCatalogShape,
    normalizeModelChannelSettingsForEditor,
    pushStatus,
  });
}

function buildModelChannelSettingsDraft() {
  const raw = elements.modelChannelsTextarea?.value?.trim() || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`JSON 解析失败：${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("模型渠道配置必须是 JSON 对象。");
  }
  return {
    ...parsed,
    userCanConfigureModels: Boolean(elements.userModelConfigCheckbox?.checked),
  };
}

function updateTabStatus(kind, title, detail = "", tab = state.activeTab) {
  const note = elements.tabStatusNotes.find((item) => item.getAttribute("data-tab-status") === tab);
  if (!note) {
    return;
  }
  note.classList.remove("success", "error");
  if (kind === "success") {
    note.classList.add("success");
  } else if (kind === "error") {
    note.classList.add("error");
  }
  note.textContent = `${title}${detail ? `：${detail}` : ""}`;
}

function pushStatus(kind, title, detail = "", tab = state.activeTab) {
  updateTabStatus(kind, title, detail, tab);
  const node = document.createElement("article");
  node.className = "status-item";
  node.innerHTML = `
    <div class="status-item-title">
      <strong>${escapeHtml(title)}</strong>
      <span class="chip ${kind === "error" ? "chip-danger" : kind === "success" ? "chip-success" : ""}">
        ${escapeHtml(statusKindLabel(kind))}
      </span>
    </div>
    <div class="status-item-meta">${escapeHtml(detail || formatDateTime(new Date().toISOString()))}</div>
  `;
  elements.statusFeed.prepend(node);
  while (elements.statusFeed.children.length > STATUS_LIMIT) {
    elements.statusFeed.removeChild(elements.statusFeed.lastElementChild);
  }
}

function renderSummary() {
  const cards = buildOverviewSummaryCardsSection(state, {
    instanceRuntimeLocation,
    formatMaybe,
    formatDateTime,
  });

  elements.summaryGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card">
          <span class="summary-label">${escapeHtml(card.label)}</span>
          <div class="summary-value">${escapeHtml(card.value)}</div>
          <div class="summary-subtext">${escapeHtml(card.subtext)}</div>
        </article>
      `,
    )
    .join("");
}

function renderWatchlist() {
  const flagged = state.instances
    .filter((item) => {
      if (item.process?.state !== "running") {
        return true;
      }
      if (item.probe?.error) {
        return true;
      }
      return item.probe?.live !== true || item.probe?.ready !== true;
    })
    .slice(0, 6);

  if (flagged.length === 0) {
    elements.watchlistPanel.innerHTML =
      '<div class="empty-state" style="min-height: 180px;">当前没有需要优先处理的实例。已经运行的实例都通过了检查，未运行实例也没有新的异常。</div>';
    return;
  }

  elements.watchlistPanel.innerHTML = flagged
    .map((item) => {
      const health = probeHealthLabel(item);
      const processState = processStateLabel(item);
      const note = buildWatchNote(item);
      return `
        <article class="watch-item" data-instance-id="${escapeHtml(item.id)}" data-instance-scope="shared">
          <div class="watch-item-title">
            <span>${escapeHtml(item.name || item.id)}</span>
            <span class="chip ${health.className || processState.className}">${escapeHtml(
              health.label === "未检查" ? processState.label : health.label,
            )}</span>
          </div>
          <div class="watch-item-meta">
            <span class="chip">${escapeHtml(item.id)}</span>
            <span class="chip ${processState.className}">${escapeHtml(processState.label)}</span>
            <span class="chip">端口 ${escapeHtml(formatMaybe(item.port))}</span>
          </div>
          <div class="watch-item-note">${escapeHtml(note)}</div>
        </article>
      `;
    })
    .join("");
}

function topEntries(record, limit = 6) {
  return topEntriesSection(record, limit);
}

function renderHotspots() {
  const sections = buildOverviewHotspotSectionsSection(state.overviewUsageSummary, {
    topEntries,
  });

  const intro = `
    <article class="hotspot-card">
      <div class="hotspot-title">这块表示什么</div>
      <div class="hotspot-note">
        这里看的不是某一个实例，而是所有共享实例合在一起后的最近情况。
        值班管理员和运营人员可以用它快速判断：最近大家主要在共享实例上做什么、最常被什么挡住、
        以及请求更多是在实例本地完成还是走共享执行通道。
      </div>
    </article>
  `;

  elements.hotspotPanel.innerHTML =
    intro +
    sections
      .map((section) => {
        const body = section.rows.length
          ? `
              <div class="hotspot-meta">
                ${section.rows
                  .map(
                    ([key, value]) => `
                      <span class="chip" title="${escapeHtml(key)}">${escapeHtml(
                        explainHotspotValue(section.kind, key),
                      )} · ${escapeHtml(value)}</span>
                    `,
                  )
                  .join("")}
              </div>
            `
          : `<div class="hotspot-note">${escapeHtml(section.empty)}</div>`;
        return `
          <article class="hotspot-card">
            <div class="hotspot-title">${escapeHtml(section.title)}</div>
            ${body}
          </article>
        `;
      })
      .join("");
}

function renderContainers() {
  const meta = state.containersMeta;
  if (!meta) {
    elements.containersPanel.innerHTML =
      '<div class="empty-state" style="min-height: 180px;">容器信息还没有加载出来。</div>';
    return;
  }

  if (!meta.available && state.containers.length === 0) {
    elements.containersPanel.innerHTML = `
      <div class="empty-state" style="min-height: 180px;">
        当前还拿不到 Docker 容器信息。${escapeHtml(meta.error || "请确认 Docker 已启动，并且当前账号有权限访问。")}
      </div>
    `;
    return;
  }

  if (state.containers.length === 0) {
    const message =
      meta.totalDockerContainers > 0
        ? "Docker 里有容器在运行，但当前还没有任何实例绑定到容器；这个面板只显示已被实例引用或声明过的容器。"
        : "当前还没有任何实例绑定到容器。";
    elements.containersPanel.innerHTML = `
      <div class="empty-state" style="min-height: 180px;">${escapeHtml(message)}</div>
    `;
    return;
  }

  elements.containersPanel.innerHTML = state.containers
    .map((container) => {
      const stateClass =
        container.state === "running"
          ? "chip-success"
          : container.state === "exited" || container.state === "missing"
            ? "chip-danger"
            : "chip-warning";
      const stateLabel =
        container.state === "running"
          ? "运行中"
          : container.state === "exited"
            ? "已停止"
            : container.state === "missing"
              ? "未发现"
              : formatMaybe(container.state);
      const attached =
        Array.isArray(container.attachedInstances) && container.attachedInstances.length > 0
          ? `
              <div class="container-card-instances">
                ${container.attachedInstances
                  .map(
                    (item) =>
                      `<span class="chip">${escapeHtml(item.name || item.id)} · ${escapeHtml(item.id)}</span>`,
                  )
                  .join("")}
              </div>
            `
          : '<div class="container-card-note">当前还没有实例明确绑定到这个容器。</div>';
      const canOperate =
        container.source === "docker" &&
        (((container.attachedInstances?.length ?? 0) > 0) || isProvisionedConsoleContainer(container));
      const actions =
        canOperate
          ? `
              <div class="container-card-actions">
                <button class="button" type="button" data-container-action="logs" data-container-name="${escapeHtml(container.name)}">查看日志</button>
                <button class="button button-primary" type="button" data-container-action="start" data-container-name="${escapeHtml(container.name)}">启动</button>
                <button class="button" type="button" data-container-action="stop" data-container-name="${escapeHtml(container.name)}">停止</button>
                <button class="button" type="button" data-container-action="restart" data-container-name="${escapeHtml(container.name)}">重启</button>
              </div>
            `
          : container.source === "docker"
            ? `
                <div class="container-card-note">
                  这个容器不是值班台创建的预备容器，当前也没有被任何实例绑定，所以这里只展示状态，不提供容器级操作。
                </div>
              `
          : `
              <div class="container-card-note">
                这个容器目前只是实例侧声明，Docker 里还没有发现对应实体，所以暂时不能直接操作。
              </div>
            `;
      return `
        <article class="container-card">
          <div class="container-card-title">
            <span>${escapeHtml(container.name)}</span>
            <span class="chip ${stateClass}">${escapeHtml(stateLabel)}</span>
          </div>
          <div class="container-card-meta">
            <span class="chip">镜像 ${escapeHtml(formatMaybe(container.image))}</span>
            <span class="chip">实例 ${escapeHtml(container.attachedInstances?.length ?? 0)} 个</span>
            <span class="chip">${escapeHtml(container.source === "docker" ? "来自 Docker" : "实例声明的容器")}</span>
          </div>
          <div class="container-card-note">${escapeHtml(container.status || "暂无额外状态说明")}</div>
          ${actions}
          ${attached}
        </article>
      `;
    })
    .join("");
}

function renderContainerNameOptions() {
  if (!elements.containerNameOptions) {
    return;
  }
  const names = state.containers
    .map((container) => container?.name)
    .filter((value, index, array) => typeof value === "string" && value && array.indexOf(value) === index)
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
  elements.containerNameOptions.innerHTML = names
    .map((name) => `<option value="${escapeHtml(name)}"></option>`)
    .join("");
}

function renderModelChannelSelect(select, selectedValue) {
  if (!select) {
    return;
  }
  const options = [
    `<option value="">不映射全局渠道</option>`,
    ...state.modelChannelCatalog.channels.map(
      (channel) =>
        `<option value="${escapeHtml(channel.id)}"${channel.id === selectedValue ? " selected" : ""}>${escapeHtml(
          formatModelChannelLabel(channel.id),
        )}</option>`,
    ),
  ];
  if (
    selectedValue &&
    !state.modelChannelCatalog.channels.some((channel) => channel.id === selectedValue)
  ) {
    options.push(
      `<option value="${escapeHtml(selectedValue)}" selected>${escapeHtml(
        `${selectedValue}（已不存在）`,
      )}</option>`,
    );
  }
  select.innerHTML = options.join("");
}

function renderModelChannelSelects() {
  renderModelChannelSelect(elements.createModelChannelSelect, "");
  renderModelChannelSelect(elements.detailModelChannelSelect, state.selectedItem?.modelChannelId || "");
}

function renderModelChannelsPanel() {
  return renderModelChannelsPanelSection({
    state,
    elements,
    isAdminModeEnabled,
    defaultModelChannelSettings,
    ensureModelChannelGenerateCardsInitialized,
    setModelChannelGenerateCardsDisabled,
  });
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
  elements.userModelConfigCheckbox.checked = Boolean(
    state.modelChannelSettings?.userCanConfigureModels ?? state.modelChannelCatalog.userCanConfigureModels,
  );
  if (!elements.modelChannelsTextarea.value || adminEnabled) {
    elements.modelChannelsTextarea.value =
      state.modelChannelSettingsText || JSON.stringify(settings, null, 2);
  }
  elements.userModelConfigCheckbox.disabled = !adminEnabled;
  elements.modelChannelsTextarea.disabled = !adminEnabled;
  elements.reloadModelChannelsButton.disabled = !adminEnabled;
  elements.saveModelChannelsButton.disabled = !adminEnabled;
  if (!state.adminModeAvailable) {
    elements.modelChannelsPanel.textContent = "当前服务端未启用管理员模式，无法管理全局模型渠道。";
    return;
  }
  if (!adminEnabled) {
    elements.modelChannelsPanel.textContent =
      "进入管理员模式后，可统一维护多个模型渠道，并决定用户是否允许自己配置模型。";
    return;
  }
  elements.modelChannelsPanel.textContent = `当前共 ${state.modelChannelCatalog.channels.length} 个渠道；用户自配模型：${
    state.modelChannelCatalog.userCanConfigureModels ? "开启" : "关闭"
  }。保存全局渠道后，已映射实例的配置文件会同步更新；运行中的实例需要重启后生效。`;
}

function syncCreateFormConstraints() {
  const pool = elements.createPoolSelect?.value === "dedicated" ? "dedicated" : "shared";
  if (!elements.createRuntimeKindSelect) {
    return;
  }
  if (pool === "shared") {
    elements.createRuntimeKindSelect.value = "container";
    elements.createRuntimeKindSelect.disabled = true;
    if (elements.createRuntimeKindNote) {
      elements.createRuntimeKindNote.textContent =
        "共享实例固定运行在已有容器里，多个共享实例可绑定到同一个容器。";
    }
    return;
  }
  elements.createRuntimeKindSelect.disabled = false;
  if (elements.createRuntimeKindNote) {
    elements.createRuntimeKindNote.textContent =
      "单独实例可按需选择已有容器或宿主机运行。";
  }
}

function normalizeBindModeInput(value) {
  return normalizeBindModeInputSection(value);
}

function renderContainerLogs() {
  const selectedContainer = state.selectedContainerName ? findContainerByName(state.selectedContainerName) : null;
  if (!state.selectedContainerName) {
    elements.containerLogsPanel.classList.add("empty-state");
    elements.containerLogsPanel.innerHTML = "选一个容器查看最近日志，或直接在容器卡片上执行启动、停止、重启。";
    return;
  }
  const headline = selectedContainer ? selectedContainer.name : state.selectedContainerName;
  const note = selectedContainer
    ? `最近 ${state.containerLogsTail} 行，状态：${selectedContainer.state || "未知"}`
    : `最近 ${state.containerLogsTail} 行，容器信息还没有重新加载出来`;
  const text = state.containerLogsText?.trim() || "当前还没有拿到日志内容。";
  elements.containerLogsPanel.classList.remove("empty-state");
  elements.containerLogsPanel.innerHTML = `
    <article class="container-log-card">
      <div class="container-card-title">
        <span>容器日志 · ${escapeHtml(headline)}</span>
        <span class="chip">${escapeHtml(note)}</span>
      </div>
      <pre class="container-log-output">${escapeHtml(text)}</pre>
    </article>
  `;
}

function renderInstancesList() {
  const filter = state.filter.trim().toLowerCase();
  const items = state.instances.filter((item) => {
    if (!filter) {
      return true;
    }
    return [item.id, item.name, item.probe?.version]
      .filter(Boolean)
      .some((part) => String(part).toLowerCase().includes(filter));
  });

  if (items.length === 0) {
    elements.instancesList.innerHTML =
      '<div class="empty-state" style="min-height: 220px;">没有匹配的共享实例，试试清空过滤条件。</div>';
    return;
  }

  elements.instancesList.innerHTML = items
    .map((item) => {
      const health = probeHealthLabel(item);
      const processState = processStateLabel(item);
      return `
        <article class="instance-card ${item.id === state.selectedId && state.selectedScope === "shared" ? "active" : ""}" data-instance-id="${escapeHtml(item.id)}" data-instance-scope="shared">
          <div class="instance-card-title">
            <span>${escapeHtml(item.name || item.id)}</span>
            <span class="chip ${processState.className}">${escapeHtml(processState.label)}</span>
          </div>
          <div class="instance-card-meta">
            <span class="chip">${escapeHtml(item.id)}</span>
            <span class="chip ${health.className}">${escapeHtml(health.label)}</span>
            <span class="chip">端口 ${escapeHtml(formatMaybe(item.port))}</span>
          </div>
          <div class="instance-card-tags">
            <span class="chip">共享实例</span>
            <span class="chip">${escapeHtml(instanceRuntimeChipLabel(item))}</span>
            <span class="chip">版本 ${escapeHtml(formatMaybe(item.probe?.version))}</span>
            <span class="chip">${escapeHtml(formatRelativeTime(item.probe?.checkedAt || item.timestamps?.updatedAt))}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderDedicatedInstancesList() {
  const items = state.dedicatedInstances;
  if (items.length === 0) {
    elements.dedicatedInstancesList.innerHTML =
      '<div class="empty-state" style="min-height: 220px;">当前还没有发现单独实例。后续把单间虾纳入目录后，这里就会显示。</div>';
    return;
  }

  elements.dedicatedInstancesList.innerHTML = items
    .map((item) => {
      const health = probeHealthLabel(item);
      const processState = processStateLabel(item);
      return `
        <article class="instance-card ${item.id === state.selectedId && state.selectedScope === "dedicated" ? "active" : ""}" data-instance-id="${escapeHtml(item.id)}" data-instance-scope="dedicated">
          <div class="instance-card-title">
            <span>${escapeHtml(item.name || item.id)}</span>
            <span class="chip ${processState.className}">${escapeHtml(processState.label)}</span>
          </div>
          <div class="instance-card-meta">
            <span class="chip">${escapeHtml(item.id)}</span>
            <span class="chip ${health.className}">${escapeHtml(health.label)}</span>
            <span class="chip">端口 ${escapeHtml(formatMaybe(item.port))}</span>
          </div>
          <div class="instance-card-tags">
            <span class="chip">单独实例</span>
            <span class="chip">${escapeHtml(instanceRuntimeChipLabel(item))}</span>
            <span class="chip">版本 ${escapeHtml(formatMaybe(item.probe?.version))}</span>
            <span class="chip">${escapeHtml(formatRelativeTime(item.probe?.checkedAt || item.timestamps?.updatedAt))}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderMetaGrid(item) {
  return renderMetaGridSection({
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
  });
  const entries = [
    ["实例类型", instanceScopeLabel(state.selectedScope)],
    ["实例 ID", item.id],
    ["显示名称", item.name],
    ["运行状态", item.process?.state === "running" ? "运行中" : "未运行"],
    ["运行位置", instanceRuntimeLocation(item) === "container" ? "容器中运行" : "宿主机运行"],
    [
      "所属容器",
      instanceRuntimeLocation(item) === "container"
        ? item.runtime?.containerName || "容器名称未写入"
        : "当前未放入容器",
    ],
    ["当前进程 PID", item.process?.pid],
    ["监听地址", item.bind],
    ["端口", item.port],
    ["运行档案名", item.profile],
    ["实例模板", item.template],
    ["配置文件", item.paths?.configPath],
    ["运行数据目录", item.paths?.stateDir],
    ["日志目录", item.paths?.logDir],
    ["创建时间", formatDateTime(item.timestamps?.createdAt)],
    ["最近更新时间", formatDateTime(item.timestamps?.updatedAt)],
    ["当前版本", item.probe?.version],
    ["运行说明", instanceRuntimeDescription(item)],
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

function buildDiagnosticsNote(item) {
  return buildDiagnosticsNoteSection({ state, item, escapeHtml, formatRelativeTime });
}

function renderProbeGrid(item) {
  return renderProbeGridSection({
    state,
    elements,
    item,
    escapeHtml,
    formatDateTime,
    buildDiagnosticsNote,
  });
}

function buildUsageTable(title, rows) {
  if (!rows.length) {
    return `
      <section class="usage-table">
        <h4 class="usage-table-title">${escapeHtml(title)}</h4>
        <table><tbody><tr><td>暂时没有可展示的数据</td><td>0</td></tr></tbody></table>
      </section>
    `;
  }
  return `
    <section class="usage-table">
      <h4 class="usage-table-title">${escapeHtml(title)}</h4>
      <table>
        <tbody>
          ${rows
            .map(
              ([key, value]) => `
                <tr>
                  <td><code>${escapeHtml(key)}</code></td>
                  <td>${escapeHtml(value)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderUsageSummary(item) {
  return renderUsageSummarySection({
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
  });
}

function renderPairingSummary() {
  return renderPairingSummarySection({
    elements,
    state,
    escapeHtml,
    isAdminModeEnabled,
  });
}

function renderDetailEmptyState() {
  return renderDetailEmptyStateSection({
    elements,
    renderPairingSummary,
    updateAdminModeUi,
  });
}

function renderDetailActionState(item) {
  return renderDetailActionStateSection({
    elements,
    state,
    item,
    canOpenInstanceUi,
    instanceRuntimeLocation,
    isAdminModeEnabled,
  });
}

function renderDetailContentSections(item) {
  return renderDetailContentSectionsSection({
    elements,
    item,
    renderMetaGrid,
    renderPairingSummary,
    renderProbeGrid,
    renderUsageSummary,
    updateAdminModeUi,
  });
}


function renderDetail() {
  return renderDetailSection({
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
  });
}

function renderAll() {
  renderSummary();
  renderWatchlist();
  renderHotspots();
  renderContainers();
  renderContainerNameOptions();
  renderModelChannelSelects();
  renderModelChannelsPanel();
  renderContainerLogs();
  renderInstancesList();
  renderDedicatedInstancesList();
  renderDetail();
}

function updateConnectionNote(message, isError = false) {
  elements.connectionNote.textContent = message;
  elements.connectionNote.style.color = isError ? "var(--danger)" : "var(--text-soft)";
}

async function loadInstanceDetail(scope, id, announce = true) {
  return loadInstanceDetailSection({
    state,
    scope,
    id,
    announce,
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
  });
}

async function loadInstanceDiagnostics(scope, id, requestToken = state.detailRequestToken) {
  return loadInstanceDiagnosticsSection({
    state,
    scope,
    id,
    requestToken,
    fetchJson,
    instanceApiBase,
    applySelectedInstanceDiagnostics,
    buildDiagnosticsFailureProbe,
    isCurrentDetailRequest,
    renderDetail,
  });
}

async function loadInstanceUsageSummary(scope, id, requestToken = state.detailRequestToken) {
  return loadInstanceUsageSummarySection({
    state,
    scope,
    id,
    requestToken,
    fetchJson,
    instanceApiBase,
    applySelectedInstanceUsageSummary,
    buildUsageSummaryFailureResult,
    isCurrentDetailRequest,
    renderDetail,
  });
}

async function loadOverviewUsageSummary() {
  state.overviewUsageLoading = true;
  state.overviewUsageError = "";
  try {
    const payload = await fetchJson("/api/instances/usage-summary");
    state.overviewUsageSummary = payload?.item?.usageSummary ?? null;
    state.overviewUsageCheckedAt = payload?.item?.checkedAt ?? null;
    state.overviewUsageInstanceCount = Number(payload?.item?.instanceCount ?? state.sharedInstances.length ?? 0);
    state.overviewUsageReportedInstanceCount = Number(
      payload?.item?.reportedInstanceCount ?? (state.overviewUsageSummary ? state.sharedInstances.length : 0),
    );
  } catch (error) {
    state.overviewUsageSummary = null;
    state.overviewUsageCheckedAt = null;
    state.overviewUsageError = error.message;
    state.overviewUsageInstanceCount = state.sharedInstances.length;
    state.overviewUsageReportedInstanceCount = 0;
  } finally {
    state.overviewUsageLoading = false;
  }
}

async function loadInstances({ preserveSelection = true } = {}) {
  return loadInstancesSection({
    state,
    preserveSelection,
    setBusy,
    fetchJson,
    isAdminModeEnabled,
    buildFallbackContainerMeta,
    ensureModelChannelCatalogShape,
    normalizeModelChannelSettingsForEditor,
    loadInstanceDetail,
    loadOverviewUsageSummary,
    configurePairingAutoRefresh,
    updateConnectionNote,
    formatDateTime,
    renderAll,
    pushStatus,
  });
}

async function runInstanceAction(action) {
  if (!state.selectedId) {
    return;
  }
  if (instanceRuntimeLocation(state.selectedItem) === "container") {
    pushStatus(
      "error",
      `${describeInstanceAction(action)} ${state.selectedId} 失败`,
      "这个实例被标记为容器目标实例，请改用容器卡片操作，而不是宿主机实例按钮。",
    );
    return;
  }
  const actionLabel = describeInstanceAction(action);
  setBusy(true);
  try {
    const payload = await fetchJson(`${instanceApiBase(state.selectedScope)}/${encodeURIComponent(state.selectedId)}/${action}`, {
      method: "POST",
    });
    pushStatus("success", `${actionLabel} ${state.selectedId} 成功`, payload.command?.stdout || "操作完成");
    await loadInstances();
  } catch (error) {
    pushStatus("error", `${actionLabel} ${state.selectedId} 失败`, error.message);
    updateConnectionNote(`${actionLabel} 失败：${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

async function runSelectedInstanceAction(action) {
  if (!state.selectedId) {
    return;
  }
  const actionLabel = describeInstanceAction(action);
  setBusy(true);
  try {
    const payload = await fetchJson(
      `${instanceApiBase(state.selectedScope)}/${encodeURIComponent(state.selectedId)}/${action}`,
      {
        method: "POST",
      },
    );
    pushStatus("success", `${actionLabel} ${state.selectedId} 成功`, payload.command?.stdout || "操作完成");
    await loadInstances();
  } catch (error) {
    pushStatus("error", `${actionLabel} ${state.selectedId} 失败`, error.message);
    updateConnectionNote(`${actionLabel} 失败：${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

function openSelectedInstanceUi() {
  if (!state.selectedItem || !state.selectedId) {
    return;
  }
  if (!canOpenInstanceUi(state.selectedItem)) {
    pushStatus("error", "打开 UI 失败", "实例尚未运行，先启动实例再打开 UI。");
    return;
  }
  const url = resolveInstanceUiUrl(state.selectedScope, state.selectedId);
  window.open(url, "_blank", "noopener,noreferrer");
  pushStatus("info", `已打开 ${state.selectedId} UI`, url);
}

async function copySelectedInstanceUiLink() {
  if (!state.selectedItem || !state.selectedId) {
    return;
  }
  if (!canOpenInstanceUi(state.selectedItem)) {
    pushStatus("error", "复制 UI 链接失败", "实例尚未运行，先启动实例再复制 UI 链接。");
    return;
  }
  const url = resolveInstanceUiUrl(state.selectedScope, state.selectedId, { userScoped: true });
  const copied = await copyText(url, `复制 ${state.selectedId} UI 链接`);
  pushStatus(copied ? "success" : "info", `已复制 ${state.selectedId} UI 链接`, url);
}

async function enableAdminMode() {
  return enableAdminModeSection({
    state,
    elements,
    fetchJson,
    updateAdminModeUi,
    loadInstances,
    pushStatus,
    sessionStorageRef: sessionStorage,
    adminTokenStorageKey: ADMIN_TOKEN_STORAGE_KEY,
  });
}

function clearAdminMode() {
  return clearAdminModeSection({
    state,
    elements,
    resetPairingState,
    updateAdminModeUi,
    renderAll,
    loadInstances,
    pushStatus,
    sessionStorageRef: sessionStorage,
    adminTokenStorageKey: ADMIN_TOKEN_STORAGE_KEY,
  });
}

async function loadSelectedInstancePairing({ announce = true, requestToken = state.detailRequestToken } = {}) {
  return loadSelectedInstancePairingSection({
    state,
    announce,
    requestToken,
    resetPairingState,
    renderPairingSummary,
    isAdminModeEnabled,
    fetchJson,
    instanceApiBase,
    isCurrentDetailRequest,
    pushStatus,
    renderDetail,
  });
}

async function approveLatestSelectedInstancePairing() {
  return approveLatestSelectedInstancePairingSection({
    state,
    isAdminModeEnabled,
    canOpenInstanceUi,
    pushStatus,
    renderDetail,
    fetchJson,
    instanceApiBase,
  });
}

async function copySelectedInstanceToken() {
  if (!state.selectedItem || !state.selectedId) {
    return;
  }
  if (!isAdminModeEnabled()) {
    pushStatus("error", "复制失败", "请先进入管理员模式。");
    return;
  }
  const payload = await fetchJson(`${instanceApiBase(state.selectedScope)}/${encodeURIComponent(state.selectedId)}/token`, {
    adminAuth: true,
  });
  const token = payload?.item?.token;
  if (typeof token !== "string" || !token) {
    throw new Error("当前实例没有可复制的 Token。");
  }
  const copied = await copyText(token, `复制 ${state.selectedId} Token`);
  pushStatus(copied ? "success" : "info", copied ? `已复制 ${state.selectedId} Token` : `已显示 ${state.selectedId} Token`);
}

async function copySelectedInstanceLoginGuide() {
  if (!state.selectedItem || !state.selectedId) {
    return;
  }
  if (!isAdminModeEnabled()) {
    pushStatus("error", "复制登录说明失败", "请先进入管理员模式。");
    return;
  }
  if (!canOpenInstanceUi(state.selectedItem)) {
    pushStatus("error", "复制登录说明失败", "实例尚未运行，先启动实例再复制登录说明。");
    return;
  }
  const payload = await fetchJson(`${instanceApiBase(state.selectedScope)}/${encodeURIComponent(state.selectedId)}/token`, {
    adminAuth: true,
  });
  const token = payload?.item?.token;
  if (typeof token !== "string" || !token) {
    throw new Error("当前实例没有可复制的 Token。");
  }
  const uiUrl = resolveInstanceUiUrl(state.selectedScope, state.selectedId, { userScoped: true });
  const guide = [
    `实例：${state.selectedItem.name || state.selectedId}`,
    `实例 ID：${state.selectedId}`,
    `UI 地址：${uiUrl}`,
    `登录 Token：${token}`,
    "",
    "使用步骤：",
    "1. 打开上面的 UI 地址。",
    "2. 如果页面先要求站点账号密码，先完成站点登录；若你没有这组账号密码，请向管理员索取。",
    "3. 进入页面右上角 Control UI 设置。",
    "4. 把上面的登录 Token 粘贴进去，再点击连接。",
    "5. 如果首次连接后提示 pairing required，请联系管理员在值班台批准该设备配对。",
  ].join("\n");
  const copied = await copyText(guide, `复制 ${state.selectedId} 登录说明`);
  pushStatus(copied ? "success" : "info", `已复制 ${state.selectedId} 登录说明`);
}

async function loadContainerLogs(containerName, { announce = true } = {}) {
  state.selectedContainerName = containerName;
  state.containerLogsText = "正在加载日志...";
  renderContainerLogs();
  try {
    const payload = await fetchJson(
      `/api/containers/${encodeURIComponent(containerName)}/logs?tail=${encodeURIComponent(state.containerLogsTail)}`,
    );
    state.selectedContainerName = payload.item?.name || containerName;
    state.containerLogsText = payload.logs?.text || "当前没有返回日志内容。";
    if (announce) {
      pushStatus("info", `已加载容器日志 ${state.selectedContainerName}`, `最近 ${payload.logs?.tail || state.containerLogsTail} 行`);
    }
    renderContainerLogs();
  } catch (error) {
    state.containerLogsText = error.message;
    renderContainerLogs();
    pushStatus("error", `查看容器日志失败 ${containerName}`, error.message);
    updateConnectionNote(`容器日志加载失败：${error.message}`, true);
  }
}

async function runContainerAction(action, containerName) {
  const actionLabel = describeContainerAction(action);
  setBusy(true);
  try {
    const payload = await fetchJson(`/api/containers/${encodeURIComponent(containerName)}/${action}`, {
      method: "POST",
    });
    pushStatus(
      "success",
      `${actionLabel} 容器 ${containerName} 成功`,
      payload.command?.stdout || payload.command?.stderr || "操作完成",
    );
    await loadInstances();
    await loadContainerLogs(payload.item?.name || containerName, { announce: false });
  } catch (error) {
    pushStatus("error", `${actionLabel} 容器 ${containerName} 失败`, error.message);
    updateConnectionNote(`${actionLabel} 容器失败：${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

async function handleCreateSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const body = Object.fromEntries(
    [...formData.entries()].filter(
      ([, value]) =>
        typeof value === "string" ? String(value).trim() !== "" : true,
    ),
  );
  const pool = body.pool === "dedicated" ? "dedicated" : "shared";
  const runtimeKind =
    pool === "shared" ? "container" : body.runtimeKind === "container" ? "container" : "host";
  body.runtimeKind = runtimeKind;
  body.bind = normalizeBindModeInput(body.bind);
  if (!String(body.id || "").trim()) {
    pushStatus("error", "新增实例失败", "实例 ID 不能为空。");
    return;
  }
  if (runtimeKind === "container" && !String(body.containerName || "").trim() && !String(body.containerId || "").trim()) {
    pushStatus("error", "新增实例失败", "部署位置选了已有容器时，至少要填写目标容器名或容器 ID。");
    return;
  }

  setBusy(true);
  try {
    const payload = await fetchJson(instanceApiBase(pool), {
      method: "POST",
      body: JSON.stringify(body),
    });
    pushStatus(
      "success",
      `新增${instanceScopeLabel(pool)} ${payload.item?.id} 成功`,
      payload.command?.stdout || "实例已写入",
    );
    form.reset();
    syncCreateFormConstraints();
    state.selectedScope = pool;
    state.selectedId = payload.item?.id ?? null;
    await loadInstances({ preserveSelection: false });
  } catch (error) {
    pushStatus("error", "新增实例失败", error.message);
    updateConnectionNote(`新增失败：${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

async function handleCreateContainerSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const rawBody = Object.fromEntries(
    [...formData.entries()].filter(
      ([, value]) => (typeof value === "string" ? String(value).trim() !== "" : true),
    ),
  );
  const baseName = String(rawBody.namePrefix || "").trim();
  const count = Math.max(1, Number.parseInt(String(rawBody.count || "1"), 10) || 1);
  if (!baseName) {
    pushStatus("error", "创建容器失败", "容器名 / 前缀不能为空。");
    return;
  }

  const body =
    count > 1
      ? {
          namePrefix: baseName,
          count,
          image: rawBody.image,
          command: rawBody.command,
          pullMissing: true,
        }
      : {
          name: baseName,
          image: rawBody.image,
          command: rawBody.command,
          pullMissing: true,
        };

  setBusy(true);
  try {
    const payload = await fetchJson("/api/containers", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const createdNames = (payload.items ?? []).map((item) => item.name).filter(Boolean);
    pushStatus(
      "success",
      `创建容器成功 ${createdNames.length || payload.request?.names?.length || count} 个`,
      createdNames.join(", ") || payload.command?.stdout || "容器已创建",
    );
    form.reset();
    await loadInstances({ preserveSelection: true });
    if (createdNames[0]) {
      await loadContainerLogs(createdNames[0], { announce: false });
    }
  } catch (error) {
    pushStatus("error", "创建容器失败", error.message);
    updateConnectionNote(`创建容器失败：${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

async function handleRenameSubmit(event) {
  event.preventDefault();
  if (!state.selectedId) {
    return;
  }
  const nextName = elements.renameInput.value.trim();
  if (!nextName) {
    pushStatus("error", "实例改名失败", "名称不能为空");
    return;
  }

  setBusy(true);
  try {
    await fetchJson(`${instanceApiBase(state.selectedScope)}/${encodeURIComponent(state.selectedId)}`, {
      method: "PATCH",
      body: JSON.stringify({ name: nextName }),
    });
    pushStatus("success", `实例 ${state.selectedId} 已改名`, nextName);
    await loadInstances();
  } catch (error) {
    pushStatus("error", "实例改名失败", error.message);
  } finally {
    setBusy(false);
  }
}

function syncSelectionToHash() {
  if (!state.selectedId) {
    history.replaceState(null, "", "#");
    return;
  }
  const nextHash = `#${state.selectedScope}/${encodeURIComponent(state.selectedId)}`;
  if (window.location.hash !== nextHash) {
    history.replaceState(null, "", nextHash);
  }
}

async function hydrateSelectionFromHash() {
  const match = window.location.hash.match(/^#(shared|dedicated|instance)\/(.+)$/);
  if (!match) {
    return;
  }
  state.selectedScope = match[1] === "dedicated" ? "dedicated" : "shared";
  state.selectedId = decodeURIComponent(match[2]);
}

function configureAutoRefresh(enabled) {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
  localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, enabled ? "1" : "0");
  if (enabled) {
    state.timerId = window.setInterval(() => {
      void loadInstances();
    }, AUTO_REFRESH_INTERVAL_MS);
  }
}

function configurePairingAutoRefresh(enabled) {
  if (state.pairingTimerId) {
    clearInterval(state.pairingTimerId);
    state.pairingTimerId = null;
  }
  if (enabled && state.selectedId && isAdminModeEnabled()) {
    state.pairingTimerId = window.setInterval(() => {
      void loadSelectedInstancePairing({ announce: false }).catch(() => {
        // Ignore polling failures; the next pass will retry.
      });
    }, PAIRING_REFRESH_INTERVAL_MS);
  }
}

async function applyApiBase(nextApiBase) {
  const normalized = normalizeApiBase(nextApiBase);
  if (!normalized) {
    pushStatus("error", "连接失败", "API 地址不能为空");
    return;
  }
  state.apiBase = normalized;
  localStorage.setItem(API_BASE_STORAGE_KEY, normalized);
  elements.apiBaseInput.value = normalized;
  await loadInstances({ preserveSelection: true });
}

function bindInstanceSelection(container, failureTitle) {
  container.addEventListener("click", (event) => {
    const card = event.target.closest("[data-instance-id]");
    if (!card) {
      return;
    }
    void (async () => {
      setBusy(true);
      try {
        await loadInstanceDetail(card.dataset.instanceScope || "shared", card.dataset.instanceId);
        syncSelectionToHash();
        renderAll();
      } catch (error) {
        pushStatus("error", failureTitle, error.message);
      } finally {
        setBusy(false);
      }
    })();
  });
}

function bindEvents() {
  elements.workspaceTabs?.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const button = event.target.closest("[data-tab]");
    if (!(button instanceof HTMLElement)) {
      return;
    }
    const tab = button.getAttribute("data-tab");
    if (!tab) {
      return;
    }
    setActiveTab(tab);
  });
  for (const tabButton of elements.workspaceTabs?.querySelectorAll("[data-tab]") ?? []) {
    tabButton.addEventListener("click", () => {
      const tab = tabButton.getAttribute("data-tab");
      if (!tab) {
        return;
      }
      setActiveTab(tab);
    });
  }
  elements.applyApiBaseButton.addEventListener("click", () => {
    void applyApiBase(elements.apiBaseInput.value);
  });
  elements.enableAdminModeButton.addEventListener("click", () => {
    void enableAdminMode().catch((error) => {
      pushStatus("error", "管理员模式启用失败", error.message);
    });
  });
  elements.clearAdminModeButton.addEventListener("click", () => {
    clearAdminMode();
  });
  elements.refreshButton.addEventListener("click", () => {
    void loadInstances();
  });
  elements.filterInput.addEventListener("input", (event) => {
    state.filter = event.currentTarget.value;
    renderInstancesList();
  });
  elements.createPoolSelect.addEventListener("change", () => {
    syncCreateFormConstraints();
  });
  bindInstanceSelection(elements.instancesList, "加载实例详情失败");
  bindInstanceSelection(elements.watchlistPanel, "加载关注实例失败");
  bindInstanceSelection(elements.dedicatedInstancesList, "加载单独实例详情失败");
  elements.containersPanel.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-container-action]");
    if (!actionButton) {
      return;
    }
    const containerName = actionButton.dataset.containerName;
    const action = actionButton.dataset.containerAction;
    if (!containerName || !action) {
      return;
    }
    if (action === "logs") {
      void loadContainerLogs(containerName);
      return;
    }
    void runContainerAction(action, containerName);
  });
  elements.createForm.addEventListener("submit", (event) => {
    void handleCreateSubmit(event);
  });
  elements.createForm.addEventListener(
    "invalid",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const fieldLabel =
        target.closest("label")?.querySelector("span")?.textContent?.trim() || target.getAttribute("name") || "字段";
      const validationMessage = "validationMessage" in target ? String(target.validationMessage || "") : "";
      pushStatus("error", "新增实例失败", `${fieldLabel} 校验未通过${validationMessage ? `：${validationMessage}` : "。"} `);
    },
    true,
  );
  elements.createForm.addEventListener("reset", () => {
    window.setTimeout(() => {
      syncCreateFormConstraints();
    }, 0);
  });
  elements.createContainerForm.addEventListener("submit", (event) => {
    void handleCreateContainerSubmit(event);
  });
  elements.renameForm.addEventListener("submit", (event) => {
    void handleRenameSubmit(event);
  });
  elements.openUiButton.addEventListener("click", () => {
    openSelectedInstanceUi();
  });
  elements.copyUiLinkButton.addEventListener("click", () => {
    void copySelectedInstanceUiLink().catch((error) => {
      pushStatus("error", "复制 UI 链接失败", error.message);
    });
  });
  elements.refreshPairingButton.addEventListener("click", () => {
    void loadSelectedInstancePairing().catch((error) => {
      pushStatus("error", "刷新配对失败", error.message);
    });
  });
  elements.approveLatestPairingButton.addEventListener("click", () => {
    void approveLatestSelectedInstancePairing().catch((error) => {
      pushStatus("error", "批准最新配对失败", error.message);
    });
  });
  elements.copyLoginGuideButton.addEventListener("click", () => {
    void copySelectedInstanceLoginGuide().catch((error) => {
      pushStatus("error", "复制登录说明失败", error.message);
    });
  });
  elements.copyTokenButton.addEventListener("click", () => {
    void copySelectedInstanceToken().catch((error) => {
      pushStatus("error", "复制 Token 失败", error.message);
    });
  });
  elements.startButton.addEventListener("click", () => {
    void runSelectedInstanceAction("start");
  });
  elements.stopButton.addEventListener("click", () => {
    void runSelectedInstanceAction("stop");
  });
  elements.restartButton.addEventListener("click", () => {
    void runSelectedInstanceAction("restart");
  });
  elements.autoRefreshCheckbox.addEventListener("change", (event) => {
    configureAutoRefresh(event.currentTarget.checked);
  });
  window.addEventListener("hashchange", () => {
    void hydrateSelectionFromHash().then(() => loadInstances());
  });
}

async function loadRuntimeConfig() {
  try {
    const response = await fetch("./config.json", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    window.__SHARED_CONSOLE_CONFIG__ = await response.json();
  } catch {
    window.__SHARED_CONSOLE_CONFIG__ = {};
  }
}

function buildModelChannelGeneratorBaseSettings() {
  return elements.modelChannelsTextarea?.value?.trim()
    ? buildModelChannelSettingsDraft()
    : state.modelChannelSettings || defaultModelChannelSettings();
}

function splitModelChannelGeneratorList(value) {
  return splitModelChannelGeneratorListSection(value);
}

function buildModelChannelGeneratorSharedOptions() {
  return buildModelChannelGeneratorSharedOptionsSection(elements);
}

function buildSingleModelChannelGeneratorPayload(baseSettings) {
  return buildSingleModelChannelGeneratorPayloadSection(baseSettings, elements);
}

function getModelChannelGenerateCards() {
  return getModelChannelGenerateCardsSection(elements);
}

function renumberModelChannelGenerateCards() {
  return renumberModelChannelGenerateCardsSection(elements);
}

function buildModelChannelGenerateCardDefaultValues() {
  return buildModelChannelGenerateCardDefaultValuesSection(elements);
}

function appendModelChannelGenerateCard(values = {}) {
  return appendModelChannelGenerateCardSection(elements, document, escapeHtml, values);
}

function clearModelChannelGenerateCards({ keepOneBlank = true } = {}) {
  return clearModelChannelGenerateCardsSection(elements, document, escapeHtml, { keepOneBlank });
}

function ensureModelChannelGenerateCardsInitialized() {
  return ensureModelChannelGenerateCardsInitializedSection(elements, document, escapeHtml);
}

function readModelChannelGenerateCardField(card, field) {
  return readModelChannelGenerateCardFieldSection(card, field);
}

function collectBatchCardModelChannelGenerators() {
  return collectBatchCardModelChannelGeneratorsSection(elements);
}

function setModelChannelGenerateCardsDisabled(disabled) {
  return setModelChannelGenerateCardsDisabledSection(elements, disabled);
}

function parseBatchModelChannelGenerators(raw) {
  return parseBatchModelChannelGeneratorsSection(raw, elements);
}

function importBatchModelChannelGeneratorsAsCards(raw) {
  return importBatchModelChannelGeneratorsAsCardsSection(elements, document, escapeHtml, raw);
}

function formatModelChannelSaveDetail(payload) {
  const restartRequired = Array.isArray(payload?.meta?.restartRequired) ? payload.meta.restartRequired : [];
  const unassignedInstances = Array.isArray(payload?.meta?.unassignedInstances) ? payload.meta.unassignedInstances : [];
  const detailParts = [];
  if (unassignedInstances.length > 0) {
    detailParts.push(`Auto-unmapped: ${unassignedInstances.map((item) => item.id).join(", ")}`);
  }
  detailParts.push(
    restartRequired.length > 0
      ? `Restart required: ${restartRequired.join(", ")}`
      : "No running mapped instance requires restart.",
  );
  return detailParts.join(" ");
}

async function updateSelectedInstanceModelChannel(modelChannelId) {
  return updateSelectedInstanceModelChannelSection({
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
  });
}

function handleModelChannelsSubmit(event) {
  return handleModelChannelsSubmitSection({
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
  });
}

function handleModelChannelGenerateSubmit() {
  return handleModelChannelGenerateSubmitSection({
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
  });
}

function handleDetailModelChannelSubmit(event) {
  return handleDetailModelChannelSubmitSection({
    event,
    elements,
    updateSelectedInstanceModelChannel,
  });
}

function bindModelChannelEvents() {
  return bindModelChannelEventsSection({
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
  });
}

async function init() {
  await loadRuntimeConfig();
  await hydrateSelectionFromHash();
  state.adminModeAvailable = window.__SHARED_CONSOLE_CONFIG__?.adminModeAvailable === true;
  state.activeTab = resolveStoredActiveTab();
  state.apiBase = resolveDefaultApiBase();
  state.adminToken = resolveStoredAdminToken();
  elements.apiBaseInput.value = state.apiBase;
  elements.adminTokenInput.value = state.adminToken;
  elements.autoRefreshCheckbox.checked = localStorage.getItem(AUTO_REFRESH_STORAGE_KEY) === "1";
  elements.statusFeed.innerHTML = "";
  bindEvents();
  setActiveTab(state.activeTab, { persist: false });
  bindModelChannelEvents();
  ensureModelChannelGenerateCardsInitialized();
  syncCreateFormConstraints();
  updateAdminModeUi();
  configureAutoRefresh(elements.autoRefreshCheckbox.checked);
  pushStatus("info", "值班台已启动", `API ${state.apiBase}`);
  await loadInstances({ preserveSelection: true });
  syncSelectionToHash();
}

void init();
