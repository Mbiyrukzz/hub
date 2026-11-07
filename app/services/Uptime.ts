/**
 * Service: Uptime
 *
 * Records how long each product was silent, one row per product per UTC
 * day, and turns those rows into the uptime report the public API serves.
 *
 * "Silent" follows the same rule as the Status page: no heartbeat for
 * ONLINE_WINDOW_MS counts as down. When a heartbeat arrives after a gap
 * longer than that window, the gap (minus one normal beat interval) is
 * added as downtime to the day or days it covered. An outage that is still
 * going on is added at read time, so the report is right while it happens.
 *
 * History starts at the first heartbeat ever recorded. Time before that is
 * "no data", never 100%. Time the Hub itself was down counts against the
 * product, because no heartbeat could arrive.
 */

import { UptimeDay, type UptimeDayAttributes } from "../models/UptimeDay.js";
import { instantOf } from "./ChangelogService.js";

export const ONLINE_WINDOW_MS = 3 * 60 * 1000;

const BEAT_INTERVAL_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 90;
const BACKFILL_LIMIT_DAYS = 120;

// Which UTC day this process already made sure has a row, per product.
const ensured = new Map<number, string>();

function dayKey(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

function dayStartOf(ms: number): number {
    return Math.floor(ms / DAY_MS) * DAY_MS;
}

function slotOf(productId: number, day: string): string {
    return `${productId}:${day}`;
}

async function addToDay(productId: number, dayStart: number, seconds: number, startedAt: number): Promise<void> {
    const day = dayKey(dayStart);
    const row = (await UptimeDay.query().where("slot", slotOf(productId, day)).first()) as UptimeDayAttributes | null;

    if (row) {
        if (seconds > 0) await UptimeDay.update(row.id, { down_seconds: Number(row.down_seconds || 0) + seconds });
        return;
    }

    await UptimeDay.create({
        slot: slotOf(productId, day),
        product_id: productId,
        day,
        down_seconds: seconds,
        started_at: String(startedAt),
    });
}

/**
 * Call after every accepted heartbeat, with the last_seen_at value the
 * product had BEFORE this beat. Never throws: counting must not break a
 * heartbeat.
 */
export async function recordBeat(productId: number, previousSeenAt: unknown, now: number = Date.now()): Promise<void> {
    try {
        const today = dayKey(now);
        if (ensured.get(productId) !== today) {
            await addToDay(productId, dayStartOf(now), 0, now);
            ensured.set(productId, today);
        }

        const previous = instantOf(previousSeenAt);
        if (Number.isNaN(previous)) return; // first beat ever, or a freshly rotated key

        if (now - previous <= ONLINE_WINDOW_MS) return;

        // Silent for the gap, minus the one beat that was due anyway.
        let from = previous + BEAT_INTERVAL_MS;
        const earliest = now - BACKFILL_LIMIT_DAYS * DAY_MS;
        if (from < earliest) from = earliest;

        for (let start = dayStartOf(from); start < now; start += DAY_MS) {
            const overlap = Math.min(start + DAY_MS, now) - Math.max(start, from);
            if (overlap > 0) await addToDay(productId, start, Math.round(overlap / 1000), start);
        }
    } catch (err) {
        console.error("Uptime could not record a heartbeat:", err);
    }
}

export interface UptimeDayReport {
    day: string; // YYYY-MM-DD, UTC
    uptime_percent: number | null; // null = not monitored yet
    down_minutes: number;
}

export interface UptimeReport {
    uptime_percent: number | null;
    days: UptimeDayReport[]; // oldest first, today last
}

function percent(down: number, window: number): number {
    return Math.round((1 - down / window) * 10000) / 100;
}

export async function uptimeFor(
    productId: number,
    lastSeenAt: unknown,
    days: number,
    now: number = Date.now(),
): Promise<UptimeReport> {
    const count = Math.min(Math.max(Math.floor(days) || MAX_DAYS, 1), MAX_DAYS);

    const rows = (await UptimeDay.query().where("product_id", productId).orderBy("day", "ASC").get()) as UptimeDayAttributes[];

    // Rows are summed per day, so a rare duplicate row can't lose downtime.
    const downByDay = new Map<string, number>();
    let since = NaN;
    for (const row of rows) {
        downByDay.set(row.day, (downByDay.get(row.day) ?? 0) + Number(row.down_seconds || 0) * 1000);

        const started = instantOf(row.started_at);
        if (!Number.isNaN(started) && (Number.isNaN(since) || started < since)) since = started;
    }

    // An outage that has not ended yet is not in the table, so add it here.
    const seen = instantOf(lastSeenAt);
    const openFrom = Number.isNaN(seen) || now - seen <= ONLINE_WINDOW_MS ? NaN : seen + BEAT_INTERVAL_MS;

    const todayStart = dayStartOf(now);
    const out: UptimeDayReport[] = [];
    let totalWindow = 0;
    let totalDown = 0;

    for (let i = count - 1; i >= 0; i--) {
        const dayStart = todayStart - i * DAY_MS;
        const dayEnd = Math.min(dayStart + DAY_MS, now);
        const label = dayKey(dayStart);

        const from = Number.isNaN(since) ? dayEnd : Math.max(dayStart, since);
        const window = dayEnd - from;

        if (window <= 0) {
            out.push({ day: label, uptime_percent: null, down_minutes: 0 });
            continue;
        }

        let down = downByDay.get(label) ?? 0;
        if (!Number.isNaN(openFrom)) down += Math.max(0, dayEnd - Math.max(openFrom, from));
        down = Math.min(down, window);

        totalWindow += window;
        totalDown += down;
        out.push({ day: label, uptime_percent: percent(down, window), down_minutes: Math.round(down / 60000) });
    }

    return {
        uptime_percent: totalWindow > 0 ? percent(totalDown, totalWindow) : null,
        days: out,
    };
}