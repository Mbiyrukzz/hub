/**
 * Controller: TwoFactorController (signed in)
 *
 *   GET  /api/account/two-factor                  is it on, may I turn it on
 *   POST /api/account/two-factor/setup            { password } -> QR code and key
 *   POST /api/account/two-factor/confirm          { code } -> recovery codes (shown once)
 *   POST /api/account/two-factor/recovery-codes   { code } -> a fresh set
 *   POST /api/account/two-factor/disable          { password, code }
 *
 * The sign-in step itself (POST /api/auth/two-factor) is in AuthController.
 * Turning it on needs the account.two-factor permission; every change
 * needs the password or a current code, so a borrowed, unlocked laptop
 * isn't enough to switch it off. All of it lands in the audit log.
 */

import type { TylixRequest, TylixResponse } from "@tylix/core";
import { createRateLimiter } from "@tylix/core";
import { verifyPassword } from "@tylix/auth";
import { User, type UserAttributes } from "../models/User.js";
import { permissions } from "../permissions.js";
import { audit } from "../services/Audit.js";
import * as TwoFactor from "../services/TwoFactor.js";
import { authController } from "./AuthController.js";

const PERMISSION = "account.two-factor";
const limiter = createRateLimiter({ name: "two-factor-account", max: 10, windowMs: 15 * 60 * 1000, store: "shared" });

function userId(req: TylixRequest): number {
    return Number((req.user as { userId?: unknown } | undefined)?.userId);
}

async function load(req: TylixRequest, res: TylixResponse): Promise<UserAttributes | null> {
    const limit = await limiter(String(userId(req)));
    if (!limit.allowed) {
        res.setHeader("Retry-After", String(limit.retryAfterSeconds));
        res.status(429).json({ error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.` });
        return null;
    }
    const user = await User.find(userId(req));
    if (!user) {
        res.status(404).json({ error: "User not found." });
        return null;
    }
    return user;
}

function wrongPassword(res: TylixResponse) {
    return res.status(422).json({ errors: { password: ["That password is incorrect."] } });
}

function wrongCode(res: TylixResponse) {
    return res.status(422).json({ errors: { code: ["That code didn't work. Codes change every 30 seconds."] } });
}

export class TwoFactorController {
    get sealer() {
        return authController().auth.sealer;
    }

    async status(req: TylixRequest, res: TylixResponse) {
        const user = await User.find(userId(req));
        if (!user) return res.status(404).json({ error: "User not found." });
        const enabled = User.hasTwoFactor(user);
        return res.json({
            enabled,
            allowed: enabled || (await permissions.can(user, PERMISSION)),
            confirmedAt: enabled ? user.two_factor_confirmed_at : null,
            recoveryCodesLeft: enabled ? TwoFactor.recoveryCodesLeft(user) : 0,
        });
    }

    async setup(req: TylixRequest, res: TylixResponse) {
        const user = await load(req, res);
        if (!user) return;
        if (!(await permissions.can(user, PERMISSION))) {
            return res.status(403).json({ error: "Two-factor sign-in isn't offered for your role yet.", required: PERMISSION });
        }
        if (User.hasTwoFactor(user)) {
            return res.status(409).json({ error: "Two-factor sign-in is already on. Turn it off first to use a new app." });
        }
        if (!(await verifyPassword(String(req.body?.password ?? ""), user.password))) return wrongPassword(res);

        const { secret, uri, qr } = await TwoFactor.beginSetup(user, this.sealer);
        return res.json({ secret, uri, qr, issuer: TwoFactor.issuer() });
    }

    async confirm(req: TylixRequest, res: TylixResponse) {
        const user = await load(req, res);
        if (!user) return;
        if (User.hasTwoFactor(user)) return res.status(409).json({ error: "Two-factor sign-in is already on." });
        if (!user.two_factor_secret) return res.status(409).json({ error: "Start the setup again: there is no key waiting." });

        const codes = await TwoFactor.confirmSetup(user, String(req.body?.code ?? ""), this.sealer);
        if (!codes) return wrongCode(res);

        await audit(req, "account.two_factor_enabled", { target: ["user", user.id], summary: "Turned on two-factor sign-in" });
        return res.json({ recoveryCodes: codes });
    }

    async recoveryCodes(req: TylixRequest, res: TylixResponse) {
        const user = await load(req, res);
        if (!user) return;
        if (!User.hasTwoFactor(user)) return res.status(409).json({ error: "Two-factor sign-in is off." });

        const check = await TwoFactor.checkCode(user, req.body?.code, this.sealer);
        if (!check.ok) return wrongCode(res);

        const codes = await TwoFactor.newRecoveryCodes(user);
        await audit(req, "account.recovery_codes_renewed", { target: ["user", user.id], summary: "Made new recovery codes (the old ones stopped working)" });
        return res.json({ recoveryCodes: codes });
    }

    async disable(req: TylixRequest, res: TylixResponse) {
        const user = await load(req, res);
        if (!user) return;
        if (!User.hasTwoFactor(user)) return res.status(409).json({ error: "Two-factor sign-in is already off." });
        if (!(await verifyPassword(String(req.body?.password ?? ""), user.password))) return wrongPassword(res);

        const check = await TwoFactor.checkCode(user, req.body?.code, this.sealer);
        if (!check.ok) return wrongCode(res);

        await TwoFactor.disable(user);
        await audit(req, "account.two_factor_disabled", { target: ["user", user.id], summary: "Turned off two-factor sign-in" });
        return res.json({ ok: true });
    }
}
