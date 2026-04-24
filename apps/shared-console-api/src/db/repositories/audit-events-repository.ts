import type { DbClient } from "../client.js";

export type AuditEventRow = {
  id: number;
  timestamp: string;
  actor: string;
  action: string;
  target: string | null;
  tenantId: string | null;
  pool: string | null;
  requestId: string | null;
  result: "success" | "error";
  error: string | null;
  before: unknown | null;
  after: unknown | null;
};

export type AuditEventInput = {
  actor: string;
  action: string;
  target?: string | null;
  tenantId?: string | null;
  pool?: string | null;
  requestId?: string | null;
  result: "success" | "error";
  error?: string | null;
  before?: unknown | null;
  after?: unknown | null;
};

export type AuditEventsRepository = {
  writeAuditEvent(input: AuditEventInput): Promise<AuditEventRow>;
  listAuditEvents(filter?: {
    actor?: string;
    action?: string;
    tenantId?: string;
    target?: string;
    limit?: number;
  }): Promise<AuditEventRow[]>;
};

export function createAuditEventsRepository(params: { db: DbClient }): AuditEventsRepository {
  const { db } = params;

  return {
    async writeAuditEvent(input: AuditEventInput) {
      const result = await db.query<AuditEventRow>(
        `
        INSERT INTO audit_events (
          actor, action, target, tenant_id, pool, request_id, result, error, before, after
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
        RETURNING
          id,
          timestamp,
          actor,
          action,
          target,
          tenant_id AS "tenantId",
          pool,
          request_id AS "requestId",
          result,
          error,
          before,
          after
        `,
        [
          input.actor,
          input.action,
          input.target ?? null,
          input.tenantId ?? null,
          input.pool ?? null,
          input.requestId ?? null,
          input.result,
          input.error ?? null,
          input.before ? JSON.stringify(input.before) : null,
          input.after ? JSON.stringify(input.after) : null,
        ],
      );
      return result.rows[0];
    },

    async listAuditEvents(filter = {}) {
      const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
      const result = await db.query<AuditEventRow>(
        `
        SELECT
          id,
          timestamp,
          actor,
          action,
          target,
          tenant_id AS "tenantId",
          pool,
          request_id AS "requestId",
          result,
          error,
          before,
          after
        FROM audit_events
        WHERE ($1::text IS NULL OR actor = $1)
          AND ($2::text IS NULL OR action = $2)
          AND ($3::text IS NULL OR tenant_id = $3)
          AND ($4::text IS NULL OR target = $4)
        ORDER BY timestamp DESC
        LIMIT $5
        `,
        [filter.actor ?? null, filter.action ?? null, filter.tenantId ?? null, filter.target ?? null, limit],
      );
      return result.rows;
    },
  };
}
