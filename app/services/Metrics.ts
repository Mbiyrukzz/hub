/**
 * Service: Metrics
 *
 * Numbers that products report about themselves (how many users they have,
 * how many are active). One row per product per UTC day holds the last
 * report of that day, so history builds up on its own.
 *
 * These numbers are admin-only. They are never part of the public API.
 */

import { ProductMetric, type ProductMetricAttributes } from "../models/ProductMetric.js";

export interface MetricsInput {
    users_total: number;
    users_active: number;
    active_days: number;
}

export async function recordMetrics(productId: number, input: MetricsInput, now: Date = new Date()): Promise<void> {
    const day = now.toISOString().slice(0, 10);
    const slot = `${productId}:${day}`;
    const values = {
        users_total: input.users_total,
        users_active: input.users_active,
        active_days: input.active_days,
        reported_at: now.toISOString(),
    };

    const row = (await ProductMetric.query().where("slot", slot).first()) as ProductMetricAttributes | null;
    if (row) {
        await ProductMetric.update(row.id, values);
        return;
    }

    await ProductMetric.create({ slot, product_id: productId, day, ...values });
}

/** The most recent report per product. */
export async function latestMetrics(): Promise<Map<number, ProductMetricAttributes>> {
    const rows = (await ProductMetric.query().orderBy("day", "DESC").get()) as ProductMetricAttributes[];

    const latest = new Map<number, ProductMetricAttributes>();
    for (const row of rows) {
        if (!latest.has(row.product_id)) latest.set(row.product_id, row);
    }
    return latest;
}