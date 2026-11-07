/**
 * Controller: AnnouncementController (admin)
 *
 * Create, edit, resolve and remove announcements. Every route is admin-only.
 * Resolving an active incident or maintenance window just sets its end time
 * to now. product_id 0 means the announcement applies to every product.
 */

import type { TylixRequest, TylixResponse } from "@tylix/core";
import { Announcement, type AnnouncementAttributes } from "../models/Announcement.js";
import { Product } from "../models/Product.js";
import { validateAnnouncement, normalizeAnnouncement } from "../validators/AnnouncementValidator.js";
import { requireHubAdmin } from "../services/AdminGate.js";
import { isoOf, storeInstant } from "../services/ChangelogService.js";
import { adminPhaseOf, toAdminAnnouncement } from "../services/AnnouncementService.js";

async function findRow(req: TylixRequest, res: TylixResponse): Promise<AnnouncementAttributes | null> {
    const row = (await Announcement.find(req.params.id)) as AnnouncementAttributes | null;
    if (!row) {
        res.status(404);
        res.json({ error: "Announcement not found." });
        return null;
    }
    return row;
}

export class AnnouncementController {
    /** Newest first, drafts and ended ones included. */
    async index(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHubAdmin(req, res))) return;

        const rows = (await Announcement.query().orderBy("created_at", "DESC").get()) as AnnouncementAttributes[];
        return res.json(rows.map(toAdminAnnouncement));
    }

    async show(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHubAdmin(req, res))) return;

        const row = await findRow(req, res);
        if (!row) return;

        return res.json(toAdminAnnouncement(row));
    }

    async store(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHubAdmin(req, res))) return;

        const result = validateAnnouncement(req.body);
        if (!result.valid) {
            res.status(422);
            return res.json({ errors: result.errors });
        }

        const input = normalizeAnnouncement(req.body);

        if (input.product_id > 0 && !(await Product.find(input.product_id))) {
            res.status(422);
            return res.json({ errors: { product_id: ["That product doesn't exist."] } });
        }

        let startsIso = input.starts_at;
        if (input.status === "published" && !startsIso) startsIso = new Date().toISOString();

        const row = (await Announcement.create({
            product_id: input.product_id,
            kind: input.kind,
            title: input.title,
            body: input.body,
            status: input.status,
            starts_at: storeInstant(startsIso),
            ends_at: storeInstant(input.ends_at),
            created_by: req.user?.userId,
        })) as AnnouncementAttributes | null;

        if (!row) {
            res.status(500);
            return res.json({ error: "Could not save the announcement." });
        }

        res.status(201);
        return res.json(toAdminAnnouncement(row));
    }

    async update(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHubAdmin(req, res))) return;

        const row = await findRow(req, res);
        if (!row) return;

        const result = validateAnnouncement(req.body);
        if (!result.valid) {
            res.status(422);
            return res.json({ errors: result.errors });
        }

        const input = normalizeAnnouncement(req.body);

        if (input.product_id > 0 && !(await Product.find(input.product_id))) {
            res.status(422);
            return res.json({ errors: { product_id: ["That product doesn't exist."] } });
        }

        let startsIso = input.starts_at;
        if (input.status === "published" && !startsIso) {
            // Keep the original start if there was one, otherwise start now.
            startsIso = isoOf(row.starts_at) || new Date().toISOString();
        }

        await Announcement.update(row.id, {
            product_id: input.product_id,
            kind: input.kind,
            title: input.title,
            body: input.body,
            status: input.status,
            starts_at: storeInstant(startsIso),
            ends_at: storeInstant(input.ends_at),
        });

        const fresh = (await Announcement.find(row.id)) as AnnouncementAttributes | null;
        if (!fresh) {
            res.status(500);
            return res.json({ error: "Could not reload the announcement after saving." });
        }

        return res.json(toAdminAnnouncement(fresh));
    }

    /** Ends an active announcement now. */
    async resolve(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHubAdmin(req, res))) return;

        const row = await findRow(req, res);
        if (!row) return;

        const phase = adminPhaseOf(row);

        if (phase === "draft") {
            res.status(422);
            return res.json({ error: "Only a published announcement can be resolved." });
        }
        if (phase === "upcoming") {
            res.status(409);
            return res.json({ error: "It hasn't started yet. Edit or delete it instead." });
        }

        if (phase === "active") {
            await Announcement.update(row.id, { ends_at: storeInstant(new Date().toISOString()) });
        }

        const fresh = (await Announcement.find(row.id)) as AnnouncementAttributes | null;
        if (!fresh) {
            res.status(500);
            return res.json({ error: "Could not reload the announcement after saving." });
        }

        return res.json(toAdminAnnouncement(fresh));
    }

    async destroy(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHubAdmin(req, res))) return;

        const row = await findRow(req, res);
        if (!row) return;

        await Announcement.delete(row.id);

        res.status(204);
        return res.end();
    }
}