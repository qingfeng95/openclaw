import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

import {
  appendMultiUrlModelChannelRowSection,
  applyGeneratedMultiUrlRoundRobinGroupSection,
  buildMultiUrlModelChannelGenerationPlanSection,
  buildSingleModelChannelGeneratorPayloadSection,
  clearMultiUrlModelChannelRowsSection,
  getModelChannelGeneratorModeSection,
  hydrateModelChannelGeneratorEditorFromSettingsSection,
  importBatchModelChannelGeneratorsAsRowsSection,
  normalizeModelChannelGeneratorApiValueSection,
  readMultiUrlModelChannelRowFieldSection,
  renumberMultiUrlModelChannelRowsSection,
  setModelChannelGeneratorModeSection,
  splitModelChannelGeneratorListSection,
} from "../apps/shared-console/model-channel-generator.js";
import {
  bindModelChannelEventsSection,
  handleDetailModelChannelSubmitSection,
  handleModelChannelGenerateSubmitSection,
  renderModelChannelsPanelSection,
} from "../apps/shared-console/model-channel-panel.js";
import { renderDetailSection } from "../apps/shared-console/detail-panel.js";
import {
  applySelectedInstanceUsageSummary,
  buildUsageSummaryFailureResult,
  isCurrentDetailRequest,
  refreshSelectedInstanceAsync,
} from "../apps/shared-console/instance-detail.js";
import { loadInstanceUsageSummarySection } from "../apps/shared-console/instance-requests.js";
import { buildDiagnosticsNoteSection, renderUsageSummarySection } from "../apps/shared-console/detail-render.js";
import {
  buildOverviewHotspotSectionsSection,
  buildOverviewSummaryCardsSection,
  buildOverviewUsageNoteSection,
  buildFallbackContainerMetaSection,
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
} from "../apps/shared-console/shared-console-core.js";
import {
  buildUiUrlWithOperatorScopesSection,
  escapeHtmlSection,
  formatDateTimeSection,
  formatMaybeSection,
  formatRelativeTimeSection,
  joinApiUrlSection,
  normalizeApiBaseSection,
  normalizeApiPathSection,
  resolveInstanceUiUrlSection,
  resolveUserInstanceUiScopesSection,
} from "../apps/shared-console/shared-console-utils.js";

