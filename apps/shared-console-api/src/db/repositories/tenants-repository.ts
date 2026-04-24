import type { DbClient } from "../client.ts";

export type TenantRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type TenantInput = {
  id: string;
  name: string;
  description?: string | null;
  status?: string;
};

export type TenantsRepository = {
  listTenants(): Promise<TenantRow[]>;
  getTenantById(id: string): Promise<TenantRow | null>;
  createTenant(input: TenantInput): Promise<TenantRow>;
  upsertTenant(input: TenantInput): Promise<TenantRow>;
  updateTenant(id: string, input: Partial<TenantInput>): Promise<TenantRow>;
  deleteTenant(id: string): Promise<void>;
};

export function createTenantsRepository(params: { db: DbClient }): TenantsRepository {
  const { db } = params;

  return {
    async listTenants() {
      const result = await db.query<TenantRow>(
        `
        SELECT
          id,
          name,
          description,
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM tenants
        ORDER BY id ASC
        `,
      );
      return result.rows;
    },

    async getTenantById(id: string) {
      const result = await db.query<TenantRow>(
        `
        SELECT
          id,
          name,
          description,
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM tenants
        WHERE id = $1
        LIMIT 1
        `,
        [id],
      );
      return result.rows[0] ?? null;
    },

    async createTenant(input: TenantInput) {
      const result = await db.query<TenantRow>(
        `
        INSERT INTO tenants (id, name, description, status)
        VALUES ($1, $2, $3, $4)
        RETURNING
          id,
          name,
          description,
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        `,
        [input.id, input.name, input.description ?? null, input.status ?? "active"],
      );
      return result.rows[0];
    },

    async upsertTenant(input: TenantInput) {
      const result = await db.query<TenantRow>(
        `
        INSERT INTO tenants (id, name, description, status)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id)
        DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          status = EXCLUDED.status,
          updated_at = now()
        RETURNING
          id,
          name,
          description,
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        `,
        [input.id, input.name, input.description ?? null, input.status ?? "active"],
      );
      return result.rows[0];
    },

    async updateTenant(id: string, input: Partial<TenantInput>) {
      const result = await db.query<TenantRow>(
        `
        UPDATE tenants
        SET
          name = COALESCE($2, name),
          description = COALESCE($3, description),
          status = COALESCE($4, status),
          updated_at = now()
        WHERE id = $1
        RETURNING
          id,
          name,
          description,
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        `,
        [id, input.name ?? null, input.description ?? null, input.status ?? null],
      );
      if (!result.rows[0]) {
        throw new Error(`Tenant not found: ${id}`);
      }
      return result.rows[0];
    },

    async deleteTenant(id: string) {
      await db.query(`DELETE FROM tenants WHERE id = $1`, [id]);
    },
  };
}
