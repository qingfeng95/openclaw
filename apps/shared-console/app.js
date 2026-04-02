const DEFAULT_API_PORT = "43100";
const API_BASE_STORAGE_KEY = "crewclaw.sharedConsole.apiBase";
const AUTO_REFRESH_STORAGE_KEY = "crewclaw.sharedConsole.autoRefresh";
const ADMIN_TOKEN_STORAGE_KEY = "crewclaw.sharedConsole.adminToken";
const AUTO_REFRESH_INTERVAL_MS = 15_000;
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
  selectedContainerName: null,
  containerLogsText: "",
  containerLogsTail: 160,
  selectedScope: "shared",
  selectedId: null,
  selectedItem: null,
  filter: "",
  busy: false,
  timerId: null,
  lastLoadedAt: null,
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
  copyTokenButton: document.querySelector("#copy-token-button"),
  startButton: document.querySelector("#start-button"),
  stopButton: document.querySelector("#stop-button"),
  restartButton: document.querySelector("#restart-button"),
  probeGrid: document.querySelector("#probe-grid"),
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

function normalizeApiBase(value) {
  return value.trim().replace(/\/+$/, "");
}

function isAbsoluteHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

function normalizeApiPath(path) {
  if (!path) {
    return "/";
  }
  return path.startsWith("/") ? path : `/${path}`;
}

function joinApiUrl(base, path) {
  const normalizedPath = normalizeApiPath(path);
  const normalizedBase = normalizeApiBase(base ?? "");
  if (!normalizedBase) {
    return normalizedPath;
  }
  if (isAbsoluteHttpUrl(normalizedBase)) {
    try {
      const url = new URL(normalizedBase);
      const basePath = normalizeApiPath(url.pathname).replace(/\/+$/, "") || "/";
      if (normalizedPath === basePath || normalizedPath.startsWith(`${basePath}/`)) {
        return `${url.origin}${normalizedPath}`;
      }
      if (basePath === "/api" && normalizedPath.startsWith("/api/")) {
        return `${url.origin}${normalizedPath}`;
      }
    } catch {
      // Fall back to direct concatenation below when URL parsing fails.
    }
    return `${normalizedBase}${normalizedPath}`;
  }
  const basePath = normalizedBase.startsWith("/") ? normalizedBase : `/${normalizedBase}`;
  if (normalizedPath === basePath || normalizedPath.startsWith(`${basePath}/`)) {
    return normalizedPath;
  }
  if (basePath === "/api" && normalizedPath.startsWith("/api/")) {
    return normalizedPath;
  }
  return `${basePath}${normalizedPath}`;
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
}

