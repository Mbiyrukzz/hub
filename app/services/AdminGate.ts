/**
 * Who may use the Hub's admin API.
 *
 * Signing up is not enough: the account's verified email must be listed in
 * HUB_ADMINS (comma separated). An empty or missing list lets nobody in.
 */

import type { TylixRequest, TylixResponse } from "@tylix/core";
import { User } from "../models/User.js";

function admins(): string[] {
    return (process.env.HUB_ADMINS ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);
}

/** Answers 403 itself; true means the caller is an admin. */
export async function requireHubAdmin(req: TylixRequest, res: TylixResponse): Promise<boolean> {
    const user = await User.find(req.user?.userId as number);

    if (!user || !User.isEmailVerified(user) || !admins().includes(String(user.email).toLowerCase())) {
        res.status(403);
        res.json({ error: "You don't have access to the Hub admin." });
        return false;
    }

    return true;
}