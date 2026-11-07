/**
 * Shared rules for what counts as public, and what an entry looks like
 * when it leaves the API.
 *
 * published_at is stored as epoch milliseconds in a text column. A date
 * string would be converted to the server's local time by the database
 * layer, with no zone marker, and read back wrong on a server in another
 * timezone. Rows saved before this change hold a "YYYY-MM-DD HH:MM:SS"
 * string; instantOf() still reads those.
 */

import type { ChangelogEntryAttributes } from "../models/ChangelogEntry.js";

/** Milliseconds since 1970, or NaN when there is no usable date. */
export function instantOf(value: unknown): number {
    if (value === null || value === undefined || value === "") return NaN;
    if (value instanceof Date) return value.getTime();

    const text = String(value).trim();
    if (/^\d{10,}$/.test(text)) return Number(text);

    return new Date(text).getTime(); // older rows
}

/** What goes into the published_at column. */
export function storeInstant(iso: string): string {
    const at = new Date(iso).getTime();
    return Number.isNaN(at) ? "" : String(at);
}

/** An ISO 8601 string (UTC), or "" when there is no date. */
export function isoOf(value: unknown): string {
    const at = instantOf(value);
    return Number.isNaN(at) ? "" : new Date(at).toISOString();
}

/**
 * Live means published, or scheduled with a time that has passed.
 * Scheduled entries need no background job: they start passing this
 * check when their time comes.
 */
export function isLive(entry: Pick<ChangelogEntryAttributes, "status" | "published_at">): boolean {
    if (entry.status !== "published" && entry.status !== "scheduled") return false;

    const at = instantOf(entry.published_at);
    return !Number.isNaN(at) && at <= Date.now();
}

export function toPublicEntry(entry: ChangelogEntryAttributes) {
    return {
        id: entry.id,
        version: entry.version,
        title: entry.title,
        body: entry.body, // Markdown. Consumers render it themselves.
        category: entry.category,
        published_at: isoOf(entry.published_at),
    };
}

/** The admin API returns the whole row, with the date normalized. */
export function toAdminEntry(entry: ChangelogEntryAttributes) {
    return { ...entry, published_at: isoOf(entry.published_at) };
}