import type { DbClient } from "../client.ts";

export type InstanceTenantRow = {
  instanceId: string;
  tenantId: string;
  updatedBy: string | null;
  updatedAt: string;
};

export type InstanceTenantsRepository = {
  listInstanceTenants(): Promise<InstanceTenantRow[]>;
  getTenantIdForInstance(instanceId: string): Promise<string | null>;
  setInstanceTenant(instanceId: string, tenantId: string, updatedBy?: string | null): Promise<void>;
  removeInstanceTenant(instanceId: string): Promise<void>;
};

export function createInstanceTenantsRepository(params: { db: DbClient }): InstanceTenantsRepository {
  const { db } = params;

  return {
    async listInstanceTenants() {
      const result = await db.query<InstanceTenantRow>(
        `
        SELECT
          instance_id AS "instanceId",
          tenant_id AS "tenantId",
          updated_by AS "updatedBy",
          updated_at AS "updatedAt"
        FROM instance_tenants
        ORDER BY instance_id ASC
        `,
      );
      return result.rows;
    },

    async getTenantIdForInstance(instanceId: string) {
      const result = await db.query<{ tenantId: string }>(
        `
        SELECT tenant_id AS "tenantId"
        FROM instance_tenants
        WHERE instance_id = $1
        LIMIT 1
        `,
        [instanceId],
      );
      return result.rows[0]?.tenantId ?? null;
    },

    async setInstanceTenant(instanceId: string, tenantId: string, updatedBy: string | null = null) {
      await db.query(
        `
        INSERT INTO instance_tenants (instance_id, tenant_id, updated_by, updated_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (instance_id)
        DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
        `,
        [instanceId, tenantId, updatedBy],
      );
    },

    async removeInstanceTenant(instanceId: string) {
      await db.query(`DELETE FROM instance_tenants WHERE instance_id = $1`, [instanceId]);
    },
  };
}
