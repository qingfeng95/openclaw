import { loadConfig } from "../../config/config.js";
import { defaultToolPolicyDecision, type ToolPolicyDecision } from "./tool-policy.js";

const SHARED_TOOL_POLICY_RULES: Record<string, ToolPolicyDecision> = {
  gateway: {
    allow: false,
    route: "deny",
    reason: "shared runtime denies gateway tool execution",
    ruleId: "shared.gateway.deny.v1",
    resourceClass: "gateway",
    supportLevel: "unsupported",
  },
  cron: {
    allow: false,
    route: "deny",
    reason: "shared runtime denies cron tool execution",
    ruleId: "shared.cron.deny.v1",
    resourceClass: "scheduler",
    supportLevel: "unsupported",
  },
  agents_list: {
    allow: false,
    route: "deny",
    reason: "shared runtime denies agents_list tool execution",
    ruleId: "shared.agents-list.deny.v1",
    resourceClass: "agent-control",
    supportLevel: "unsupported",
  },
  browser: {
    allow: false,
    route: "worker",
    reason: "shared runtime requires browser tool execution on a worker",
    ruleId: "shared.browser.worker.v1",
    resourceClass: "browser",
    supportLevel: "experimental",
  },
  nodes: {
    allow: false,
    route: "deny",
    reason: "共享模式暂不支持 nodes 能力，请改用独立实例",
    ruleId: "shared.nodes.deny.v2",
    resourceClass: "device-control",
    supportLevel: "unsupported",
  },
};

const ACTION_KEYS = ["action", "kind", "command"] as const;
const SHARED_IMAGE_MAX_BYTES_MB = 10;
const SHARED_IMAGE_MAX_IMAGES = 5;
const SHARED_PDF_MAX_BYTES_MB = 10;
const SHARED_MESSAGE_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const SHARED_MESSAGE_ALLOWED_MEDIA_ACTIONS = new Set([
  "send",
  "sendattachment",
  "reply",
  "thread-reply",
  "broadcast",
]);
const SHARED_MESSAGE_ALLOWED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".pdf",
  ".txt",
  ".md",
  ".json",
]);
const DEFAULT_SHARED_LOCAL_SOURCE_ALLOWED_PATH_PREFIXES = [
  "./",
  ".\\",
  "tmp/",
  "tmp\\",
  "./tmp/",
  ".\\tmp\\",
] as const;

type SharedPolicyGuardDecision = ToolPolicyDecision | null;

function normalizeSharedAllowedPathPrefix(prefix: string): string | null {
  const trimmed = prefix.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/\\/g, "/").toLowerCase();
  if (
    normalized.startsWith("/") ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    return null;
  }

  return normalized;
}

export function getDefaultSharedLocalSourceAllowedPathPrefixes(): string[] {
  return [...DEFAULT_SHARED_LOCAL_SOURCE_ALLOWED_PATH_PREFIXES];
}

export function getConfiguredSharedLocalSourceAllowedPathPrefixes(config = loadConfig()): string[] {
  const configured = config.tools?.shared?.localSourceValidation?.allowedPathPrefixes;
  if (!Array.isArray(configured) || configured.length === 0) {
    return getDefaultSharedLocalSourceAllowedPathPrefixes();
  }

  const normalized = configured
    .map((value) => (typeof value === "string" ? normalizeSharedAllowedPathPrefix(value) : null))
    .filter((value): value is string => typeof value === "string");

  return normalized.length > 0
    ? normalized
    : getDefaultSharedLocalSourceAllowedPathPrefixes().map((value) =>
        normalizeSharedAllowedPathPrefix(value) ?? value,
      );
}

export function normalizeSharedPolicyToolName(toolName: string): string {
  return toolName.trim().toLowerCase();
}

export function extractToolPolicyAction(args?: Record<string, unknown>): string | undefined {
  if (!args) {
    return undefined;
  }
  for (const key of ACTION_KEYS) {
    const value = args[key];
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized) {
        return normalized;
      }
    }
  }
  return undefined;
}

