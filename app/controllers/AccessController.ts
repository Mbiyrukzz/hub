import type { TylixRequest, TylixResponse } from "@tylix/core";
import { PermissionError } from "@tylix/permissions";
import { permissions } from "../permissions.js";
import { User } from "../models/User.js";
import { audit } from "../services/Audit.js";

// The admin API behind /admin/access. Every route needs roles.manage
// (see app/routes/access). Changes that would take roles.manage away from
// the person making them are undone, so nobody locks themselves out.
const MANAGE = "roles.manage";

function fail(res: TylixResponse, err: unknown) {
    if (err instanceof PermissionError || err instanceof TypeError) {
        return res.status(422).json({ error: (err as Error).message });
    }
    console.error("[access]", err);
    return res.status(500).json({ error: "Something went wrong. Try again." });
}

const param = (req: TylixRequest, name: string) => decodeURIComponent(String(req.params?.[name] ?? ""));
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const names = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v) => typeof v === "string" && v.trim() !== "").map((v) => v.trim()) : [];

export class AccessController {
    async index(req: TylixRequest, res: TylixResponse) {
        try {
            const catalog = await permissions.catalog();
            const users = (await User.query().orderBy("id").limit(500).get()) as { id: number; name: string; email: string }[];
            const rows = await Promise.all(
                users.map(async (u) => {
                    const assigned = await permissions.for(u).assignments();
                    return {
                        id: u.id,
                        name: u.name,
                        email: u.email,
                        roles: assigned.roles.filter((r) => !r.team).map((r) => r.name),
                    };
                }),
            );
            const counts: Record<string, number> = {};
            for (const u of rows) for (const r of u.roles) counts[r] = (counts[r] ?? 0) + 1;
            const { superAdmin, defaultRoles } = permissions.options;
            return res.json({
                roles: catalog.roles.map((r) => ({
                    ...r,
                    users: counts[r.name] ?? 0,
                    everyone: defaultRoles.includes(r.name),
                    superAdmin: r.name === superAdmin,
                })),
                permissions: catalog.permissions,
                users: rows,
                me: String(req.user?.userId ?? ""),
            });
        } catch (err) {
            return fail(res, err);
        }
    }

    async createRole(req: TylixRequest, res: TylixResponse) {
        try {
            const role = await permissions.createRole(text(req.body?.name), {
                description: text(req.body?.description) || null,
                permissions: names(req.body?.permissions),
                inherits: names(req.body?.inherits),
            });
            await audit(req, "access.role_created", { target: ["role", role.name], summary: `Created role ${role.name}`, meta: { permissions: names(req.body?.permissions), inherits: names(req.body?.inherits) } });
            return res.status(201).json(role);
        } catch (err) {
            return fail(res, err);
        }
    }

    async updateRole(req: TylixRequest, res: TylixResponse) {
        const name = param(req, "name");
        try {
            const before = await permissions.findRole(name);
            const role = await permissions.updateRole(name, {
                description: text(req.body?.description) || null,
                permissions: names(req.body?.permissions),
                inherits: names(req.body?.inherits),
            });
            if (before && !(await permissions.can(req.user, MANAGE))) {
                await permissions.updateRole(name, before);
                return res.status(422).json({ error: "That change would take away your own access to roles. It was not saved." });
            }
            await audit(req, "access.role_updated", { target: ["role", name], summary: `Changed role ${name}`, meta: { permissions: names(req.body?.permissions), inherits: names(req.body?.inherits) } });
            return res.json(role);
        } catch (err) {
            return fail(res, err);
        }
    }

    async deleteRole(req: TylixRequest, res: TylixResponse) {
        const name = param(req, "name");
        try {
            if (name === permissions.options.superAdmin) {
                return res.status(422).json({ error: "The super admin role can't be deleted." });
            }
            const role = await permissions.findRole(name);
            if (!role) return res.status(404).json({ error: "There is no role named " + name + "." });
            // Would deleting it lock the current user out?
            const holders = await permissions.subjectsWithRole(name);
            await permissions.deleteRole(name);
            if (!(await permissions.can(req.user, MANAGE))) {
                await permissions.createRole(name, role);
                for (const h of holders) await permissions.for(h).assignRole(name, { team: h.team, expiresAt: h.expiresAt });
                return res.status(422).json({ error: "Deleting that role would take away your own access to roles. It was kept." });
            }
            await audit(req, "access.role_deleted", { target: ["role", name], summary: `Deleted role ${name}`, meta: { holders: holders.length } });
            return res.json({ ok: true });
        } catch (err) {
            return fail(res, err);
        }
    }

    async createPermission(req: TylixRequest, res: TylixResponse) {
        try {
            const name = text(req.body?.name);
            if ((await permissions.listPermissions()).some((p) => p.name === name)) {
                return res.status(422).json({ error: "A permission named " + name + " already exists." });
            }
            const permission = await permissions.createPermission(name, { description: text(req.body?.description) || null });
            await audit(req, "access.permission_created", { target: ["permission", name], summary: `Created permission ${name}` });
            return res.status(201).json(permission);
        } catch (err) {
            return fail(res, err);
        }
    }

    async deletePermission(req: TylixRequest, res: TylixResponse) {
        const name = param(req, "name");
        try {
            if (name === MANAGE) {
                return res.status(422).json({ error: MANAGE + " guards this page, so it can't be deleted here." });
            }
            await permissions.deletePermission(name);
            await audit(req, "access.permission_deleted", { target: ["permission", name], summary: `Deleted permission ${name}` });
            return res.json({ ok: true });
        } catch (err) {
            return fail(res, err);
        }
    }

    async syncUserRoles(req: TylixRequest, res: TylixResponse) {
        const id = param(req, "id");
        try {
            const user = await User.find(id);
            if (!user) return res.status(404).json({ error: "User not found." });
            const before = (await permissions.for(id).assignments()).roles.filter((r) => !r.team).map((r) => r.name);
            await permissions.for(id).syncRoles(names(req.body?.roles));
            if (!(await permissions.can(req.user, MANAGE))) {
                await permissions.for(id).syncRoles(before);
                return res.status(422).json({ error: "That would take away your own access to roles. It was not saved." });
            }
            const after = (await permissions.for(id).assignments()).roles.filter((r) => !r.team).map((r) => r.name);
            const added = after.filter((r) => !before.includes(r));
            const removed = before.filter((r) => !after.includes(r));
            if (added.length + removed.length > 0) {
                const parts = [added.length ? `gave ${added.join(", ")}` : "", removed.length ? `took away ${removed.join(", ")}` : ""].filter(Boolean);
                await audit(req, "access.roles_assigned", { target: ["user", user.id], summary: `${user.email}: ${parts.join("; ")}`, meta: { added, removed } });
            }
            return res.json({ id: user.id, roles: after });
        } catch (err) {
            return fail(res, err);
        }
    }
}
