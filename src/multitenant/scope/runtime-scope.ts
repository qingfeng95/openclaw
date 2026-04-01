export interface RuntimeScope {
  mode: "shared" | "dedicated";
  tenantId: string;
  userId: string;
  logicalInstanceId: string;
  sessionId: string;
  requestId: string;
  agentId?: string;
  runtimePoolId?: string;
}

export function isRuntimeScope(value: unknown): value is RuntimeScope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<RuntimeScope>;
  return (
    (candidate.mode === "shared" || candidate.mode === "dedicated") &&
    typeof candidate.tenantId === "string" &&
    typeof candidate.userId === "string" &&
    typeof candidate.logicalInstanceId === "string" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.requestId === "string"
  );
}