function readPositiveNumber(args: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!args) {
    return undefined;
  }
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readStringArg(args: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!args) {
    return undefined;
  }
  const value = args[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function buildSharedDenyDecision(params: {
  reason: string;
  ruleId: string;
  resourceClass: string;
}): ToolPolicyDecision {
  return {
    allow: false,
    route: "deny",
    reason: params.reason,
    ruleId: params.ruleId,
    resourceClass: params.resourceClass,
    supportLevel: "unsupported",
  };
}

function looksLikeHttpUrl(value: string | undefined): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function looksLikeFileUrl(value: string | undefined): boolean {
  return typeof value === "string" && /^file:/i.test(value);
}

function looksLikeDataUrl(value: string | undefined): boolean {
  return typeof value === "string" && /^data:/i.test(value);
}

function hasAllowedFileExtension(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.toLowerCase();
  for (const ext of SHARED_MESSAGE_ALLOWED_EXTENSIONS) {
    if (normalized.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

function normalizeSharedRelativeSourcePath(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().replace(/\\/g, "/").toLowerCase();
  if (!normalized || looksLikeHttpUrl(normalized) || looksLikeFileUrl(normalized) || looksLikeDataUrl(normalized)) {
    return null;
  }

  if (normalized.startsWith("/") || /^[a-z]:\//i.test(normalized) || normalized.startsWith("../") || normalized.includes("/../")) {
    return null;
  }

  return normalized;
}

function isAllowedLightweightAttachmentPath(
  value: string | undefined,
  allowedPathPrefixes: string[],
): boolean {
  const normalized = normalizeSharedRelativeSourcePath(value);
  if (!normalized) {
    return false;
  }

  return allowedPathPrefixes.some((prefix) => normalized.startsWith(prefix));
}

function approximateBase64Bytes(value: string): number {
  const normalized = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const cleaned = normalized.replace(/\s+/g, "");
  const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((cleaned.length * 3) / 4) - padding);
}

function resolveSharedImageSourcePolicyGuard(
  args: Record<string, unknown> | undefined,
  allowedPathPrefixes: string[],
): SharedPolicyGuardDecision {
  const image = readStringArg(args, "image");
  const images = Array.isArray(args?.images)
    ? args?.images.filter((value): value is string => typeof value === "string")
    : [];
  const refs = [image, ...images].filter((value): value is string => typeof value === "string");

  if (refs.some((value) => looksLikeHttpUrl(value))) {
    return buildSharedDenyDecision({
      reason: "共享模式仅支持轻量图片能力：不支持远程 http(s) 图片来源",
      ruleId: "shared.image.remote-source.deny.v1",
      resourceClass: "media",
    });
  }

  if (refs.some((value) => looksLikeFileUrl(value))) {
    return buildSharedDenyDecision({
      reason: "共享模式仅支持轻量图片能力：不支持 file:// 图片来源",
      ruleId: "shared.image.file-url.deny.v1",
      resourceClass: "media",
    });
  }

  const invalidLocalRef = refs.find(
    (value) =>
      normalizeSharedRelativeSourcePath(value) === null ||
      !isAllowedLightweightAttachmentPath(value, allowedPathPrefixes),
  );
  if (invalidLocalRef) {
    return buildSharedDenyDecision({
      reason: "共享模式仅支持轻量图片能力：本地图片来源必须是受限相对路径，不能越界",
      ruleId: "shared.image.local-path-boundary.deny.v1",
      resourceClass: "media",
    });
  }

  return null;
}

function resolveSharedImagePolicyGuard(args?: Record<string, unknown>): SharedPolicyGuardDecision {
  const maxBytesMb = readPositiveNumber(args, "maxBytesMb");
  if (typeof maxBytesMb === "number" && maxBytesMb > SHARED_IMAGE_MAX_BYTES_MB) {
    return buildSharedDenyDecision({
      reason: `共享模式仅支持轻量图片能力：maxBytesMb 不能超过 ${SHARED_IMAGE_MAX_BYTES_MB}`,
      ruleId: "shared.image.max-bytes.deny.v1",
      resourceClass: "media",
    });
  }

  const maxImages = readPositiveNumber(args, "maxImages");
  if (typeof maxImages === "number" && maxImages > SHARED_IMAGE_MAX_IMAGES) {
    return buildSharedDenyDecision({
      reason: `共享模式仅支持轻量图片能力：maxImages 不能超过 ${SHARED_IMAGE_MAX_IMAGES}`,
      ruleId: "shared.image.max-images.deny.v1",
      resourceClass: "media",
    });
  }

  return null;
}

function resolveSharedPdfSourcePolicyGuard(
  args: Record<string, unknown> | undefined,
  allowedPathPrefixes: string[],
): SharedPolicyGuardDecision {
  const pdf = readStringArg(args, "pdf");
  const pdfs = Array.isArray(args?.pdfs)
    ? args?.pdfs.filter((value): value is string => typeof value === "string")
    : [];
  const refs = [pdf, ...pdfs].filter((value): value is string => typeof value === "string");

  if (refs.some((value) => looksLikeHttpUrl(value))) {
    return buildSharedDenyDecision({
      reason: "共享模式仅支持轻量 PDF 能力：不支持远程 http(s) PDF 来源",
      ruleId: "shared.pdf.remote-source.deny.v1",
      resourceClass: "document",
    });
  }

  if (refs.some((value) => looksLikeFileUrl(value))) {
    return buildSharedDenyDecision({
      reason: "共享模式仅支持轻量 PDF 能力：不支持 file:// PDF 来源",
      ruleId: "shared.pdf.file-url.deny.v1",
      resourceClass: "document",
    });
  }

  const invalidLocalRef = refs.find(
    (value) =>
      normalizeSharedRelativeSourcePath(value) === null ||
      !isAllowedLightweightAttachmentPath(value, allowedPathPrefixes),
  );
  if (invalidLocalRef) {
    return buildSharedDenyDecision({
      reason: "共享模式仅支持轻量 PDF 能力：本地 PDF 来源必须是受限相对路径，不能越界",
      ruleId: "shared.pdf.local-path-boundary.deny.v1",
      resourceClass: "document",
    });
  }

  return null;
}

function resolveSharedPdfPolicyGuard(args?: Record<string, unknown>): SharedPolicyGuardDecision {
  const maxBytesMb = readPositiveNumber(args, "maxBytesMb");
  if (typeof maxBytesMb === "number" && maxBytesMb > SHARED_PDF_MAX_BYTES_MB) {
    return buildSharedDenyDecision({
      reason: `共享模式仅支持轻量 PDF 能力：maxBytesMb 不能超过 ${SHARED_PDF_MAX_BYTES_MB}`,
      ruleId: "shared.pdf.max-bytes.deny.v1",
      resourceClass: "document",
    });
  }

  return null;
}

function resolveSharedMessagePolicyGuard(
  args: Record<string, unknown> | undefined,
  allowedPathPrefixes: string[],
): SharedPolicyGuardDecision {
  const action = extractToolPolicyAction(args);
  const media = readStringArg(args, "media");
  const path = readStringArg(args, "path");
  const filePath = readStringArg(args, "filePath");
  const buffer = readStringArg(args, "buffer");

  const hasAttachmentPayload =
    typeof media === "string" ||
    typeof path === "string" ||
    typeof filePath === "string" ||
    typeof buffer === "string";

  if (!hasAttachmentPayload) {
    return null;
  }

  if (!action || !SHARED_MESSAGE_ALLOWED_MEDIA_ACTIONS.has(action)) {
    return buildSharedDenyDecision({
      reason: "共享模式仅支持轻量消息媒体能力：当前 action 不允许携带附件/媒体",
      ruleId: "shared.message.media-action.deny.v1",
      resourceClass: "message-media",
    });
  }

  if (looksLikeHttpUrl(media)) {
    return buildSharedDenyDecision({
      reason: "共享模式仅支持轻量消息媒体能力：不支持远程 http(s) 媒体来源",
      ruleId: "shared.message.remote-media.deny.v1",
      resourceClass: "message-media",
    });
  }

  if (looksLikeFileUrl(media)) {
    return buildSharedDenyDecision({
      reason: "共享模式仅支持轻量消息媒体能力：不支持 file:// 媒体来源",
      ruleId: "shared.message.file-url-media.deny.v1",
      resourceClass: "message-media",
    });
  }

  if (looksLikeDataUrl(media)) {
    return buildSharedDenyDecision({
      reason: "共享模式仅支持轻量消息媒体能力：请使用小文件路径或轻量 buffer，不要直接传 data URL",
      ruleId: "shared.message.data-url.deny.v1",
      resourceClass: "message-media",
    });
  }

  const attachmentPath = path ?? filePath;

  if (
    typeof attachmentPath === "string" &&
    !isAllowedLightweightAttachmentPath(attachmentPath, allowedPathPrefixes)
  ) {
    return buildSharedDenyDecision({
      reason: "共享模式仅支持轻量消息媒体能力：附件路径必须是共享轻量目录下的相对小文件",
      ruleId: "shared.message.file-path.deny.v1",
      resourceClass: "message-media",
    });
  }

  if (
    (typeof path === "string" && !hasAllowedFileExtension(path)) ||
    (typeof filePath === "string" && !hasAllowedFileExtension(filePath))
  ) {
    return buildSharedDenyDecision({
      reason: "共享模式仅支持轻量消息媒体能力：仅允许常见小文件类型",
      ruleId: "shared.message.file-type.deny.v1",
      resourceClass: "message-media",
    });
  }

  if (typeof buffer === "string") {
    const estimatedBytes = approximateBase64Bytes(buffer);
    if (estimatedBytes > SHARED_MESSAGE_MAX_BUFFER_BYTES) {
      return buildSharedDenyDecision({
        reason: "共享模式仅支持轻量消息媒体能力：buffer 不能超过 2 MB",
        ruleId: "shared.message.buffer-too-large.deny.v1",
        resourceClass: "message-media",
      });
    }
  }

  return null;
}

function resolveSharedDynamicPolicy(params: {
  toolName: string;
  args?: Record<string, unknown>;
  allowedPathPrefixes: string[];
}): SharedPolicyGuardDecision {
  switch (params.toolName) {
    case "image":
      return (
        resolveSharedImageSourcePolicyGuard(params.args, params.allowedPathPrefixes) ??
        resolveSharedImagePolicyGuard(params.args)
      );
    case "pdf":
      return (
        resolveSharedPdfSourcePolicyGuard(params.args, params.allowedPathPrefixes) ??
        resolveSharedPdfPolicyGuard(params.args)
      );
    case "message":
      return resolveSharedMessagePolicyGuard(params.args, params.allowedPathPrefixes);
    default:
      return null;
  }
}

export function resolveSharedDefaultToolPolicy(params: {
  toolName: string;
  args?: Record<string, unknown>;
}): ToolPolicyDecision {
  const normalizedToolName = normalizeSharedPolicyToolName(params.toolName);
  const config = loadConfig();
  const allowedPathPrefixes = getConfiguredSharedLocalSourceAllowedPathPrefixes(config);

  const dynamicDecision = resolveSharedDynamicPolicy({
    toolName: normalizedToolName,
    args: params.args,
    allowedPathPrefixes,
  });
  if (dynamicDecision) {
    return dynamicDecision;
  }

  const matchedRule = SHARED_TOOL_POLICY_RULES[normalizedToolName];
  if (matchedRule) {
    const action = extractToolPolicyAction(params.args);
    if (!action) {
      return { ...matchedRule };
    }
    return {
      ...matchedRule,
      reason: `${matchedRule.reason} (action: ${action})`,
    };
  }
  return defaultToolPolicyDecision();
}
