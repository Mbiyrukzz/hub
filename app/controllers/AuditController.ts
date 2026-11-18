/**
 * Controller: AuditController (admin)
 *
 *   GET /api/admin/audit?category=auth&actor=ada@&before=<id>&limit=50   audit.view
 *
 * Newest first, 50 at a time; pass the last id as `before` for the next
 * page. `actor` matches the start of the email. The download is
 * GET /api/admin/audit/export (ReportController).
 */

import type { TylixRequest, TylixResponse } from "@tylix/core";
import { AuditLog, type AuditLogAttributes } from "../models/AuditLog.js";
import { requireHub } from "../services/AdminGate.js";
import { toEntry } from "../services/Audit.js";

export const AUDIT_CATEGORIES = ["auth", "account", "product", "changelog", "announcement", "access", "report"];

export class AuditController {
    async index(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHub(req, res, "audit.view"))) return;

        const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 200);
        const before = Number(req.query?.before);
        const category = String(req.query?.category ?? "");
        const actor = String(req.query?.actor ?? "").trim().toLowerCase();

        let query = AuditLog.query();
        if (AUDIT_CATEGORIES.includes(category)) query = query.where("category", category);
        if (Number.isInteger(before) && before > 0) query = query.where("id", "<", before);
        // The query builder has no LIKE, so the email filter runs on a wider page.
        const rows = (await query.orderBy("id", "DESC").limit(actor ? 2000 : limit + 1).get()) as AuditLogAttributes[];
        const matching = actor ? rows.filter((r) => String(r.actor_email ?? "").startsWith(actor)) : rows;

        const page = matching.slice(0, limit).map(toEntry);
        return res.json({
            entries: page,
            categories: AUDIT_CATEGORIES,
            next: matching.length > limit ? page[page.length - 1].id : null,
        });
    }
}
