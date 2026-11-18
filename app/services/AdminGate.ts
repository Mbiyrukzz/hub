/**
 * Who may use the Hub's admin API.
 *
 * Signing in is not enough: the account needs a verified email and a role
 * that grants the permission the action needs (app/permissions). Roles are
 * given in /admin/access or with "tylix permission:assign".
 *
 * HUB_ADMINS is kept as a bootstrap list: PermissionSeeder makes those
 * accounts admins, and downtime alerts still reach them.
 */

import type { TylixRequest, TylixResponse } from "@tylix/core";
import { User } from "../models/User.js";
import { permissions } from "../permissions.js";

/** The lowercased emails listed in HUB_ADMINS. */
export function hubAdminEmails(): string[] {
    return (process.env.HUB_ADMINS ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);
}

/** Answers 403 itself; true means the caller may do `permission`. */
export async function requireHub(req: TylixRequest, res: TylixResponse, permission: string): Promise<boolean> {
    const user = await User.find(req.user?.userId as number);

    if (!user || !User.isEmailVerified(user) || !(await permissions.can(user, permission))) {
        res.status(403);
        res.json({ error: "You don't have access to this part of the Hub.", required: permission });
        return false;
    }

    return true;
}

/**
 * Where downtime alerts go: every verified account that may receive them,
 * plus the HUB_ADMINS bootstrap list. Deduplicated and lowercased.
 */
export async function alertRecipients(): Promise<string[]> {
    const emails = new Set(hubAdminEmails());
    for (const user of await User.all()) {
        if (User.isEmailVerified(user) && (await permissions.can(user, "alerts.receive"))) {
            emails.add(String(user.email).toLowerCase());
        }
    }
    return [...emails];
}
