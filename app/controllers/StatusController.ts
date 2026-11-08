/**
 * Controller: StatusController (admin)
 *
 *   GET /api/admin/status
 *
 * Per product: is it reporting, which version, when it was last seen, its
 * uptime for the last 90 days, the latest user and tenant numbers it
 * reported, plus the latest reported events. A product counts as online if
 * it sent a heartbeat inside the online window.
 */

import type { TylixRequest, TylixResponse } from "@tylix/core";
import { Product, type ProductAttributes } from "../models/Product.js";
import { ProductApiKey, type ProductApiKeyAttributes } from "../models/ProductApiKey.js";
import { StatusEvent, type StatusEventAttributes } from "../models/StatusEvent.js";
import { requireHubAdmin } from "../services/AdminGate.js";
import { instantOf, isoOf } from "../services/ChangelogService.js";
import { ONLINE_WINDOW_MS, uptimeFor } from "../services/Uptime.js";
import { latestMetrics, type MetricsSnapshot } from "../services/Metrics.js";

function stateOf(key: ProductApiKeyAttributes | undefined): string {
    if (!key) return "no_key";
    if (!key.last_seen_at) return "waiting";
    const age = Date.now() - instantOf(key.last_seen_at);
    if (Number.isNaN(age)) return "waiting";
    return age <= ONLINE_WINDOW_MS ? "online" : "offline";
}

export class StatusController {
    async index(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHubAdmin(req, res))) return;

        const products = (await Product.query().orderBy("name", "ASC").get()) as ProductAttributes[];
        const keys = (await ProductApiKey.query().get()) as ProductApiKeyAttributes[];
        const events = (await StatusEvent.query().orderBy("occurred_at", "DESC").get()) as StatusEventAttributes[];

        const keyByProduct = new Map<number, ProductApiKeyAttributes>();
        for (const k of keys) keyByProduct.set(k.product_id, k);

        const nameById = new Map<number, string>();
        for (const p of products) nameById.set(p.id, p.name);

        // A problem with the uptime or metrics tables must never take the whole page down.
        const uptimes = await Promise.all(
            products.map((p) => uptimeFor(p.id, keyByProduct.get(p.id)?.last_seen_at, 90).catch(() => null)),
        );
        const metricsByProduct = await latestMetrics().catch(() => new Map<number, MetricsSnapshot>());

        return res.json({
            products: products.map((p, i) => {
                const key = keyByProduct.get(p.id);
                return {
                    id: p.id,
                    name: p.name,
                    slug: p.slug,
                    state: stateOf(key),
                    last_seen_at: isoOf(key?.last_seen_at),
                    last_version: key?.last_version ?? "",
                    uptime: uptimes[i],
                    metrics: metricsByProduct.get(p.id) ?? null,
                };
            }),
            events: events.slice(0, 50).map((e) => ({
                id: e.id,
                product_id: e.product_id,
                productName: nameById.get(e.product_id) ?? "Unknown product",
                type: e.type,
                message: e.message,
                occurred_at: e.occurred_at,
            })),
        });
    }
}