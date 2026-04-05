import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

import {
  appendModelChannelGenerateCardSection,
  buildModelChannelGenerateCardDefaultValuesSection,
  collectBatchCardModelChannelGeneratorsSection,
  readModelChannelGenerateCardFieldSection,
  importBatchModelChannelGeneratorsAsCardsSection,
  renumberModelChannelGenerateCardsSection,
  clearModelChannelGenerateCardsSection,
  ensureModelChannelGenerateCardsInitializedSection,
  splitModelChannelGeneratorListSection,
} from "../apps/shared-console/model-channel-generator.js";
import {
  bindModelChannelEventsSection,
  handleDetailModelChannelSubmitSection,
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
  return {
    modelChannelGenerateCards: document.createElement("div"),
    modelChannelGenerateApiInput: { value: "openai-responses" },
    modelChannelGenerateReasoningCheckbox: { checked: true },
    modelChannelGenerateImageInputCheckbox: { checked: false },
    modelChannelGenerateRoundRobinCheckbox: { checked: true },
    modelChannelGenerateBaseUrlInput: { value: "https://example.test/v1" },
    modelChannelGenerateIdPrefixInput: { value: "base-id" },
    modelChannelGenerateNamePrefixInput: { value: "Base Name" },
    modelChannelGenerateApiKeysTextarea: { value: "sk-base" },
    modelChannelGenerateModelsTextarea: { value: "gpt-5-mini" },
    addModelChannelGenerateCardButton: document.createElement("button"),
    importModelChannelBatchButton: document.createElement("button"),
    clearModelChannelCardsButton: document.createElement("button"),
  };
}

