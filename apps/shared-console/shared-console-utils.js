export function normalizeApiBaseSection(value) {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/, "");
}

export function isAbsoluteHttpUrlSection(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

export function normalizeApiPathSection(path) {
  if (!path) {
    return "/";
  }
  return path.startsWith("/") ? path : `/${path}`;
}

export function joinApiUrlSection(base, path) {
  const normalizedPath = normalizeApiPathSection(path);
  const normalizedBase = normalizeApiBaseSection(base ?? "");
  if (!normalizedBase) {
    return normalizedPath;
  }
  if (isAbsoluteHttpUrlSection(normalizedBase)) {
    try {
      const url = new URL(normalizedBase);
      const basePath = normalizeApiPathSection(url.pathname).replace(/\/+$/, "") || "/";
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

export function escapeHtmlSection(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatRelativeTimeSection(value, now = Date.now()) {
  if (!value) {
    return "just now";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const diffMs = date.getTime() - now;
  const absMinutes = Math.round(Math.abs(diffMs) / 60000);
  if (absMinutes < 1) {
    return "just now";
  }
  if (absMinutes < 60) {
    return diffMs >= 0 ? `in ${absMinutes} min` : `${absMinutes} min ago`;
  }
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 48) {
    return diffMs >= 0 ? `in ${absHours} hr` : `${absHours} hr ago`;
  }
  const absDays = Math.round(absHours / 24);
  return diffMs >= 0 ? `in ${absDays} day` : `${absDays} day ago`;
}

export function formatDateTimeSection(value, locale = "zh-CN") {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function formatMaybeSection(value) {
  if (value == null || value === "") {
    return "n/a";
  }
  return String(value);
}

export function buildUiUrlWithOperatorScopesSection(baseUrl, scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return baseUrl;
  }
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("operatorScopes", scopes.join(","));
    return url.toString();
  } catch {
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}operatorScopes=${encodeURIComponent(scopes.join(","))}`;
  }
}

export function resolveUserInstanceUiScopesSection(modelChannelCatalog) {
  return modelChannelCatalog?.userCanConfigureModels ? [] : ["operator.read", "operator.write"];
}

export function resolveInstanceUiUrlSection({
  scope,
  id,
  userScoped = false,
  apiBase = "",
  origin = "",
  instanceApiBase,
  joinApiUrl = joinApiUrlSection,
  resolveUserInstanceUiScopes = resolveUserInstanceUiScopesSection,
  modelChannelCatalog = {},
}) {
  const proxyPath = `${instanceApiBase(scope)}/${encodeURIComponent(id)}/ui/`;
  let resolved;
  try {
    resolved = new URL(joinApiUrl(apiBase, proxyPath), origin).toString();
  } catch {
    resolved = joinApiUrl(apiBase, proxyPath);
  }
  return userScoped
    ? buildUiUrlWithOperatorScopesSection(resolved, resolveUserInstanceUiScopes(modelChannelCatalog))
    : resolved;
}
