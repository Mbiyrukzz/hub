/**
 * Controller: IngestController
 *
 * Sites push to the Hub here, authenticated by their product's API key:
 *   POST /api/v1/ingest/heartbeat  { version?: string }
 *   POST /api/v1/ingest/events     { type, message?, meta?, at? }
 *   POST /api/v1/ingest/metrics    { users_total, users_active, active_days? }
 */

import crypto from "node:crypto";
import { createRateLimiter } from "@tylix/core";
import type { TylixRequest, TylixResponse } from "@tylix/core";
import { ProductApiKey, type ProductApiKeyAttributes } from "../models/ProductApiKey.js";
import { StatusEvent } from "../models/StatusEvent.js";
import { recordBeat } from "../services/Uptime.js";
import { recordMetrics } from "../services/Metrics.js";

const EVENT_TYPES = ["deploy.started", "deploy.succeeded", "deploy.failed", "server.unreachable", "server.recovered"] as const;

const limiter = createRateLimiter({ max: 120, windowMs: 60_000 });

const MAX_COUNT = 1_000_000_000;

function bearer(req: TylixRequest): string {
    const h = (req as any).headers?.authorization ?? (req as any).headers?.Authorization ?? "";
    const m = /^Bearer\s+(\S+)$/i.exec(String(h));
    return m ? m[1] : "";
}

/** Returns the key row, or answers 401/429 itself and returns null. */
async function authenticate(req: TylixRequest, res: TylixResponse): Promise<ProductApiKeyAttributes | null> {
    const raw = bearer(req);
    if (!raw) {
        res.status(401);
        res.json({ error: "Missing API key." });
        return null;
    }

    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    const limit = limiter(hash);
    if (!limit.allowed) {
        res.status(429);
        res.json({ error: `Too many requests. Try again in ${limit.retryAfterSeconds} seconds.` });
        return null;
    }

    const row = (await ProductApiKey.query().where("key_hash", hash).first()) as ProductApiKeyAttributes | null;
    if (!row) {
        res.status(401);
        res.json({ error: "Invalid API key." });
        return null;
    }
    return row;
}

function wholeNumber(value: unknown, min: number, max: number): number | null {
    const n = typeof value === "number" ? value : Number.NaN;
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export class IngestController {
    async heartbeat(req: TylixRequest, res: TylixResponse) {
        const key = await authenticate(req, res);
        if (!key) return;

        const version = String(req.body?.version ?? "").slice(0, 40);
        const now = new Date();

        await ProductApiKey.update(key.id, { last_seen_at: now.toISOString(), last_version: version });

        // key.last_seen_at is still the value from BEFORE this beat. Uptime
        // never throws, and the heartbeat does not wait for it.
        void recordBeat(key.product_id, key.last_seen_at, now.getTime());

        res.status(204);
        return res.end();
    }

    async event(req: TylixRequest, res: TylixResponse) {
        const key = await authenticate(req, res);
        if (!key) return;

        const type = String(req.body?.type ?? "");
        if (!(EVENT_TYPES as readonly string[]).includes(type)) {
            res.status(422);
            return res.json({ error: `type must be one of: ${EVENT_TYPES.join(", ")}.` });
        }

        const message = String(req.body?.message ?? "").slice(0, 300);
        const meta = JSON.stringify(req.body?.meta ?? {}).slice(0, 2000);
        const at = new Date(String(req.body?.at ?? ""));
        const occurred = Number.isNaN(at.getTime()) ? new Date() : at;

        await StatusEvent.create({
            product_id: key.product_id,
            type,
            message,
            meta,
            occurred_at: occurred.toISOString(),
        });

        res.status(201);
        return res.json({ ok: true });
    }

    /** A product reports how many users it has and how many are active. */
    async metrics(req: TylixRequest, res: TylixResponse) {
        const key = await authenticate(req, res);
        if (!key) return;

        const errors: Record<string, string[]> = {};

        const total = wholeNumber(req.body?.users_total, 0, MAX_COUNT);
        const active = wholeNumber(req.body?.users_active, 0, MAX_COUNT);
        const activeDays = wholeNumber(req.body?.active_days ?? 30, 1, 365);

        if (total === null) errors.users_total = ["users_total must be a whole number, 0 or more."];
        if (active === null) errors.users_active = ["users_active must be a whole number, 0 or more."];
        else if (total !== null && active > total) errors.users_active = ["users_active can't be more than users_total."];
        if (activeDays === null) errors.active_days = ["active_days must be a whole number from 1 to 365."];

        if (Object.keys(errors).length > 0) {
            res.status(422);
            return res.json({ errors });
        }

        await recordMetrics(key.product_id, {
            users_total: total as number,
            users_active: active as number,
            active_days: activeDays as number,
        });

        res.status(204);
        return res.end();
    }
}