function setBusy(nextBusy) {
  state.busy = nextBusy;
  for (const button of document.querySelectorAll("button")) {
    button.disabled = nextBusy;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatRelativeTime(value) {
  if (!value) {
    return "刚刚";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const diffMs = date.getTime() - Date.now();
  const absMinutes = Math.round(Math.abs(diffMs) / 60000);
  if (absMinutes < 1) {
    return "刚刚";
  }
  if (absMinutes < 60) {
    return diffMs >= 0 ? `${absMinutes} 分钟后` : `${absMinutes} 分钟前`;
  }
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 48) {
    return diffMs >= 0 ? `${absHours} 小时后` : `${absHours} 小时前`;
  }
  const absDays = Math.round(absHours / 24);
  return diffMs >= 0 ? `${absDays} 天后` : `${absDays} 天前`;
}

function formatDateTime(value) {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatMaybe(value) {
  if (value == null || value === "") {
    return "n/a";
  }
  return String(value);
}

function instanceRuntimeLocation(item) {
  if (item?.runtime?.location === "container") {
    return "container";
  }
  return "host";
}

function instanceRuntimeChipLabel(item) {
  if (instanceRuntimeLocation(item) === "container") {
    return item?.runtime?.containerName ? `容器 ${item.runtime.containerName}` : "容器运行";
  }
  return "宿主机";
}

function instanceRuntimeDescription(item) {
  if (instanceRuntimeLocation(item) === "container") {
    return item?.runtime?.containerName
      ? `当前运行在容器 ${item.runtime.containerName}`
      : "当前被标记为容器运行，但还没有容器名称";
  }
  return "当前直接运行在宿主机上";
}

function buildFallbackContainerMeta(instances, error = null) {
  return {
    available: false,
    error,
    totalDockerContainers: 0,
    relevantContainerCount: 0,
    linkedContainerCount: 0,
    hostInstanceCount: instances.filter((item) => instanceRuntimeLocation(item) === "host").length,
    containerInstanceCount: instances.filter((item) => instanceRuntimeLocation(item) === "container").length,
    hiddenDockerContainerCount: 0,
  };
}

function findContainerByName(name) {
  return state.containers.find((item) => item.name === name || item.id === name) ?? null;
}

function isProvisionedConsoleContainer(container) {
  return container?.labels?.["ai.openclaw.shared-console"] === "managed";
}

function instanceApiBase(scope) {
  return scope === "dedicated" ? "/api/dedicated-instances" : "/api/instances";
}

function instanceScopeLabel(scope) {
  return scope === "dedicated" ? "单独实例" : "共享实例";
}

function aggregateCounts(instances, key) {
  const totals = {};
  for (const item of instances) {
    const record = item?.probe?.usageSummary?.[key];
    if (!record || typeof record !== "object") {
      continue;
    }
    for (const [entryKey, entryValue] of Object.entries(record)) {
      totals[entryKey] = Number(totals[entryKey] ?? 0) + Number(entryValue ?? 0);
    }
  }
  return totals;
}

function explainOutcome(key) {
  switch (key) {
    case "tool_routed_executed":
      return "已走共享执行通道并完成";
    case "tool_local_executed":
      return "已在当前实例本地完成";
    case "tool_route_unavailable":
      return "共享模式下暂不支持";
    case "tool_denied":
      return "被共享限制拦截";
    default:
      return key;
  }
}

function explainRouteType(key) {
  switch (key) {
    case "worker":
      return "共享执行通道";
    case "local":
      return "实例本地处理";
    default:
      return key;
  }
}

function explainRuleId(key) {
  if (key === "default.local.v1") {
    return "默认走实例本地处理";
  }
  if (key === "shared.nodes.worker.v1") {
    return "节点能力的共享限制";
  }
  if (key === "shared.browser.worker.v1") {
    return "浏览器能力的共享限制";
  }
  if (key.includes("local-path-boundary")) {
    return "本地文件来源超出允许范围";
  }
  if (key.includes("max-bytes")) {
    return "上传内容大小超过共享限制";
  }
  if (key.includes("max-images")) {
    return "图片数量超过共享限制";
  }
  if (key.includes("message.file-path")) {
    return "消息附件路径不在允许范围";
  }
  return key;
}

function explainToolName(key) {
  switch (key) {
    case "browser":
      return "浏览器能力";
    case "nodes":
      return "节点能力";
    case "message":
      return "消息能力";
    case "image":
      return "图片能力";
    case "pdf":
      return "PDF 能力";
    default:
      return key;
  }
}

function explainToolAction(key) {
  if (!key) {
    return key;
  }
  if (key.startsWith("browser")) {
    return `浏览器能力 / ${key}`;
  }
  if (key.startsWith("nodes")) {
    return `节点能力 / ${key}`;
  }
  if (key.startsWith("message")) {
    return `消息能力 / ${key}`;
  }
  if (key.startsWith("image")) {
    return `图片能力 / ${key}`;
  }
  if (key.startsWith("pdf")) {
    return `PDF 能力 / ${key}`;
  }
  return key;
}

function explainHotspotValue(kind, key) {
  switch (kind) {
    case "rule":
      return explainRuleId(key);
    case "denied":
      return key;
    case "outcome":
      return explainOutcome(key);
    case "toolAction":
      return explainToolAction(key);
    case "routeType":
      return explainRouteType(key);
    default:
      return key;
  }
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
  switch (kind) {
    case "success":
      return "成功";
    case "error":
      return "失败";
    default:
      return "提示";
  }
}

function describeInstanceAction(action) {
  switch (action) {
    case "start":
      return "启动";
    case "stop":
      return "停止";
    case "restart":
      return "重启";
    default:
      return action;
  }
}

function describeContainerAction(action) {
  switch (action) {
    case "start":
      return "启动";
    case "stop":
      return "停止";
    case "restart":
      return "重启";
    case "logs":
      return "查看日志";
    default:
      return action;
  }
}

function buildWatchNote(item) {
  if (item.process?.state !== "running") {
    return "实例当前未运行，暂时不能接单。";
  }
  if (item.probe?.error) {
    return item.probe.error;
  }
  if (item.probe?.checkedAt == null) {
    return "实例正在运行，但还没有拿到最近一次检查结果。";
  }
  if (item.probe?.live === false && item.probe?.ready === false) {
    return "存活检查和就绪检查都没有通过，需要尽快处理。";
  }
  if (item.probe?.live === false) {
    return "存活检查没有通过，实例可能已经掉线。";
  }
  if (item.probe?.ready === false) {
    return "就绪检查没有通过，实例可能暂时不能接单。";
  }
  if (instanceRuntimeLocation(item) === "container") {
    return "实例服务已就绪，请通过值班台代理入口打开 UI，不要直接访问宿主机随机端口。";
  }
  return `最近一次检查：存活 ${formatMaybe(item.probe?.live)} / 就绪 ${formatMaybe(item.probe?.ready)}`;
}

function instanceUiProxyPath(scope, id) {
  return `${instanceApiBase(scope)}/${encodeURIComponent(id)}/ui/`;
}

function resolveInstanceUiUrl(scope, id) {
  const proxyPath = instanceUiProxyPath(scope, id);
  try {
    return new URL(joinApiUrl(state.apiBase || "", proxyPath), window.location.origin).toString();
  } catch {
    return joinApiUrl(state.apiBase || "", proxyPath);
  }
}

function canOpenInstanceUi(item) {
  return Boolean(item?.port) && item?.process?.state === "running";
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

function pushStatus(kind, title, detail = "") {
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
  const running = state.instances.filter((item) => item.process?.state === "running").length;
  const healthy = state.instances.filter((item) => item.probe?.live && item.probe?.ready).length;
  const stale = state.instances.filter((item) => item.process?.state === "running" && item.probe?.checkedAt == null)
    .length;
  const hostRuntimeCount = state.instances.filter((item) => instanceRuntimeLocation(item) === "host").length;
  const containerRuntimeCount = state.instances.filter(
    (item) => instanceRuntimeLocation(item) === "container",
  ).length;
  const versions = new Set(
    state.instances.map((item) => item.probe?.version).filter((value) => typeof value === "string" && value),
  );
  const totalUsage = state.instances.reduce(
    (sum, item) => sum + Number(item.probe?.usageSummary?.totalCount ?? 0),
    0,
  );

  const cards = [
    { label: "共享实例总数", value: state.instances.length, subtext: `${running} 个正在运行` },
    {
      label: "单独实例总数",
      value: state.dedicatedInstances.length,
      subtext: state.dedicatedInstances.length > 0 ? "这类实例更适合承接独占能力" : "当前还没有单独实例",
    },
    {
      label: "当前健康可用",
      value: healthy,
      subtext: `${Math.max(state.instances.length - healthy, 0)} 个需要人工关注`,
    },
    {
      label: "当前版本情况",
      value: versions.size,
      subtext: versions.size > 0 ? Array.from(versions).slice(0, 2).join(" / ") : "暂时还没拿到版本信息",
    },
    {
      label: "最近调用次数",
      value: totalUsage,
      subtext: state.lastLoadedAt ? `最近刷新：${formatDateTime(state.lastLoadedAt)}` : "来自已采集的调用汇总",
    },
    {
      label: "待人工复核",
      value: stale,
      subtext: stale > 0 ? "这些实例正在运行，但还没有最近一次检查结果" : "所有运行中的实例都拿到了检查结果",
    },
    {
      label: "容器中的实例",
      value: containerRuntimeCount,
      subtext:
        containerRuntimeCount > 0
          ? `${state.containersMeta?.linkedContainerCount ?? 0} 个容器已纳管`
          : "当前共享实例还没有放进容器",
    },
    {
      label: "宿主机运行实例",
      value: hostRuntimeCount,
      subtext: hostRuntimeCount > 0 ? "这些实例当前直接跑在宿主机" : "当前没有宿主机运行的实例",
    },
  ];

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
  if (!record || typeof record !== "object") {
    return [];
  }
  return Object.entries(record)
    .sort((left, right) => Number(right[1]) - Number(left[1]))
    .slice(0, limit)
    .map(([key, value]) => [key, Number(value)]);
}

function renderHotspots() {
  const hotRules = topEntries(aggregateCounts(state.instances, "countsByRuleId"), 5);
  const hotDeniedReasons = topEntries(aggregateCounts(state.instances, "countsByDeniedReason"), 5);
  const hotOutcomes = topEntries(aggregateCounts(state.instances, "countsByOutcome"), 5);
  const hotToolActions = topEntries(aggregateCounts(state.instances, "countsByToolNameAction"), 6);
  const hotRouteTypes = topEntries(aggregateCounts(state.instances, "countsByRouteType"), 6);

  const sections = [
    {
      title: "最近最常因为什么被挡住",
      kind: "rule",
      rows: hotRules,
      empty: "目前调用记录还不够，暂时看不出大家最常因为什么限制被挡住。",
    },
    {
      title: "最近最常见的失败原因",
      kind: "denied",
      rows: hotDeniedReasons,
      empty: "目前调用记录还不够，暂时看不出最近最常见的失败原因。",
    },
    {
      title: "最近请求最后是怎么处理完的",
      kind: "outcome",
      rows: hotOutcomes,
      empty: "目前调用记录还不够，暂时看不出最近更多是成功完成、被拦截还是暂不支持。",
    },
    {
      title: "最近大家最常调用什么能力",
      kind: "toolAction",
      rows: hotToolActions,
      empty: "目前调用记录还不够，暂时看不出大家最近最常在共享实例上调用什么能力。",
    },
    {
      title: "请求主要落在哪里处理",
      kind: "routeType",
      rows: hotRouteTypes,
      empty: "目前调用记录还不够，暂时看不出请求更多是在实例本地完成，还是转给共享执行通道。",
    },
  ];

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

function renderProbeGrid(item) {
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
      className: item.probe.ready === true ? "probe-pill-success" : item.probe.ready === false ? "probe-pill-danger" : "",
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

  elements.probeGrid.innerHTML = pills
    .map(
      (entry) => `
        <div class="probe-item">
          <span class="probe-label">${escapeHtml(entry.label)}</span>
          <div class="probe-value"><span class="probe-pill ${entry.className}">${escapeHtml(entry.value)}</span></div>
        </div>
      `,
    )
    .join("");
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
  const summary = item.probe?.usageSummary;
  if (!summary) {
    elements.usageSummary.innerHTML =
      '<div class="empty-state" style="min-height: 180px; grid-column: 1 / -1;">这个实例暂时还没有可用的使用记录汇总。</div>';
    return;
  }

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
      ${filePath}
    </section>
    ${cards.join("")}
  `;
}

function renderDetail() {
  const item = state.selectedItem;
  if (!item) {
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
    updateAdminModeUi();
    return;
  }

  elements.detailBadge.textContent = item.id;
  elements.detailTitle.textContent = item.name || item.id;
  elements.renameInput.value = item.name || "";
  if (elements.openUiButton) {
    elements.openUiButton.disabled = !canOpenInstanceUi(item);
    elements.openUiButton.title =
      instanceRuntimeLocation(item) === "container"
        ? "通过 Shared Console 代理打开容器内实例 UI"
        : "通过 Shared Console 代理打开实例 UI";
  }
  if (elements.copyTokenButton) {
    elements.copyTokenButton.disabled = !isAdminModeEnabled();
    elements.copyTokenButton.classList.toggle("hidden", !isAdminModeEnabled());
  }
  renderMetaGrid(item);
  renderProbeGrid(item);
  renderUsageSummary(item);
  elements.detailEmpty.classList.add("hidden");
  elements.detailContent.classList.remove("hidden");
  updateAdminModeUi();
}

function renderAll() {
  renderSummary();
  renderWatchlist();
  renderHotspots();
  renderContainers();
  renderContainerNameOptions();
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
  const payload = await fetchJson(`${instanceApiBase(scope)}/${encodeURIComponent(id)}?includeProbe=1`);
  state.selectedScope = scope;
  state.selectedId = id;
  state.selectedItem = payload.item;
  if (announce) {
    pushStatus("info", `已切换到${instanceScopeLabel(scope)} ${id}`, payload.item?.probe?.version || "暂无版本信息");
  }
}

async function loadInstances({ preserveSelection = true } = {}) {
  setBusy(true);
  try {
    const [payload, dedicatedPayload, containersPayload] = await Promise.all([
      fetchJson("/api/instances?includeProbe=1"),
      fetchJson("/api/dedicated-instances?includeProbe=1"),
      fetchJson("/api/containers").catch((error) => ({
        ok: false,
        items: [],
        meta: null,
        error,
      })),
    ]);
    state.sharedInstances = payload.items ?? [];
    state.dedicatedInstances = dedicatedPayload.items ?? [];
    state.instances = state.sharedInstances;
    state.containers = containersPayload?.items ?? [];
    state.containersMeta =
      containersPayload?.meta ??
      buildFallbackContainerMeta(
        [...state.sharedInstances, ...state.dedicatedInstances],
        containersPayload?.error?.message || "容器信息暂时不可用",
      );
    state.lastLoadedAt = new Date().toISOString();

    if (preserveSelection && state.selectedId) {
      const activeList = state.selectedScope === "dedicated" ? state.dedicatedInstances : state.sharedInstances;
      const selected = activeList.find((item) => item.id === state.selectedId);
      state.selectedItem = selected ?? null;
      if (!selected) {
        if (state.sharedInstances[0]) {
          state.selectedScope = "shared";
          state.selectedId = state.sharedInstances[0].id;
        } else if (state.dedicatedInstances[0]) {
          state.selectedScope = "dedicated";
          state.selectedId = state.dedicatedInstances[0].id;
        } else {
          state.selectedId = null;
        }
      }
    } else if (!state.selectedId) {
      if (state.sharedInstances[0]) {
        state.selectedScope = "shared";
        state.selectedId = state.sharedInstances[0].id;
      } else if (state.dedicatedInstances[0]) {
        state.selectedScope = "dedicated";
        state.selectedId = state.dedicatedInstances[0].id;
      } else {
        state.selectedId = null;
      }
    }

    if (state.selectedId) {
      await loadInstanceDetail(state.selectedScope, state.selectedId, false);
    } else {
      state.selectedItem = null;
    }

    updateConnectionNote(`已连接 ${state.apiBase}，最近刷新：${formatDateTime(state.lastLoadedAt)}`);
    renderAll();
  } catch (error) {
    pushStatus("error", "加载实例列表失败", error.message);
    updateConnectionNote(`连接失败：${error.message}`, true);
    renderAll();
  } finally {
    setBusy(false);
  }
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
    pushStatus("success", `${actionLabel} ${state.selectedId} 鎴愬姛`, payload.command?.stdout || "鎿嶄綔瀹屾垚");
    await loadInstances();
  } catch (error) {
    pushStatus("error", `${actionLabel} ${state.selectedId} 澶辫触`, error.message);
    updateConnectionNote(`${actionLabel} 澶辫触锛?{error.message}`, true);
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

async function enableAdminMode() {
  if (!state.adminModeAvailable) {
    pushStatus("error", "管理员模式不可用", "当前服务器未启用管理员模式。");
    return;
  }
  const token = elements.adminTokenInput.value.trim();
  if (!token) {
    pushStatus("error", "管理员模式不可用", "管理员口令不能为空。");
    return;
  }
  await fetchJson("/api/admin/validate", { adminAuth: false, headers: { "X-Shared-Console-Admin-Token": token } });
  state.adminToken = token;
  sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
  updateAdminModeUi();
  renderDetail();
  pushStatus("success", "管理员模式已启用", "现在可以复制当前实例 Token。");
}

function clearAdminMode() {
  state.adminToken = "";
  sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  elements.adminTokenInput.value = "";
  updateAdminModeUi();
  renderDetail();
  pushStatus("info", "已退出管理员模式");
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
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(token);
    pushStatus("success", `已复制 ${state.selectedId} Token`);
    return;
  }
  window.prompt(`复制 ${state.selectedId} Token`, token);
  pushStatus("info", `已显示 ${state.selectedId} Token`);
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
  const formData = new FormData(event.currentTarget);
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
    event.currentTarget.reset();
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
  const formData = new FormData(event.currentTarget);
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
    event.currentTarget.reset();
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

async function init() {
  await loadRuntimeConfig();
  await hydrateSelectionFromHash();
  state.adminModeAvailable = window.__SHARED_CONSOLE_CONFIG__?.adminModeAvailable === true;
  state.apiBase = resolveDefaultApiBase();
  state.adminToken = resolveStoredAdminToken();
  elements.apiBaseInput.value = state.apiBase;
  elements.adminTokenInput.value = state.adminToken;
  elements.autoRefreshCheckbox.checked = localStorage.getItem(AUTO_REFRESH_STORAGE_KEY) === "1";
  elements.statusFeed.innerHTML = "";
  bindEvents();
  syncCreateFormConstraints();
  updateAdminModeUi();
  configureAutoRefresh(elements.autoRefreshCheckbox.checked);
  pushStatus("info", "值班台已启动", `API ${state.apiBase}`);
  await loadInstances({ preserveSelection: true });
  syncSelectionToHash();
}

void init();
