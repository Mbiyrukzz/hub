/**
 * Controller: IngestController
 *
 * Sites push to the Hub here, authenticated by their product's API key:
 *   POST /api/v1/ingest/heartbeat  { version?: string }
 *   POST /api/v1/ingest/events     { type, message?, meta?, at? }
 */

import crypto from "node:crypto";
import { createRateLimiter } from "@tylix/core";
import type { TylixRequest, TylixResponse } from "@tylix/core";
import { ProductApiKey, type ProductApiKeyAttributes } from "../models/ProductApiKey.js";
import { StatusEvent } from "../models/StatusEvent.js";
import { recordBeat } from "../services/Uptime.js";

const EVENT_TYPES = ["deploy.started", "deploy.succeeded", "deploy.failed", "server.unreachable", "server.recovered"] as const;

const limiter = createRateLimiter({ max: 120, windowMs: 60_000 });

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
}