/**
 * Shared rules for which announcements are public, and what one looks like
 * when it leaves the API.
 *
 * Times are stored the same way as changelog dates (epoch milliseconds in a
 * text column), so the helpers from ChangelogService are reused.
 *
 * Public phases:
 *   upcoming  published, start time not reached yet
 *   active    started and not ended
 *   resolved  ended within the last 14 days (kept for the history list)
 * Anything older, and every draft, answers as if it doesn't exist.
 */

import { instantOf, isoOf } from "./ChangelogService.js";

const RESOLVED_VISIBLE_MS = 14 * 24 * 60 * 60 * 1000;

export interface AnnouncementRow {
    id: number;
    product_id: number;
    kind: string;
    title: string;
    body: string;
    status: string;
    starts_at: unknown;
    ends_at: unknown;
}

export type PublicPhase = "upcoming" | "active" | "resolved";
export type AdminPhase = "draft" | "upcoming" | "active" | "ended";

function startOf(row: AnnouncementRow): number {
    const at = instantOf(row.starts_at);
    return Number.isNaN(at) ? 0 : at;
}

function endOf(row: AnnouncementRow): number {
    const at = instantOf(row.ends_at);
    return Number.isNaN(at) ? Infinity : at;
}

/** The phase a visitor sees, or null when the announcement is not public. */
export function publicPhaseOf(row: AnnouncementRow, now = Date.now()): PublicPhase | null {
    if (row.status !== "published") return null;

    if (now < startOf(row)) return "upcoming";
    if (now < endOf(row)) return "active";
    return now - endOf(row) <= RESOLVED_VISIBLE_MS ? "resolved" : null;
}

/** The phase the admin list shows. Includes drafts and old ended ones. */
export function adminPhaseOf(row: AnnouncementRow, now = Date.now()): AdminPhase {
    if (row.status !== "published") return "draft";

    if (now < startOf(row)) return "upcoming";
    return now < endOf(row) ? "active" : "ended";
}

export function toPublicAnnouncement(row: AnnouncementRow, phase: PublicPhase) {
    return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body, // Markdown. Consumers render it themselves.
        phase,
        applies_to_all: Number(row.product_id) === 0,
        starts_at: isoOf(row.starts_at) || null,
        ends_at: isoOf(row.ends_at) || null,
    };
}

/** The admin API returns the whole row, with dates normalized and the phase added. */
export function toAdminAnnouncement<T extends AnnouncementRow>(row: T) {
    return {
        ...row,
        starts_at: isoOf(row.starts_at),
        ends_at: isoOf(row.ends_at),
        phase: adminPhaseOf(row),
    };
}