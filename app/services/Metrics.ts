/**
 * Service: Metrics
 *
 * Numbers that products report about themselves: how many users they have,
 * how many are active, and, for multi-tenant products, the same for their
 * tenants (companies, schools...). One row per product per UTC day holds
 * the last report of that day, so history builds up on its own.
 *
 * These numbers are admin-only. They are never part of the public API.
 */

import { ProductMetric, type ProductMetricAttributes } from "../models/ProductMetric.js";
import { ProductTenantMetric, type ProductTenantMetricAttributes } from "../models/ProductTenantMetric.js";

export interface TenantInput {
    tenants_total: number;
    tenants_active: number;
    label: string;
}

export interface MetricsInput {
    users_total: number;
    users_active: number;
    active_days: number;
    tenants?: TenantInput;
}

export interface MetricsSnapshot {
    users_total: number;
    users_active: number;
    active_days: number;
    reported_at: string;
    tenants: { total: number; active: number; label: string } | null;
}

export async function recordMetrics(productId: number, input: MetricsInput, now: Date = new Date()): Promise<void> {
    const day = now.toISOString().slice(0, 10);
    const slot = `${productId}:${day}`;
    const reportedAt = now.toISOString();

    const userValues = {
        users_total: input.users_total,
        users_active: input.users_active,
        active_days: input.active_days,
        reported_at: reportedAt,
    };

    const userRow = (await ProductMetric.query().where("slot", slot).first()) as ProductMetricAttributes | null;
    if (userRow) await ProductMetric.update(userRow.id, userValues);
    else await ProductMetric.create({ slot, product_id: productId, day, ...userValues });

    if (!input.tenants) return;

    // The user numbers are already saved. A problem with the tenant table
    // must not turn the whole report into an error.
    try {
        const tenantValues = {
            tenants_total: input.tenants.tenants_total,
            tenants_active: input.tenants.tenants_active,
            label: input.tenants.label,
            reported_at: reportedAt,
        };

        const tenantRow = (await ProductTenantMetric.query().where("slot", slot).first()) as ProductTenantMetricAttributes | null;
        if (tenantRow) await ProductTenantMetric.update(tenantRow.id, tenantValues);
        else await ProductTenantMetric.create({ slot, product_id: productId, day, ...tenantValues });
    } catch (err) {
        console.error("Metrics could not save the tenant numbers:", err);
    }
}

/** The most recent report per product. */
export async function latestMetrics(): Promise<Map<number, MetricsSnapshot>> {
    const userRows = (await ProductMetric.query().orderBy("day", "DESC").get()) as ProductMetricAttributes[];

    let tenantRows: ProductTenantMetricAttributes[] = [];
    try {
        tenantRows = (await ProductTenantMetric.query().orderBy("day", "DESC").get()) as ProductTenantMetricAttributes[];
    } catch {
        tenantRows = []; // the table may not exist yet
    }

    const latestTenants = new Map<number, ProductTenantMetricAttributes>();
    for (const row of tenantRows) {
        if (!latestTenants.has(row.product_id)) latestTenants.set(row.product_id, row);
    }

    const latest = new Map<number, MetricsSnapshot>();
    for (const row of userRows) {
        if (latest.has(row.product_id)) continue;

        const t = latestTenants.get(row.product_id);
        latest.set(row.product_id, {
            users_total: Number(row.users_total),
            users_active: Number(row.users_active),
            active_days: Number(row.active_days),
            reported_at: row.reported_at,
            tenants: t
                ? { total: Number(t.tenants_total), active: Number(t.tenants_active), label: String(t.label || "Tenants") }
                : null,
        });
    }
    return latest;
}