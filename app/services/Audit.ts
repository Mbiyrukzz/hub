/**
 * Service: Audit
 *
 * The audit log: who signed in (or failed to), and who changed what in the
 * console. Read it in /admin/audit (audit.view).
 *
 *   await audit(req, "product.updated", { target: ["product", p.id], summary: `Updated product ${p.name}` })
 *
 * The actor is the signed-in user of `req` unless `actor` says otherwise
 * (failed sign-ins name the account that was tried). Recording never
 * throws: a full disk or a missing table must not break a sign-in or a
 * save. Never put passwords, codes, keys or tokens in `meta`.
 *
 * Rows older than AUDIT_RETENTION_DAYS (default 365) are removed by the
 * daily task in app/schedule.ts (tylix schedule:work).
 */

import type { TylixRequest } from "@tylix/core";
import { Log } from "@tylix/core";
import { AuditLog, type AuditLogAttributes } from "../models/AuditLog.js";
import { User } from "../models/User.js";

export interface AuditActor {
    id?: number | null;
    email?: string | null;
}

export interface AuditOptions {
    /** Defaults to req.user. Pass { id, email } for sign-ins, or null for "nobody". */
    actor?: AuditActor | null;
    /** [type, id], for example ["product", 12] or ["role", "editor"]. */
    target?: [string, string | number] | null;
    /** One readable line. Defaults to the action. */
    summary?: string;
    /** Extra details, stored as JSON. Never secrets. */
    meta?: Record<string, unknown>;
}

function headerOf(req: TylixRequest | null, name: string): string | null {
    const value = req?.headers?.[name];
    if (Array.isArray(value)) return value[0] ?? null;
    return typeof value === "string" ? value : null;
}

function ipOf(req: TylixRequest | null): string | null {
    return ((req as unknown as { ip?: string } | null)?.ip ?? null) || null;
}

async function actorOf(req: TylixRequest | null, given: AuditActor | null | undefined): Promise<AuditActor> {
    if (given === null) return {};
    if (given) {
        if (given.id && !given.email) {
            const user = await User.find(given.id).catch(() => null);
            return { id: given.id, email: user?.email ?? null };
        }
        return given;
    }
    const id = Number((req?.user as { userId?: unknown } | undefined)?.userId);
    if (!Number.isInteger(id) || id <= 0) return {};
    const user = await User.find(id).catch(() => null);
    return { id, email: user?.email ?? null };
}

export async function audit(req: TylixRequest | null, action: string, options: AuditOptions = {}): Promise<void> {
    try {
        const actor = await actorOf(req, options.actor);
        const [targetType, targetId] = options.target ?? [null, null];
        await AuditLog.create({
            action,
            category: action.split(".")[0],
            actor_id: actor.id ?? null,
            actor_email: actor.email ? String(actor.email).toLowerCase().slice(0, 255) : null,
            target_type: targetType,
            target_id: targetId == null ? null : String(targetId).slice(0, 191),
            summary: (options.summary ?? action).slice(0, 500),
            meta: options.meta && Object.keys(options.meta).length > 0 ? JSON.stringify(options.meta) : null,
            ip: ipOf(req)?.slice(0, 64) ?? null,
            user_agent: headerOf(req, "user-agent")?.slice(0, 1000) ?? null,
        });
    } catch (err) {
        Log.error("Audit log entry could not be written", { action, error: err });
    }
}

/** The fields that changed between two rows, for "updated" entries. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>, fields: string[]): string[] {
    // Booleans come back from the database as 1/0.
    const norm = (v: unknown) => (v === true ? "1" : v === false ? "0" : v instanceof Date ? v.toISOString() : String(v ?? ""));
    return fields.filter((f) => f in after && norm(before[f]) !== norm(after[f]));
}

export interface AuditEntry {
    id: number;
    action: string;
    category: string;
    actor_id: number | null;
    actor_email: string | null;
    target_type: string | null;
    target_id: string | null;
    summary: string;
    meta: Record<string, unknown> | null;
    ip: string | null;
    user_agent: string | null;
    created_at: string;
}

export function toEntry(row: AuditLogAttributes): AuditEntry {
    let meta: Record<string, unknown> | null = null;
    if (row.meta) {
        try {
            meta = JSON.parse(row.meta);
        } catch {
            meta = null;
        }
    }
    const created = new Date(row.created_at as unknown as string);
    return {
        id: Number(row.id),
        action: row.action,
        category: row.category,
        actor_id: row.actor_id == null ? null : Number(row.actor_id),
        actor_email: row.actor_email,
        target_type: row.target_type,
        target_id: row.target_id,
        summary: row.summary,
        meta,
        ip: row.ip,
        user_agent: row.user_agent,
        created_at: Number.isNaN(created.getTime()) ? String(row.created_at) : created.toISOString(),
    };
}

/** Removes entries older than AUDIT_RETENTION_DAYS (default 365). Returns how many. */
export async function pruneAuditLog(now: number = Date.now()): Promise<number> {
    const days = Number(process.env.AUDIT_RETENTION_DAYS ?? 365);
    if (!Number.isFinite(days) || days <= 0) return 0;
    const cutoff = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
    let removed = 0;
    // In batches, so a first run over a big table doesn't hold one huge statement.
    for (;;) {
        const old = (await AuditLog.query().where("created_at", "<", cutoff).limit(500).get()) as AuditLogAttributes[];
        if (old.length === 0) break;
        await AuditLog.destroy(...old.map((r) => r.id));
        removed += old.length;
        if (old.length < 500) break;
    }
    return removed;
}
