/**
 * Controller: ChangelogController (admin)
 *
 * Create, edit and remove changelog entries. Every route is admin-only.
 * Versions are unique per product. The product of an entry never changes.
 */

import type { TylixRequest, TylixResponse } from "@tylix/core";
import { ChangelogEntry, type ChangelogEntryAttributes } from "../models/ChangelogEntry.js";
import { Product } from "../models/Product.js";
import { validateEntry, normalizeEntry } from "../validators/ChangelogValidator.js";
import { requireHubAdmin } from "../services/AdminGate.js";
import { isoOf, storeInstant, toAdminEntry } from "../services/ChangelogService.js";

async function findEntry(req: TylixRequest, res: TylixResponse): Promise<ChangelogEntryAttributes | null> {
    const entry = (await ChangelogEntry.find(req.params.id)) as ChangelogEntryAttributes | null;
    if (!entry) {
        res.status(404);
        res.json({ error: "Changelog entry not found." });
        return null;
    }
    return entry;
}

async function versionTaken(productId: number, version: string, exceptId?: number): Promise<boolean> {
    const rows = (await ChangelogEntry.query().where("product_id", productId).get()) as ChangelogEntryAttributes[];
    return rows.some((r) => r.version.toLowerCase() === version.toLowerCase() && r.id !== exceptId);
}

export class ChangelogController {
    /** Optional ?product_id= filter. Newest first, drafts included. */
    async index(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHubAdmin(req, res))) return;

        const productId = Number(req.query?.product_id);
        const query = ChangelogEntry.query();
        const rows = (
            Number.isInteger(productId) && productId > 0
                ? await query.where("product_id", productId).orderBy("created_at", "DESC").get()
                : await query.orderBy("created_at", "DESC").get()
        ) as ChangelogEntryAttributes[];

        return res.json(rows.map(toAdminEntry));
    }

    async show(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHubAdmin(req, res))) return;

        const entry = await findEntry(req, res);
        if (!entry) return;

        return res.json(toAdminEntry(entry));
    }

    async store(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHubAdmin(req, res))) return;

        const result = validateEntry(req.body);
        if (!result.valid) {
            res.status(422);
            return res.json({ errors: result.errors });
        }

        const input = normalizeEntry(req.body);

        if (!(await Product.find(input.product_id))) {
            res.status(422);
            return res.json({ errors: { product_id: ["That product doesn't exist."] } });
        }

        if (await versionTaken(input.product_id, input.version)) {
            res.status(409);
            return res.json({ errors: { version: ["This product already has an entry with that version."] } });
        }

        let publishedIso = input.published_at;
        if (input.status === "published" && !publishedIso) publishedIso = new Date().toISOString();
        if (input.status === "draft") publishedIso = "";

        const entry = (await ChangelogEntry.create({
            ...input,
            published_at: storeInstant(publishedIso),
            created_by: req.user?.userId,
        })) as ChangelogEntryAttributes | null;

        if (!entry) {
            res.status(500);
            return res.json({ error: "Could not save the entry." });
        }

        res.status(201);
        return res.json(toAdminEntry(entry));
    }

    async update(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHubAdmin(req, res))) return;

        const entry = await findEntry(req, res);
        if (!entry) return;

        const result = validateEntry(req.body, { isUpdate: true });
        if (!result.valid) {
            res.status(422);
            return res.json({ errors: result.errors });
        }

        const input = normalizeEntry(req.body);

        if (await versionTaken(entry.product_id, input.version, entry.id)) {
            res.status(409);
            return res.json({ errors: { version: ["This product already has an entry with that version."] } });
        }

        let publishedIso = input.published_at;
        if (input.status === "draft") publishedIso = "";
        else if (input.status === "published" && !publishedIso) {
            // Keep the original publish time if there was one.
            const before = isoOf(entry.published_at);
            publishedIso = entry.status === "published" && before ? before : new Date().toISOString();
        }

        await ChangelogEntry.update(entry.id, {
            version: input.version,
            title: input.title,
            body: input.body,
            category: input.category,
            status: input.status,
            published_at: storeInstant(publishedIso),
        });

        const fresh = (await ChangelogEntry.find(entry.id)) as ChangelogEntryAttributes | null;
        if (!fresh) {
            res.status(500);
            return res.json({ error: "Could not reload the entry after saving." });
        }

        return res.json(toAdminEntry(fresh));
    }

    async destroy(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHubAdmin(req, res))) return;

        const entry = await findEntry(req, res);
        if (!entry) return;

        await ChangelogEntry.delete(entry.id);

        res.status(204);
        return res.end();
    }
}