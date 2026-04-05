export function defaultModelChannelSettingsSection() {
  return {
    userCanConfigureModels: false,
    channels: [],
    channelGroups: [],
  };
}

export function ensureModelChannelCatalogShapeSection(payload) {
  const channels = Array.isArray(payload?.channels) ? payload.channels : [];
  return {
    userCanConfigureModels: Boolean(payload?.userCanConfigureModels),
    channels: channels
      .map((item) => ({
        id: String(item?.id || "").trim(),
        name: String(item?.name || item?.id || "").trim(),
        kind: item?.kind === "group" ? "group" : "channel",
        providerId: String(item?.providerId || "").trim(),
        defaultModel: String(item?.defaultModel || "").trim(),
        channelCount:
          typeof item?.channelCount === "number" && Number.isFinite(item.channelCount)
            ? item.channelCount
            : null,
        strategy: item?.strategy === "round-robin" ? "round-robin" : "",
      }))
      .filter((item) => item.id),
  };
}

export function normalizeModelChannelSettingsForEditorSection(value) {
  return {
    userCanConfigureModels: Boolean(value?.userCanConfigureModels),
    channels: Array.isArray(value?.channels) ? value.channels : [],
    channelGroups: Array.isArray(value?.channelGroups) ? value.channelGroups : [],
  };
}

export function instanceApiBaseSection(scope) {
  return scope === "dedicated" ? "/api/dedicated-instances" : "/api/instances";
}

export function instanceScopeLabelSection(scope) {
  return scope === "dedicated" ? "专属实例" : "共享实例";
}

export function instanceRuntimeLocationSection(item) {
  if (item?.runtime?.location === "container") {
    return "container";
  }
  return "host";
}

export function instanceRuntimeChipLabelSection(item) {
  if (instanceRuntimeLocationSection(item) === "container") {
    return item?.runtime?.containerName ? `容器 ${item.runtime.containerName}` : "容器运行";
  }
  return "宿主机";
}

export function instanceRuntimeDescriptionSection(item) {
  if (instanceRuntimeLocationSection(item) === "container") {
    return item?.runtime?.containerName
      ? `当前运行在容器 ${item.runtime.containerName}`
      : "当前被标记为容器运行，但还没有容器名称";
  }
  return "当前直接运行在宿主机上";
}

export function buildFallbackContainerMetaSection(instances, error = null) {
  return {
    available: false,
    error,
    totalDockerContainers: 0,
    relevantContainerCount: 0,
    linkedContainerCount: 0,
    hostInstanceCount: instances.filter((item) => instanceRuntimeLocationSection(item) === "host").length,
    containerInstanceCount: instances.filter((item) => instanceRuntimeLocationSection(item) === "container").length,
    hiddenDockerContainerCount: 0,
  };
}

function aggregateUsageCounts(record, key) {
  const totals = {};
  const source = record?.[key];
  if (!source || typeof source !== "object") {
    return totals;
  }
  for (const [entryKey, entryValue] of Object.entries(source)) {
    totals[entryKey] = Number(entryValue ?? 0);
  }
  return totals;
}

export function buildOverviewUsageNoteSection(state, { formatDateTime }) {
  if (state.overviewUsageLoading) {
    return "调用汇总正在更新";
  }
  if (state.overviewUsageError) {
    return `调用汇总暂时不可用：${state.overviewUsageError}`;
  }
  if (state.overviewUsageCheckedAt) {
    const coverage =
      state.overviewUsageInstanceCount > 0
        ? `已汇总 ${state.overviewUsageReportedInstanceCount}/${state.overviewUsageInstanceCount} 个共享实例`
        : "共享实例调用汇总已刷新";
    return `${coverage}；更新时间 ${formatDateTime(state.overviewUsageCheckedAt)}`;
  }
  return "来自已采集的调用汇总";
}

export function buildOverviewSummaryCardsSection(
  state,
  { instanceRuntimeLocation, formatMaybe, formatDateTime },
) {
  const running = state.instances.filter((item) => item.process?.state === "running").length;
  const healthy = state.instances.filter((item) => item.probe?.live && item.probe?.ready).length;
  const stale = state.instances.filter((item) => item.process?.state === "running" && item.probe?.checkedAt == null)
    .length;
  const hostRuntimeCount = state.instances.filter((item) => instanceRuntimeLocation(item) === "host").length;
  const containerRuntimeCount = state.instances.filter((item) => instanceRuntimeLocation(item) === "container").length;
  const versions = new Set(
    state.instances.map((item) => item.probe?.version).filter((value) => typeof value === "string" && value),
  );
  const totalUsage = Number(state.overviewUsageSummary?.totalCount ?? 0);

  return [
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
      subtext: buildOverviewUsageNoteSection(state, { formatDateTime }),
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
  ].map((card) => ({
    ...card,
    subtext: formatMaybe(card.subtext),
  }));
}

export function buildOverviewHotspotSectionsSection(overviewUsageSummary, { topEntries }) {
  const hotRules = topEntries(aggregateUsageCounts(overviewUsageSummary, "countsByRuleId"), 5);
  const hotDeniedReasons = topEntries(aggregateUsageCounts(overviewUsageSummary, "countsByDeniedReason"), 5);
  const hotOutcomes = topEntries(aggregateUsageCounts(overviewUsageSummary, "countsByOutcome"), 5);
  const hotToolActions = topEntries(aggregateUsageCounts(overviewUsageSummary, "countsByToolNameAction"), 6);
  const hotRouteTypes = topEntries(aggregateUsageCounts(overviewUsageSummary, "countsByRouteType"), 6);

  return [
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
}

export function describeContainerActionSection(action) {
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

export function describeInstanceActionSection(action) {
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

export function canOpenInstanceUiSection(item) {
  return Boolean(item?.port) && item?.process?.state === "running";
}

export function normalizeBindModeInputSection(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return "";
  }
  if (raw === "127.0.0.1" || raw === "localhost" || raw === "loopback") {
    return "loopback";
  }
  if (raw === "0.0.0.0" || raw === "lan" || raw === "all" || raw === "any") {
    return "lan";
  }
  if (raw === "tailnet" || raw === "auto" || raw === "custom") {
    return raw;
  }
  return raw;
}

export function buildWatchNoteSection(item, { instanceRuntimeLocation, formatMaybe }) {
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

export function explainOutcomeSection(key) {
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

export function explainRouteTypeSection(key) {
  switch (key) {
    case "worker":
      return "共享执行通道";
    case "local":
      return "实例本地处理";
    default:
      return key;
  }
}

export function explainRuleIdSection(key) {
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

export function explainToolNameSection(key) {
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

export function explainToolActionSection(key) {
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

export function explainHotspotValueSection(kind, key) {
  switch (kind) {
    case "rule":
      return explainRuleIdSection(key);
    case "denied":
      return key;
    case "outcome":
      return explainOutcomeSection(key);
    case "toolAction":
      return explainToolActionSection(key);
    case "routeType":
      return explainRouteTypeSection(key);
    default:
      return key;
  }
}

export function statusKindLabelSection(kind) {
  switch (kind) {
    case "success":
      return "成功";
    case "error":
      return "失败";
    default:
      return "提示";
  }
}

export function topEntriesSection(record, limit = 6) {
  if (!record || typeof record !== "object") {
    return [];
  }
  return Object.entries(record)
    .sort((left, right) => Number(right[1]) - Number(left[1]))
    .slice(0, limit)
    .map(([key, value]) => [key, Number(value)]);
}
