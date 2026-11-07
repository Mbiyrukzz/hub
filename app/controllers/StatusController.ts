/**
 * Controller: StatusController (admin)
 *
 *   GET /api/admin/status
 *
 * Per product: is it reporting, which version, when it was last seen,
 * plus the latest reported events. A product counts as online if it
 * sent a heartbeat in the last 3 minutes.
 */

import type { TylixRequest, TylixResponse } from "@tylix/core";
import { Product, type ProductAttributes } from "../models/Product.js";
import { ProductApiKey, type ProductApiKeyAttributes } from "../models/ProductApiKey.js";
import { StatusEvent, type StatusEventAttributes } from "../models/StatusEvent.js";
import { requireHubAdmin } from "../services/AdminGate.js";
import { instantOf, isoOf } from "../services/ChangelogService.js";

const ONLINE_WINDOW_MS = 3 * 60 * 1000;

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

        return res.json({
            products: products.map((p) => {
                const key = keyByProduct.get(p.id);
                return {
                    id: p.id,
                    name: p.name,
                    slug: p.slug,
                    state: stateOf(key),
                    last_seen_at: isoOf(key?.last_seen_at),
                    last_version: key?.last_version ?? "",
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