function createPanelElements(document: Document) {
  return {
    modelChannelsForm: document.createElement("form"),
    modelChannelsPanel: document.createElement("div"),
    modelChannelsTextarea: document.createElement("textarea"),
    userModelConfigCheckbox: document.createElement("input"),
    modelChannelGenerateBaseUrlInput: document.createElement("input"),
    modelChannelGenerateApiInput: document.createElement("input"),
    modelChannelGenerateIdPrefixInput: document.createElement("input"),
    modelChannelGenerateNamePrefixInput: document.createElement("input"),
    modelChannelGenerateApiKeysTextarea: document.createElement("textarea"),
    modelChannelGenerateModelsTextarea: document.createElement("textarea"),
    modelChannelGenerateBatchTextarea: document.createElement("textarea"),
    modelChannelGenerateReasoningCheckbox: document.createElement("input"),
    modelChannelGenerateImageInputCheckbox: document.createElement("input"),
    modelChannelGenerateRoundRobinCheckbox: document.createElement("input"),
    generateModelChannelsButton: document.createElement("button"),
    autoUnassignRemovedModelChannelsCheckbox: document.createElement("input"),
    reloadModelChannelsButton: document.createElement("button"),
    saveModelChannelsButton: document.createElement("button"),
    detailModelChannelForm: document.createElement("form"),
    detailModelChannelSelect: document.createElement("select"),
    clearDetailModelChannelButton: document.createElement("button"),
  };
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

  it("collects batch generators from cards with shared options", () => {
    const dom = createDom();
    const elements = createGeneratorElements(dom.window.document);

    appendModelChannelGenerateCardSection(elements, dom.window.document, escapeHtml, {
      channelNamePrefix: "Alpha",
      channelIdPrefix: "alpha",
      baseUrl: "https://alpha.test/v1",
      api: "",
      modelIds: "gpt-5-mini\ngpt-5",
      apiKeys: "sk-alpha-1\nsk-alpha-2",
    });

    expect(collectBatchCardModelChannelGeneratorsSection(elements)).toEqual([
      {
        baseUrl: "https://alpha.test/v1",
        api: "openai-responses",
        channelIdPrefix: "alpha",
        channelNamePrefix: "Alpha",
        modelIds: ["gpt-5-mini", "gpt-5"],
        apiKeys: ["sk-alpha-1", "sk-alpha-2"],
        reasoning: true,
        allowImageInput: false,
        createRoundRobinGroup: true,
      },
    ]);
  });

  it("replaces the lone blank card when importing batch definitions", () => {
    const dom = createDom();
    const elements = createGeneratorElements(dom.window.document);

    appendModelChannelGenerateCardSection(elements, dom.window.document, escapeHtml, {});

    const count = importBatchModelChannelGeneratorsAsCardsSection(
      elements,
      dom.window.document,
      escapeHtml,
      [
        "Alpha|alpha|https://alpha.test/v1|gpt-5-mini|sk-alpha",
        "Beta|beta|https://beta.test/v1|gpt-5|sk-beta|openai-chat-completions",
      ].join("\n"),
    );

    expect(count).toBe(2);
    const cards = elements.modelChannelGenerateCards.querySelectorAll(".generator-card");
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('[data-field="channelNamePrefix"]')?.value).toBe("Alpha");
    expect(cards[1].querySelector('[data-field="api"]')?.value).toBe("openai-chat-completions");
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

  it("explains shared usage labels and aggregates top entries", () => {
    expect(explainOutcomeSection("tool_denied")).toBe("被共享限制拦截");
    expect(explainRouteTypeSection("worker")).toBe("共享执行通道");
    expect(explainRuleIdSection("x.local-path-boundary.y")).toBe("本地文件来源超出允许范围");
    expect(explainToolNameSection("browser")).toBe("浏览器能力");
    expect(explainToolActionSection("browser.open")).toBe("浏览器能力 / browser.open");
    expect(explainHotspotValueSection("toolAction", "browser.open")).toBe("浏览器能力 / browser.open");
    expect(statusKindLabelSection("error")).toBe("失败");
    expect(topEntriesSection({ a: 1, c: 3, b: 2 }, 2)).toEqual([
      ["c", 3],
      ["b", 2],
    ]);
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
  it("locks the model channel panel outside admin mode", () => {
    const dom = createDom();
    const elements = createPanelElements(dom.window.document);
    const ensureCards = vi.fn();
    const setCardsDisabled = vi.fn();
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
      defaultModelChannelSettings: () => ({ userCanConfigureModels: false, channels: [] }),
      ensureModelChannelGenerateCardsInitialized: ensureCards,
      setModelChannelGenerateCardsDisabled: setCardsDisabled,
    });

    expect(ensureCards).toHaveBeenCalledOnce();
    expect(setCardsDisabled).toHaveBeenCalledWith(true);
    expect(elements.modelChannelsTextarea.disabled).toBe(true);
    expect(elements.modelChannelsPanel.textContent).toContain("Enter admin mode");
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

  it("binds model channel events for add/import/clear/reload/detail clear", async () => {
    const dom = createDom();
    const document = dom.window.document;
    const generatorElements = createGeneratorElements(document);
    const panelElements = createPanelElements(document);
    const elements = {
      ...generatorElements,
      ...panelElements,
    };
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

    bindModelChannelEventsSection({
      elements,
      handleModelChannelsSubmit,
      appendModelChannelGenerateCard: (values?: Record<string, string>) =>
        appendModelChannelGenerateCardSection(elements, document, escapeHtml, values),
      buildModelChannelGenerateCardDefaultValues: () =>
        buildModelChannelGenerateCardDefaultValuesSection(elements),
      readModelChannelGenerateCardField: readModelChannelGenerateCardFieldSection,
      ensureModelChannelGenerateCardsInitialized: () =>
        ensureModelChannelGenerateCardsInitializedSection(elements, document, escapeHtml),
      renumberModelChannelGenerateCards: () => renumberModelChannelGenerateCardsSection(elements),
      pushStatus,
      importBatchModelChannelGeneratorsAsCards: (raw: string) =>
        importBatchModelChannelGeneratorsAsCardsSection(elements, document, escapeHtml, raw),
      clearModelChannelGenerateCards: (options?: { keepOneBlank?: boolean }) =>
        clearModelChannelGenerateCardsSection(elements, document, escapeHtml, options),
      state,
      handleModelChannelGenerateSubmit,
      loadModelChannelConfig,
      renderAll,
      handleDetailModelChannelSubmit,
      updateSelectedInstanceModelChannel,
    });

    elements.addModelChannelGenerateCardButton.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(elements.modelChannelGenerateCards.querySelectorAll(".generator-card")).toHaveLength(1);

    elements.modelChannelGenerateBatchTextarea.value =
      "Alpha|alpha|https://alpha.test/v1|gpt-5-mini|sk-alpha";
    elements.importModelChannelBatchButton.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
    expect(pushStatus).toHaveBeenCalledWith("success", "Imported batch definitions", "Added 1 cards.");
    expect(elements.modelChannelGenerateCards.querySelectorAll(".generator-card").length).toBeGreaterThanOrEqual(1);

    elements.clearModelChannelCardsButton.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
    expect(pushStatus).toHaveBeenCalledWith("info", "Cleared cards", "Kept one blank card.");
    expect(elements.modelChannelGenerateCards.querySelectorAll(".generator-card")).toHaveLength(1);

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
