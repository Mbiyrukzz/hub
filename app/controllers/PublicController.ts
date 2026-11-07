/**
 * Controller: PublicController
 *
 * The public, read-only, versioned API that Tylix Deploy, tylix.dev and
 * other Ashmif sites call from their own servers.
 *
 *   GET /api/v1/products
 *   GET /api/v1/products/:slug/changelog?limit=50&category=fixed
 *   GET /api/v1/products/:slug/status
 *   GET /api/v1/products/:slug/announcements?phase=active
 *
 * No login. Only live entries of active products are ever returned: drafts,
 * future-scheduled entries and inactive products answer as if they don't
 * exist. Rate limited per address and cacheable for 30 seconds.
 */

import { createRateLimiter } from "@tylix/core";
import type { TylixRequest, TylixResponse } from "@tylix/core";
import { Product, type ProductAttributes } from "../models/Product.js";
import { ChangelogEntry, type ChangelogEntryAttributes } from "../models/ChangelogEntry.js";
import { Announcement, type AnnouncementAttributes } from "../models/Announcement.js";
import { CATEGORIES } from "../validators/ChangelogValidator.js";
import { instantOf, isLive, isoOf, toPublicEntry } from "../services/ChangelogService.js";
import { publicPhaseOf, toPublicAnnouncement, type PublicPhase } from "../services/AnnouncementService.js";
import { ProductApiKey, type ProductApiKeyAttributes } from "../models/ProductApiKey.js";

const limiter = createRateLimiter({ max: 120, windowMs: 60_000 });

const ONLINE_WINDOW_MS = 3 * 60 * 1000;
const PHASES: readonly PublicPhase[] = ["active", "upcoming", "resolved"];
const PHASE_ORDER: Record<PublicPhase, number> = { active: 0, upcoming: 1, resolved: 2 };

function clientIp(req: TylixRequest): string {
    return (req as unknown as { ip?: string }).ip ?? "unknown";
}

function setHeader(res: TylixResponse, name: string, value: string) {
    const r = res as any;
    if (typeof r.setHeader === "function") r.setHeader(name, value);
    else if (typeof r.header === "function") r.header(name, value);
    else if (typeof r.set === "function") r.set(name, value);
}

/** Answers 429 itself; true means the caller may continue. */
function allowed(req: TylixRequest, res: TylixResponse): boolean {
    const limit = limiter(clientIp(req));
    if (limit.allowed) return true;

    res.status(429);
    res.json({ error: `Too many requests. Try again in ${limit.retryAfterSeconds} seconds.` });
    return false;
}

function publicProduct(p: ProductAttributes) {
    return { slug: p.slug, name: p.name, website_url: p.website_url, description: p.description };
}

async function activeProduct(slug: string): Promise<ProductAttributes | null> {
    const product = (await Product.query().where("slug", String(slug).toLowerCase()).first()) as ProductAttributes | null;
    return product && product.is_active ? product : null;
}

export class PublicController {
    async products(req: TylixRequest, res: TylixResponse) {
        if (!allowed(req, res)) return;

        const rows = (await Product.query().where("is_active", 1).orderBy("name", "ASC").get()) as ProductAttributes[];

        setHeader(res, "Cache-Control", "public, max-age=30");
        return res.json({ data: rows.map(publicProduct) });
    }

    async changelog(req: TylixRequest, res: TylixResponse) {
        if (!allowed(req, res)) return;

        const product = await activeProduct(req.params.slug);
        if (!product) {
            res.status(404);
            return res.json({ error: "Product not found." });
        }

        const wanted = String(req.query?.category ?? "").toLowerCase();
        if (wanted && !(CATEGORIES as readonly string[]).includes(wanted)) {
            res.status(422);
            return res.json({ error: `category must be one of: ${CATEGORIES.join(", ")}.` });
        }

        const limit = Math.min(Math.max(Number.parseInt(String(req.query?.limit ?? "50"), 10) || 50, 1), 100);

        const rows = (await ChangelogEntry.query()
            .where("product_id", product.id)
            .orderBy("published_at", "DESC")
            .get()) as ChangelogEntryAttributes[];

        const entries = rows
            .filter((e) => isLive(e) && (!wanted || e.category === wanted))
            .slice(0, limit)
            .map(toPublicEntry);

        setHeader(res, "Cache-Control", "public, max-age=30");
        return res.json({ product: publicProduct(product), data: entries });
    }

    async status(req: TylixRequest, res: TylixResponse) {
        if (!allowed(req, res)) return;

        const product = await activeProduct(req.params.slug);
        if (!product) {
            res.status(404);
            return res.json({ error: "Product not found." });
        }

        const key = (await ProductApiKey.query().where("product_id", product.id).first()) as ProductApiKeyAttributes | null;

        // No key or no heartbeat yet means we simply don't know.
        let state = "unknown";
        let lastSeen: string | null = null;
        if (key && key.last_seen_at) {
            const seenAt = instantOf(key.last_seen_at);
            if (!Number.isNaN(seenAt)) {
                state = Date.now() - seenAt <= ONLINE_WINDOW_MS ? "operational" : "outage";
                lastSeen = isoOf(key.last_seen_at); // always UTC with a Z, so browsers read it right
            }
        }

        setHeader(res, "Cache-Control", "public, max-age=30");
        return res.json({
            product: publicProduct(product),
            status: { state, last_seen_at: lastSeen },
        });
    }

    /**
     * Announcements for one product plus the ones that apply to every
     * product. Active first, then upcoming, then recently resolved.
     */
    async announcements(req: TylixRequest, res: TylixResponse) {
        if (!allowed(req, res)) return;

        const product = await activeProduct(req.params.slug);
        if (!product) {
            res.status(404);
            return res.json({ error: "Product not found." });
        }

        const wanted = String(req.query?.phase ?? "").toLowerCase();
        if (wanted && !(PHASES as readonly string[]).includes(wanted)) {
            res.status(422);
            return res.json({ error: `phase must be one of: ${PHASES.join(", ")}.` });
        }

        const rows = (await Announcement.query().orderBy("created_at", "DESC").get()) as AnnouncementAttributes[];

        const now = Date.now();
        const found: { row: AnnouncementAttributes; phase: PublicPhase }[] = [];
        for (const row of rows) {
            const owner = Number(row.product_id);
            if (owner !== product.id && owner !== 0) continue;

            const phase = publicPhaseOf(row, now);
            if (!phase || (wanted && phase !== wanted)) continue;

            found.push({ row, phase });
        }

        found.sort((a, b) => {
            const byPhase = PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase];
            if (byPhase !== 0) return byPhase;

            const startA = instantOf(a.row.starts_at) || 0;
            const startB = instantOf(b.row.starts_at) || 0;
            return a.phase === "upcoming" ? startA - startB : startB - startA;
        });

        setHeader(res, "Cache-Control", "public, max-age=30");
        return res.json({
            product: publicProduct(product),
            data: found.slice(0, 50).map((f) => toPublicAnnouncement(f.row, f.phase)),
        });
    }
}