function createDom() {
  return new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function createGeneratorElements(document: Document) {
  const singleOption = document.createElement("label");
  singleOption.className = "channel-mode-option";
  const multiOption = document.createElement("label");
  multiOption.className = "channel-mode-option";
  const modeSingleInput = document.createElement("input");
  modeSingleInput.type = "radio";
  modeSingleInput.checked = true;
  singleOption.appendChild(modeSingleInput);
  const modeMultiInput = document.createElement("input");
  modeMultiInput.type = "radio";
  multiOption.appendChild(modeMultiInput);
  const modelChannelSinglePanel = document.createElement("section");
  const modelChannelMultiPanel = document.createElement("section");
  modelChannelMultiPanel.classList.add("hidden");
  const modelChannelMultiRows = document.createElement("div");
  const modelChannelMultiRowsEmptyState = document.createElement("div");
  return {
    modelChannelGenerateModeSingleInput: modeSingleInput,
    modelChannelGenerateModeMultiInput: modeMultiInput,
    modelChannelSinglePanel,
    modelChannelMultiPanel,
    modelChannelSingleBaseUrlInput: { value: "https://example.test/v1" },
    modelChannelSingleApiInput: { value: "openai-responses" },
    modelChannelSingleIdPrefixInput: { value: "base-id" },
    modelChannelSingleNamePrefixInput: { value: "Base Name" },
    modelChannelSingleApiKeysTextarea: { value: "sk-base" },
    modelChannelSingleModelsTextarea: { value: "gpt-5-mini" },
    modelChannelGenerateReasoningCheckbox: { checked: true },
    modelChannelGenerateImageInputCheckbox: { checked: false },
    modelChannelGenerateRoundRobinCheckbox: { checked: true },
    modelChannelMultiRows,
    modelChannelMultiRowsEmptyState,
    modelChannelMultiModelsTextarea: { value: "gpt-5-mini" },
    modelChannelMultiGroupIdInput: { value: "" },
    modelChannelMultiGroupNameInput: { value: "" },
    addModelChannelMultiRowButton: document.createElement("button"),
    importModelChannelBatchButton: document.createElement("button"),
    clearModelChannelMultiRowsButton: document.createElement("button"),
    modelChannelGenerateBatchTextarea: document.createElement("textarea"),
  };
}

function createPanelElements(document: Document) {
  const elements = {
    modelChannelsForm: document.createElement("form"),
    modelChannelsPanel: document.createElement("div"),
    modelChannelsTextarea: document.createElement("textarea"),
    userModelConfigCheckbox: document.createElement("input"),
    modelChannelGenerateModeSingleInput: document.createElement("input"),
    modelChannelGenerateModeMultiInput: document.createElement("input"),
    modelChannelSingleBaseUrlInput: document.createElement("input"),
    modelChannelSingleApiInput: document.createElement("select"),
    modelChannelSingleIdPrefixInput: document.createElement("input"),
    modelChannelSingleNamePrefixInput: document.createElement("input"),
    modelChannelSingleApiKeysTextarea: document.createElement("textarea"),
    modelChannelSingleModelsTextarea: document.createElement("textarea"),
    modelChannelMultiModelsTextarea: document.createElement("textarea"),
    modelChannelMultiGroupIdInput: document.createElement("input"),
    modelChannelMultiGroupNameInput: document.createElement("input"),
    modelChannelGenerateBatchTextarea: document.createElement("textarea"),
    modelChannelGenerateReasoningCheckbox: document.createElement("input"),
    modelChannelGenerateImageInputCheckbox: document.createElement("input"),
    modelChannelGenerateRoundRobinCheckbox: document.createElement("input"),
    addModelChannelMultiRowButton: document.createElement("button"),
    importModelChannelBatchButton: document.createElement("button"),
    clearModelChannelMultiRowsButton: document.createElement("button"),
    modelChannelMultiRows: document.createElement("div"),
    modelChannelMultiRowsEmptyState: document.createElement("div"),
    generateModelChannelsButton: document.createElement("button"),
    autoUnassignRemovedModelChannelsCheckbox: document.createElement("input"),
    reloadModelChannelsButton: document.createElement("button"),
    saveModelChannelsButton: document.createElement("button"),
    detailModelChannelForm: document.createElement("form"),
    detailModelChannelSelect: document.createElement("select"),
    clearDetailModelChannelButton: document.createElement("button"),
    modelChannelSinglePanel: document.createElement("section"),
    modelChannelMultiPanel: document.createElement("section"),
  };
  const singleOption = document.createElement("label");
  singleOption.className = "channel-mode-option";
  singleOption.appendChild(elements.modelChannelGenerateModeSingleInput);
  const multiOption = document.createElement("label");
  multiOption.className = "channel-mode-option";
  multiOption.appendChild(elements.modelChannelGenerateModeMultiInput);
  elements.modelChannelGenerateModeSingleInput.type = "radio";
  elements.modelChannelGenerateModeSingleInput.checked = true;
  elements.modelChannelGenerateModeMultiInput.type = "radio";
  return elements;
}

function createDetailElements(document: Document) {
  const detailEmpty = document.createElement("div");
  const detailContent = document.createElement("div");
  detailEmpty.className = "hidden";
  return {
    detailBadge: document.createElement("div"),
    detailEmpty,
    detailContent,
    openUiButton: document.createElement("button"),
    copyTokenButton: document.createElement("button"),
    copyUiLinkButton: document.createElement("button"),
    copyLoginGuideButton: document.createElement("button"),
    refreshPairingButton: document.createElement("button"),
    approveLatestPairingButton: document.createElement("button"),
    detailModelChannelSelect: document.createElement("select"),
    clearDetailModelChannelButton: document.createElement("button"),
    saveDetailModelChannelButton: document.createElement("button"),
    detailTitle: document.createElement("div"),
    renameInput: document.createElement("input"),
  };
}

describe("shared console model channel generator helpers", () => {
  it("splits generator lists across newlines, commas, and full-width separators", () => {
    expect(splitModelChannelGeneratorListSection(" gpt-5-mini,\nclaude-3.7-sonnet；gemini-2.5 ")).toEqual([
      "gpt-5-mini",
      "claude-3.7-sonnet",
      "gemini-2.5",
    ]);
  });

  it("normalizes API aliases to canonical values", () => {
    expect(normalizeModelChannelGeneratorApiValueSection("openai-chat-completions")).toBe("openai-completions");
    expect(normalizeModelChannelGeneratorApiValueSection("/v1/chat/completions")).toBe("openai-completions");
    expect(normalizeModelChannelGeneratorApiValueSection("Anthropic")).toBe("anthropic-messages");
    expect(normalizeModelChannelGeneratorApiValueSection("", { allowBlank: true })).toBe("");
  });

  it("builds a single-url generator payload from explicit mode fields", () => {
    const dom = createDom();
    const elements = createGeneratorElements(dom.window.document);

    const payload = buildSingleModelChannelGeneratorPayloadSection(
      { userCanConfigureModels: false, channels: [], channelGroups: [] },
      elements,
    );

    expect(payload).toEqual({
      settings: { userCanConfigureModels: false, channels: [], channelGroups: [] },
      generator: {
        baseUrl: "https://example.test/v1",
        api: "openai-responses",
        channelIdPrefix: "base-id",
        channelNamePrefix: "Base Name",
        apiKeys: "sk-base",
        modelIds: "gpt-5-mini",
        reasoning: true,
        allowImageInput: false,
        createRoundRobinGroup: true,
      },
    });
  });

  it("imports multi-url batch rows and builds a generation plan", () => {
    const dom = createDom();
    const elements = createGeneratorElements(dom.window.document);

    const count = importBatchModelChannelGeneratorsAsRowsSection(
      elements,
      dom.window.document,
      escapeHtml,
      [
        "Alpha|alpha|https://alpha.test/v1|gpt-5-mini,gpt-5|sk-alpha",
        "Beta|beta|https://beta.test/v1|gpt-5-mini,gpt-5|sk-beta|openai-chat-completions",
      ].join("\n"),
    );

    expect(count).toBe(2);
    expect(elements.modelChannelMultiModelsTextarea.value).toBe("gpt-5-mini\ngpt-5");
    const rows = elements.modelChannelMultiRows.querySelectorAll(".channel-multi-row");
    expect(rows).toHaveLength(2);
    expect(readMultiUrlModelChannelRowFieldSection(rows[1], "api")).toBe("openai-completions");

    const plan = buildMultiUrlModelChannelGenerationPlanSection(elements);
    expect(plan).toEqual({
      generators: [
        {
          baseUrl: "https://alpha.test/v1",
          api: "openai-responses",
          channelIdPrefix: "alpha",
          channelNamePrefix: "Alpha",
          modelIds: ["gpt-5-mini", "gpt-5"],
          apiKeys: ["sk-alpha"],
          reasoning: true,
          allowImageInput: false,
          createRoundRobinGroup: false,
        },
        {
          baseUrl: "https://beta.test/v1",
          api: "openai-completions",
          channelIdPrefix: "beta",
          channelNamePrefix: "Beta",
          modelIds: ["gpt-5-mini", "gpt-5"],
          apiKeys: ["sk-beta"],
          reasoning: true,
          allowImageInput: false,
          createRoundRobinGroup: false,
        },
      ],
      group: {
        enabled: true,
        groupId: "",
        groupName: "",
      },
    });
  });

  it("hydrates saved settings into the explicit multi-url editor", () => {
    const dom = createDom();
    const elements = createGeneratorElements(dom.window.document);

    const result = hydrateModelChannelGeneratorEditorFromSettingsSection(
      elements,
      dom.window.document,
      escapeHtml,
      {
        userCanConfigureModels: false,
        channels: [
          {
            id: "alpha",
            name: "Alpha",
            baseUrl: "https://alpha.test/v1",
            api: "Anthropic",
            models: [{ id: "claude-sonnet-4-5", reasoning: true, input: { text: true } }],
            apiKey: "sk-alpha",
          },
          {
            id: "beta",
            name: "Beta",
            baseUrl: "https://beta.test/v1",
            api: "openai-responses",
            models: [{ id: "claude-sonnet-4-5", reasoning: true, input: { text: true } }],
            apiKey: "sk-beta",
          },
        ],
        channelGroups: [
          {
            id: "global-rr",
            name: "Global RR",
            strategy: "round-robin",
            channelIds: ["alpha", "beta"],
          },
        ],
      },
    );

    expect(result).toEqual({ mode: "multi", rowCount: 2 });
    expect(getModelChannelGeneratorModeSection(elements)).toBe("multi");
    expect(elements.modelChannelMultiModelsTextarea.value).toBe("claude-sonnet-4-5");
    expect(elements.modelChannelMultiGroupIdInput.value).toBe("global-rr");
    expect(elements.modelChannelMultiGroupNameInput.value).toBe("Global RR");
    const rows = elements.modelChannelMultiRows.querySelectorAll(".channel-multi-row");
    expect(rows).toHaveLength(2);
    expect(readMultiUrlModelChannelRowFieldSection(rows[0], "api")).toBe("anthropic-messages");
    expect(readMultiUrlModelChannelRowFieldSection(rows[1], "apiKey")).toBe("sk-beta");
  });

  it("toggles the explicit mode panels and appends a synthesized round-robin group", () => {
    const dom = createDom();
    const elements = createGeneratorElements(dom.window.document);

    setModelChannelGeneratorModeSection(elements, "multi");
    expect(elements.modelChannelSinglePanel.classList.contains("hidden")).toBe(true);
    expect(elements.modelChannelMultiPanel.classList.contains("hidden")).toBe(false);

    appendMultiUrlModelChannelRowSection(elements, dom.window.document, escapeHtml, {
      channelNamePrefix: "Alpha",
      channelIdPrefix: "alpha",
      baseUrl: "https://alpha.test/v1",
      api: "openai-responses",
      apiKey: "sk-alpha",
    });
    renumberMultiUrlModelChannelRowsSection(elements);
    clearMultiUrlModelChannelRowsSection(elements);
    expect(elements.modelChannelMultiRows.querySelectorAll(".channel-multi-row")).toHaveLength(0);

    const result = applyGeneratedMultiUrlRoundRobinGroupSection(
      {
        userCanConfigureModels: false,
        channels: [{ id: "alpha" }, { id: "beta" }],
        channelGroups: [],
      },
      ["alpha", "beta"],
      { enabled: true, groupId: "global-rr", groupName: "Global RR" },
    );

    expect(result.groupId).toBe("global-rr");
    expect(result.settings.channelGroups).toEqual([
      {
        id: "global-rr",
        name: "Global RR",
        strategy: "round-robin",
        channelIds: ["alpha", "beta"],
      },
    ]);
  });
});

describe("shared console core helpers", () => {
  it("normalizes model channel settings and catalog payloads", () => {
    expect(defaultModelChannelSettingsSection()).toEqual({
      userCanConfigureModels: false,
      channels: [],
      channelGroups: [],
    });

    expect(
      ensureModelChannelCatalogShapeSection({
        userCanConfigureModels: 1,
        channels: [
          {
            id: " alpha ",
            name: " Alpha ",
            kind: "group",
            providerId: " openai ",
            defaultModel: " gpt-5 ",
            channelCount: 3,
            strategy: "round-robin",
          },
          {
            id: "",
          },
        ],
      }),
    ).toEqual({
      userCanConfigureModels: true,
      channels: [
        {
          id: "alpha",
          name: "Alpha",
          kind: "group",
          providerId: "openai",
          defaultModel: "gpt-5",
          channelCount: 3,
          strategy: "round-robin",
        },
      ],
    });

    expect(
      normalizeModelChannelSettingsForEditorSection({
        userCanConfigureModels: "yes",
        channels: [{ id: "alpha" }],
      }),
    ).toEqual({
      userCanConfigureModels: true,
      channels: [{ id: "alpha" }],
      channelGroups: [],
    });
  });

  it("resolves instance API paths and scope labels", () => {
    expect(instanceApiBaseSection("shared")).toBe("/api/instances");
    expect(instanceApiBaseSection("dedicated")).toBe("/api/dedicated-instances");
    expect(instanceScopeLabelSection("shared")).toBe("共享实例");
    expect(instanceScopeLabelSection("dedicated")).toBe("专属实例");
  });

  it("derives runtime labels and fallback container metadata", () => {
    const host = { id: "host-1", runtime: { location: "host" } };
    const container = { id: "ctr-1", runtime: { location: "container", containerName: "shared-1" } };

    expect(instanceRuntimeLocationSection(host)).toBe("host");
    expect(instanceRuntimeLocationSection(container)).toBe("container");
    expect(instanceRuntimeChipLabelSection(container)).toBe("容器 shared-1");
    expect(instanceRuntimeDescriptionSection(container)).toBe("当前运行在容器 shared-1");
    expect(buildFallbackContainerMetaSection([host, container], "docker unavailable")).toEqual({
      available: false,
      error: "docker unavailable",
      totalDockerContainers: 0,
      relevantContainerCount: 0,
      linkedContainerCount: 0,
      hostInstanceCount: 1,
      containerInstanceCount: 1,
      hiddenDockerContainerCount: 0,
    });
  });

  it("normalizes bind mode and container actions", () => {
    expect(normalizeBindModeInputSection("localhost")).toBe("loopback");
    expect(normalizeBindModeInputSection("0.0.0.0")).toBe("lan");
    expect(normalizeBindModeInputSection("custom")).toBe("custom");
    expect(describeInstanceActionSection("restart")).toBe("重启");
    expect(describeContainerActionSection("logs")).toBe("查看日志");
    expect(canOpenInstanceUiSection({ port: 43100, process: { state: "running" } })).toBe(true);
    expect(canOpenInstanceUiSection({ port: 0, process: { state: "stopped" } })).toBe(false);
  });

  it("builds watch notes from probe state", () => {
    expect(
      buildWatchNoteSection(
        { process: { state: "stopped" } },
        { instanceRuntimeLocation: instanceRuntimeLocationSection, formatMaybe: formatMaybeSection },
      ),
    ).toBe("实例当前未运行，暂时不能接单。");

    expect(
      buildWatchNoteSection(
        {
          process: { state: "running" },
          runtime: { location: "container", containerName: "shared-1" },
          probe: { checkedAt: "2026-04-05T00:00:00.000Z", live: true, ready: true },
        },
        { instanceRuntimeLocation: instanceRuntimeLocationSection, formatMaybe: formatMaybeSection },
      ),
    ).toBe("实例服务已就绪，请通过值班台代理入口打开 UI，不要直接访问宿主机随机端口。");

    expect(
      buildWatchNoteSection(
        {
          process: { state: "running" },
          runtime: { location: "host" },
          probe: { checkedAt: "2026-04-05T00:00:00.000Z", live: true, ready: false },
        },
        { instanceRuntimeLocation: instanceRuntimeLocationSection, formatMaybe: formatMaybeSection },
      ),
    ).toBe("就绪检查没有通过，实例可能暂时不能接单。");
  });


  it("builds overview summary cards from aggregate usage state", () => {
    const cards = buildOverviewSummaryCardsSection(
      {
        instances: [
          {
            process: { state: "running" },
            runtime: { location: "container" },
            probe: { live: true, ready: true, checkedAt: "2026-04-05T00:00:00.000Z", version: "2026.4.5" },
          },
          {
            process: { state: "running" },
            runtime: { location: "host" },
            probe: { live: false, ready: false, checkedAt: null, version: "2026.4.4" },
          },
        ],
        dedicatedInstances: [{ id: "dedicated-1" }],
        containersMeta: { linkedContainerCount: 1 },
        overviewUsageLoading: false,
        overviewUsageSummary: { totalCount: 42 },
        overviewUsageCheckedAt: "2026-04-05T00:10:00.000Z",
        overviewUsageError: "",
        overviewUsageInstanceCount: 2,
        overviewUsageReportedInstanceCount: 1,
      },
      {
        instanceRuntimeLocation: instanceRuntimeLocationSection,
        formatMaybe: formatMaybeSection,
        formatDateTime: () => "2026-04-05 00:10",
      },
    );

    expect(cards.find((card) => card.label === "最近调用次数")).toEqual({
      label: "最近调用次数",
      value: 42,
      subtext: "已汇总 1/2 个共享实例；更新时间 2026-04-05 00:10",
    });
  });

  it("builds overview usage note for loading, error, and coverage states", () => {
    expect(
      buildOverviewUsageNoteSection(
        {
          overviewUsageLoading: true,
          overviewUsageError: "",
          overviewUsageCheckedAt: null,
          overviewUsageInstanceCount: 0,
          overviewUsageReportedInstanceCount: 0,
        },
        { formatDateTime: () => "unused" },
      ),
    ).toBe("调用汇总正在更新");

    expect(
      buildOverviewUsageNoteSection(
        {
          overviewUsageLoading: false,
          overviewUsageError: "network down",
          overviewUsageCheckedAt: null,
          overviewUsageInstanceCount: 2,
          overviewUsageReportedInstanceCount: 0,
        },
        { formatDateTime: () => "unused" },
      ),
    ).toBe("调用汇总暂时不可用：network down");

    expect(
      buildOverviewUsageNoteSection(
        {
          overviewUsageLoading: false,
          overviewUsageError: "",
          overviewUsageCheckedAt: "2026-04-05T00:10:00.000Z",
          overviewUsageInstanceCount: 3,
          overviewUsageReportedInstanceCount: 2,
        },
        { formatDateTime: () => "2026-04-05 00:10" },
      ),
    ).toBe("已汇总 2/3 个共享实例；更新时间 2026-04-05 00:10");
  });

  it("builds hotspots only from overview aggregate usage state", () => {
    const sections = buildOverviewHotspotSectionsSection(
      {
        countsByRuleId: { "shared.browser.worker.v1": 4 },
        countsByDeniedReason: { denied: 2 },
        countsByOutcome: { tool_denied: 2 },
        countsByToolNameAction: { "browser.open": 5 },
        countsByRouteType: { worker: 5 },
      },
      {
        topEntries: topEntriesSection,
      },
    );

    expect(sections.find((section) => section.kind === "toolAction")?.rows).toEqual([["browser.open", 5]]);
    expect(sections.find((section) => section.kind === "rule")?.rows).toEqual([["shared.browser.worker.v1", 4]]);
  });

});

describe("shared console utility helpers", () => {
  it("normalizes API base and path values", () => {
    expect(normalizeApiBaseSection(" http://a/b/ ")).toBe("http://a/b");
    expect(normalizeApiPathSection("x")).toBe("/x");
  });

  it("joins API URLs without duplicating the api prefix", () => {
    expect(joinApiUrlSection("http://127.0.0.1:43100/api", "/api/instances")).toBe(
      "http://127.0.0.1:43100/api/instances",
    );
    expect(joinApiUrlSection("/api", "/api/instances")).toBe("/api/instances");
  });

  it("escapes html and formats optional values", () => {
    expect(escapeHtmlSection('<a&"\'')).toBe("&lt;a&amp;&quot;&#39;");
    expect(formatMaybeSection("")).toBe("n/a");
    expect(formatMaybeSection("alpha")).toBe("alpha");
  });

  it("formats dates and relative times deterministically", () => {
    expect(formatDateTimeSection("2026-04-05T00:00:00.000Z", "en-CA")).not.toBe("");
    expect(formatRelativeTimeSection("2026-04-05T00:05:00.000Z", Date.parse("2026-04-05T00:00:00.000Z"))).toBe(
      "in 5 min",
    );
    expect(formatRelativeTimeSection("2026-04-04T23:55:00.000Z", Date.parse("2026-04-05T00:00:00.000Z"))).toBe(
      "5 min ago",
    );
  });

  it("builds instance ui urls and user scopes", () => {
    expect(resolveUserInstanceUiScopesSection({ userCanConfigureModels: false })).toEqual([
      "operator.read",
      "operator.write",
    ]);
    expect(resolveUserInstanceUiScopesSection({ userCanConfigureModels: true })).toEqual([]);
    expect(buildUiUrlWithOperatorScopesSection("http://localhost/ui/", ["operator.read", "operator.write"])).toBe(
      "http://localhost/ui/?operatorScopes=operator.read%2Coperator.write",
    );
    expect(
      resolveInstanceUiUrlSection({
        scope: "shared",
        id: "shared 1",
        userScoped: true,
        apiBase: "http://127.0.0.1:43100/api",
        origin: "http://localhost:3000",
        instanceApiBase: (scope: string) => (scope === "dedicated" ? "/api/dedicated-instances" : "/api/instances"),
        modelChannelCatalog: { userCanConfigureModels: false },
      }),
    ).toBe(
      "http://127.0.0.1:43100/api/instances/shared%201/ui/?operatorScopes=operator.read%2Coperator.write",
    );
  });
});

describe("shared console detail flow helpers", () => {
  it("runs diagnostics, usage, then pairing in order", async () => {
    const events: string[] = [];
    const state = {
      detailRequestToken: 3,
      selectedScope: "shared",
      selectedId: "shared-1",
    };
    const isCurrent = vi.fn().mockReturnValue(true);
    const loadInstanceDiagnostics = vi.fn(async () => {
      events.push("diagnostics:start");
      await Promise.resolve();
      events.push("diagnostics:end");
    });
    const loadInstanceUsageSummary = vi.fn(async () => {
      events.push("usage:start");
      await Promise.resolve();
      events.push("usage:end");
    });
    const loadSelectedInstancePairing = vi.fn(async () => {
      events.push("pairing:start");
      await Promise.resolve();
      events.push("pairing:end");
    });
    const configurePairingAutoRefresh = vi.fn();

    await refreshSelectedInstanceAsync({
      state,
      scope: "shared",
      id: "shared-1",
      requestToken: 3,
      isAdminModeEnabled: () => true,
      loadInstanceDiagnostics,
      loadInstanceUsageSummary,
      loadSelectedInstancePairing,
      configurePairingAutoRefresh,
      isCurrentDetailRequest: isCurrent,
    });

    expect(events).toEqual([
      "diagnostics:start",
      "diagnostics:end",
      "usage:start",
      "usage:end",
      "pairing:start",
      "pairing:end",
    ]);
    expect(loadInstanceDiagnostics).toHaveBeenCalledWith("shared", "shared-1", 3);
    expect(loadInstanceUsageSummary).toHaveBeenCalledWith("shared", "shared-1", 3);
    expect(loadSelectedInstancePairing).toHaveBeenCalledWith({ announce: false, requestToken: 3 });
    expect(configurePairingAutoRefresh).toHaveBeenCalledWith(true);
  });

  it("drops stale usage responses when the detail token changes", async () => {
    const state = {
      detailRequestToken: 8,
      selectedScope: "shared",
      selectedId: "shared-1",
      selectedItem: { id: "shared-1" },
      selectedUsageLoading: true,
      selectedUsageSummary: null,
      selectedUsageCheckedAt: null,
      selectedUsageError: "",
    };
    const renderDetail = vi.fn();
    const fetchJson = vi.fn().mockResolvedValue({
      item: {
        usageSummary: { totalCount: 9 },
        checkedAt: "2026-04-05T00:00:00.000Z",
      },
    });
    const applyResult = vi.fn((...args) => applySelectedInstanceUsageSummary(...args));

    await loadInstanceUsageSummarySection({
      state,
      scope: "shared",
      id: "shared-1",
      requestToken: 7,
      fetchJson,
      instanceApiBase: () => "/api/instances",
      applySelectedInstanceUsageSummary: applyResult,
      buildUsageSummaryFailureResult,
      isCurrentDetailRequest,
      renderDetail,
    });

    expect(fetchJson).not.toHaveBeenCalled();
    expect(applyResult).not.toHaveBeenCalled();
    expect(state.selectedUsageLoading).toBe(true);
    expect(renderDetail).not.toHaveBeenCalled();
  });

  it("renders usage from usage state even while diagnostics is still loading", () => {
    const dom = createDom();
    const elements = {
      usageSummary: dom.window.document.createElement("div"),
    };
    const state = {
      selectedDiagnosticsLoading: true,
      selectedUsageLoading: false,
      selectedUsageSummary: {
        totalCount: 5,
        countsByOutcome: { allow: 5 },
        countsByToolName: { browser: 3 },
        countsByToolNameAction: { "browser.open": 3 },
        countsByRouteType: { worker: 5 },
        countsByRuleId: { none: 5 },
        countsByDeniedReason: {},
        filePath: "/tmp/usage.jsonl",
      },
      selectedUsageCheckedAt: "2026-04-05T00:00:00.000Z",
      selectedUsageError: "",
    };
    const item = {
      probe: {
        checkedAt: "2026-04-05T00:00:00.000Z",
      },
    };
    const buildUsageTable = vi.fn((title: string) => `<section>${title}</section>`);

    renderUsageSummarySection({
      state,
      elements,
      item,
      escapeHtml: escapeHtmlSection,
      formatRelativeTime: (value: string) => value,
      buildDiagnosticsNote: (target: unknown) =>
        buildDiagnosticsNoteSection({
          state,
          item: target,
          escapeHtml: escapeHtmlSection,
          formatRelativeTime: (value: string) => value,
        }),
      buildUsageTable,
      topEntries: topEntriesSection,
      explainOutcome: explainOutcomeSection,
      explainToolName: explainToolNameSection,
      explainToolAction: explainToolActionSection,
      explainRouteType: explainRouteTypeSection,
      explainRuleId: explainRuleIdSection,
    });

    expect(elements.usageSummary.innerHTML).toContain("Usage summary updated");
    expect(elements.usageSummary.innerHTML).toContain("Loading diagnostics...");
    expect(elements.usageSummary.innerHTML).toContain("/tmp/usage.jsonl");
    expect(buildUsageTable).toHaveBeenCalled();
  });
});

describe("shared console panel helpers", () => {
  it("locks the model channel panel outside admin mode but keeps reload available", () => {
    const dom = createDom();
    const elements = createPanelElements(dom.window.document);
    const setRowsDisabled = vi.fn();
    const state = {
      adminModeAvailable: true,
      modelChannelSettings: null,
      modelChannelSettingsText: "",
      modelChannelEditorDirty: false,
      modelChannelCatalog: {
        channels: [{ id: "alpha" }],
        userCanConfigureModels: false,
      },
    };

    renderModelChannelsPanelSection({
      state,
      elements,
      isAdminModeEnabled: () => false,
      defaultModelChannelSettings: () => ({ userCanConfigureModels: false, channels: [], channelGroups: [] }),
      setModelChannelGenerateRowsDisabled: setRowsDisabled,
    });

    expect(setRowsDisabled).toHaveBeenCalledWith(true);
    expect(elements.modelChannelsTextarea.disabled).toBe(true);
    expect(elements.reloadModelChannelsButton.disabled).toBe(false);
    expect(elements.modelChannelsPanel.textContent).toContain("Enter admin mode");
    expect(elements.modelChannelsPanel.textContent).toContain("先进入管理员模式");
  });

  it("disables reload when server admin mode is unavailable", () => {
    const dom = createDom();
    const elements = createPanelElements(dom.window.document);
    const setRowsDisabled = vi.fn();
    const state = {
      adminModeAvailable: false,
      modelChannelSettings: null,
      modelChannelSettingsText: "",
      modelChannelEditorDirty: false,
      modelChannelCatalog: {
        channels: [],
        userCanConfigureModels: false,
      },
    };

    renderModelChannelsPanelSection({
      state,
      elements,
      isAdminModeEnabled: () => false,
      defaultModelChannelSettings: () => ({ userCanConfigureModels: false, channels: [], channelGroups: [] }),
      setModelChannelGenerateRowsDisabled: setRowsDisabled,
    });

    expect(setRowsDisabled).toHaveBeenCalledWith(true);
    expect(elements.reloadModelChannelsButton.disabled).toBe(true);
    expect(elements.modelChannelsPanel.textContent).toContain("Server admin mode is not enabled");
    expect(elements.modelChannelsPanel.textContent).toContain("只能查看");
  });

  it("renders structured admin status summary when admin mode is enabled", () => {
    const dom = createDom();
    const elements = createPanelElements(dom.window.document);
    const setRowsDisabled = vi.fn();
    const state = {
      adminModeAvailable: true,
      modelChannelSettings: {
        userCanConfigureModels: true,
        channels: [{ id: "alpha" }, { id: "beta" }],
        channelGroups: [],
      },
      modelChannelSettingsText: '{"channels":[{"id":"alpha"},{"id":"beta"}]}',
      modelChannelEditorDirty: true,
      modelChannelCatalog: {
        channels: [{ id: "alpha" }, { id: "beta" }],
        userCanConfigureModels: true,
      },
    };

    renderModelChannelsPanelSection({
      state,
      elements,
      isAdminModeEnabled: () => true,
      defaultModelChannelSettings: () => ({ userCanConfigureModels: false, channels: [], channelGroups: [] }),
      setModelChannelGenerateRowsDisabled: setRowsDisabled,
    });

    expect(setRowsDisabled).toHaveBeenCalledWith(false);
    expect(elements.modelChannelsPanel.textContent).toContain("已进入，可维护全局渠道");
    expect(elements.modelChannelsPanel.textContent).toContain("有未保存变更");
    expect(elements.modelChannelsPanel.textContent).toContain("左侧明确区分单 URL 与多 URL 两种模式");
  });

  it("renders selected detail state with admin controls enabled", () => {
    const dom = createDom();
    const elements = createDetailElements(dom.window.document);
    const renderModelChannelSelect = vi.fn();
    const renderMetaGrid = vi.fn();
    const renderPairingSummary = vi.fn();
    const renderProbeGrid = vi.fn();
    const renderUsageSummary = vi.fn();
    const updateAdminModeUi = vi.fn();
    const item = {
      id: "shared-1",
      name: "Shared One",
      modelChannelId: "alpha",
    };

    renderDetailSection({
      state: {
        selectedItem: item,
        pairingInfo: { pending: [{ requestId: "r1" }] },
        pairingLoading: false,
      },
      elements,
      isAdminModeEnabled: () => true,
      renderModelChannelSelect,
      canOpenInstanceUi: () => true,
      renderMetaGrid,
      renderPairingSummary,
      renderProbeGrid,
      renderUsageSummary,
      updateAdminModeUi,
    });

    expect(elements.detailBadge.textContent).toBe("shared-1");
    expect(elements.detailTitle.textContent).toBe("Shared One");
    expect(elements.detailModelChannelSelect.disabled).toBe(false);
    expect(elements.saveDetailModelChannelButton.disabled).toBe(false);
    expect(renderModelChannelSelect).toHaveBeenCalledWith(elements.detailModelChannelSelect, "alpha");
    expect(renderMetaGrid).toHaveBeenCalledWith(item);
    expect(renderPairingSummary).toHaveBeenCalledOnce();
    expect(renderProbeGrid).toHaveBeenCalledWith(item);
    expect(renderUsageSummary).toHaveBeenCalledWith(item);
    expect(updateAdminModeUi).toHaveBeenCalledOnce();
  });

  it("submits detail model channel selection", async () => {
    const dom = createDom();
    const elements = createPanelElements(dom.window.document);
    const updateSelectedInstanceModelChannel = vi.fn().mockResolvedValue(undefined);
    elements.detailModelChannelSelect.innerHTML = '<option value="alpha">alpha</option>';
    elements.detailModelChannelSelect.value = "alpha";

    const event = {
      preventDefault: vi.fn(),
    };

    await handleDetailModelChannelSubmitSection({
      event,
      elements,
      updateSelectedInstanceModelChannel,
    });

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(updateSelectedInstanceModelChannel).toHaveBeenCalledWith("alpha");
  });

  it("binds model channel events for mode switching, multi-url rows, reload, and detail clear in admin mode", async () => {
    const dom = createDom();
    const document = dom.window.document;
    const generatorElements = createGeneratorElements(document);
    const panelElements = createPanelElements(document);
    const elements = {
      ...generatorElements,
      ...panelElements,
    };
    elements.modelChannelMultiPanel.classList.add("hidden");
    const state = {
      modelChannelEditorDirty: false,
    };
    const pushStatus = vi.fn();
    const handleModelChannelsSubmit = vi.fn();
    const handleModelChannelGenerateSubmit = vi.fn();
    const loadModelChannelConfig = vi.fn().mockResolvedValue(undefined);
    const renderAll = vi.fn();
    const handleDetailModelChannelSubmit = vi.fn();
    const updateSelectedInstanceModelChannel = vi.fn();
    const setModelChannelGenerateMode = vi.fn((mode: string) =>
      setModelChannelGeneratorModeSection(elements, mode),
    );

    bindModelChannelEventsSection({
      elements,
      handleModelChannelsSubmit,
      appendMultiUrlModelChannelRow: (values?: Record<string, string>) =>
        appendMultiUrlModelChannelRowSection(elements, document, escapeHtml, values),
      readMultiUrlModelChannelRowField: readMultiUrlModelChannelRowFieldSection,
      renumberMultiUrlModelChannelRows: () => renumberMultiUrlModelChannelRowsSection(elements),
      pushStatus,
      importBatchModelChannelGeneratorsAsRows: (raw: string) =>
        importBatchModelChannelGeneratorsAsRowsSection(elements, document, escapeHtml, raw),
      clearMultiUrlModelChannelRows: () => clearMultiUrlModelChannelRowsSection(elements),
      setModelChannelGenerateMode,
      state,
      handleModelChannelGenerateSubmit,
      loadModelChannelConfig,
      renderAll,
      handleDetailModelChannelSubmit,
      updateSelectedInstanceModelChannel,
      isAdminModeEnabled: () => true,
    });

    elements.modelChannelsForm.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    expect(handleModelChannelsSubmit).toHaveBeenCalledTimes(1);

    elements.modelChannelGenerateModeMultiInput.checked = true;
    elements.modelChannelGenerateModeMultiInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(setModelChannelGenerateMode).toHaveBeenCalledWith("multi");
    expect(elements.modelChannelSinglePanel.classList.contains("hidden")).toBe(true);
    expect(elements.modelChannelMultiPanel.classList.contains("hidden")).toBe(false);

    elements.modelChannelGenerateBatchTextarea.value =
      "Alpha|alpha|https://alpha.test/v1|gpt-5-mini|sk-alpha";
    elements.importModelChannelBatchButton.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
    expect(pushStatus).toHaveBeenCalledWith("success", "Imported batch definitions", "Added 1 rows.");
    expect(elements.modelChannelMultiRows.querySelectorAll(".channel-multi-row")).toHaveLength(1);

    let firstRow = elements.modelChannelMultiRows.querySelector(".channel-multi-row");
    expect(firstRow).not.toBeNull();
    firstRow?.querySelector('[data-action="duplicate-model-channel-multi-row"]')?.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
    expect(elements.modelChannelMultiRows.querySelectorAll(".channel-multi-row")).toHaveLength(2);

    firstRow = elements.modelChannelMultiRows.querySelector(".channel-multi-row");
    firstRow?.querySelector('[data-action="remove-model-channel-multi-row"]')?.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
    expect(elements.modelChannelMultiRows.querySelectorAll(".channel-multi-row")).toHaveLength(1);

    elements.addModelChannelMultiRowButton.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(elements.modelChannelMultiRows.querySelectorAll(".channel-multi-row")).toHaveLength(2);

    elements.clearModelChannelMultiRowsButton.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
    expect(pushStatus).toHaveBeenCalledWith("info", "Cleared multi URL rows", "Multi URL mode is now empty.");
    expect(elements.modelChannelMultiRows.querySelectorAll(".channel-multi-row")).toHaveLength(0);

    elements.modelChannelsTextarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    expect(state.modelChannelEditorDirty).toBe(true);

    state.modelChannelEditorDirty = false;
    elements.userModelConfigCheckbox.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(state.modelChannelEditorDirty).toBe(true);

    elements.generateModelChannelsButton.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
    expect(handleModelChannelGenerateSubmit).toHaveBeenCalledOnce();

    elements.reloadModelChannelsButton.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(loadModelChannelConfig).toHaveBeenCalledWith({ announce: true });
    expect(renderAll).toHaveBeenCalledOnce();

    elements.detailModelChannelSelect.value = "beta";
    elements.detailModelChannelForm.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
    expect(handleDetailModelChannelSubmit).toHaveBeenCalledTimes(1);

    elements.clearDetailModelChannelButton.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
    expect(elements.detailModelChannelSelect.value).toBe("");
    expect(updateSelectedInstanceModelChannel).toHaveBeenCalledWith(null);
  });

});

describe("shared console reload gating", () => {
  it("prompts before reload when admin mode is not enabled", async () => {
    const dom = createDom();
    const document = dom.window.document;
    const generatorElements = createGeneratorElements(document);
    const panelElements = createPanelElements(document);
    const elements = {
      ...generatorElements,
      ...panelElements,
    };
    const pushStatus = vi.fn();
    const loadModelChannelConfig = vi.fn().mockResolvedValue(undefined);
    const renderAll = vi.fn();

    bindModelChannelEventsSection({
      elements,
      handleModelChannelsSubmit: vi.fn(),
      appendMultiUrlModelChannelRow: (values?: Record<string, string>) =>
        appendMultiUrlModelChannelRowSection(elements, document, escapeHtml, values),
      readMultiUrlModelChannelRowField: readMultiUrlModelChannelRowFieldSection,
      renumberMultiUrlModelChannelRows: () => renumberMultiUrlModelChannelRowsSection(elements),
      pushStatus,
      importBatchModelChannelGeneratorsAsRows: (raw: string) =>
        importBatchModelChannelGeneratorsAsRowsSection(elements, document, escapeHtml, raw),
      clearMultiUrlModelChannelRows: () => clearMultiUrlModelChannelRowsSection(elements),
      setModelChannelGenerateMode: (mode: string) => setModelChannelGeneratorModeSection(elements, mode),
      state: {
        modelChannelEditorDirty: false,
      },
      handleModelChannelGenerateSubmit: vi.fn(),
      loadModelChannelConfig,
      renderAll,
      handleDetailModelChannelSubmit: vi.fn(),
      updateSelectedInstanceModelChannel: vi.fn(),
      isAdminModeEnabled: () => false,
    });

    elements.reloadModelChannelsButton.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
    await Promise.resolve();

    expect(pushStatus).toHaveBeenCalledWith("error", "Reload failed", "请先进入管理员模式。", "channels");
    expect(loadModelChannelConfig).not.toHaveBeenCalled();
    expect(renderAll).not.toHaveBeenCalled();
  });
});
