/**
 * Service: TwoFactor
 *
 * Two-factor sign-in with an authenticator app (TOTP, RFC 6238) and
 * one-time recovery codes, on top of @tylix/auth's primitives.
 *
 *   - The TOTP key is sealed (AES-GCM, purpose "totp") with AUTH_SECRET
 *     before it's stored. A database dump alone can't produce codes.
 *   - An accepted code's 30-second step is stored, and the update is a
 *     compare-and-set, so the same code can't be used twice, not even by
 *     two requests racing each other.
 *   - Recovery codes are stored as hashes and each works once.
 *
 * Who may turn it on: the account.two-factor permission (admins, see
 * app/permissions). Anyone who has it on is asked for a code at every
 * sign-in, password or Google/GitHub, even if the permission is later
 * taken away.
 */

import { generateTotpSecret, totpUri, verifyTotp, generateRecoveryCodes, verifyRecoveryCode } from "@tylix/auth";
import type { Sealer } from "@tylix/auth";
import { qrMatrix } from "@tylix/pdf";
import { User, type UserAttributes } from "../models/User.js";

const PURPOSE = "totp";

export function issuer(): string {
    return process.env.TWO_FACTOR_ISSUER || "Ashmif Hub";
}

/** An SVG QR code for `text`, black on white with the standard quiet zone. */
export function qrSvg(text: string): string {
    const rows = qrMatrix(text, { level: "M" }) as ArrayLike<ArrayLike<unknown>>;
    const size = rows.length;
    const quiet = 4;
    const full = size + quiet * 2;
    let d = "";
    for (let y = 0; y < size; y++) {
        const row = rows[y];
        for (let x = 0; x < size; x++) {
            if (row[x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
        }
    }
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges" role="img" aria-label="QR code for your authenticator app">` +
        `<rect width="${full}" height="${full}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`
    );
}

function recoveryHashes(user: UserAttributes): string[] {
    try {
        const parsed = JSON.parse(String(user.two_factor_recovery_codes ?? "[]"));
        return Array.isArray(parsed) ? parsed.filter((h) => typeof h === "string") : [];
    } catch {
        return [];
    }
}

export function recoveryCodesLeft(user: UserAttributes): number {
    return recoveryHashes(user).length;
}

/**
 * Starts (or restarts) setup: a new key, stored sealed but not active until
 * confirm() sees a code from it. Refused while two-factor is already on.
 */
export async function beginSetup(user: UserAttributes, sealer: Sealer): Promise<{ secret: string; uri: string; qr: string }> {
    const secret = generateTotpSecret();
    await User.update(user.id, {
        two_factor_secret: await sealer.seal(secret, { purpose: PURPOSE }),
        two_factor_confirmed_at: null,
        two_factor_last_step: null,
        two_factor_recovery_codes: null,
    });
    const uri = totpUri({ secret, issuer: issuer(), account: user.email });
    return { secret, uri, qr: qrSvg(uri) };
}

async function secretOf(user: UserAttributes, sealer: Sealer): Promise<string | null> {
    if (!user.two_factor_secret) return null;
    const secret = await sealer.unseal<string>(String(user.two_factor_secret), { purpose: PURPOSE });
    return typeof secret === "string" ? secret : null;
}

/**
 * Checks a TOTP code and records its step atomically. False for a wrong,
 * stale or already-used code.
 */
async function acceptTotp(user: UserAttributes, code: string, sealer: Sealer): Promise<boolean> {
    const secret = await secretOf(user, sealer);
    if (!secret) return false;

    const last = user.two_factor_last_step == null ? null : Number(user.two_factor_last_step);
    const { valid, step } = await verifyTotp(code, secret, { lastUsedStep: last });
    if (!valid || step == null) return false;

    // Compare-and-set: only one request can move the step forward from `last`.
    if (last == null) {
        await User.update(user.id, { two_factor_last_step: step });
        return true;
    }
    const claimed = await User.updateWhere({ id: user.id, two_factor_last_step: last }, { two_factor_last_step: step });
    return claimed === 1;
}

/** Finishes setup. Returns the recovery codes to show once, or null for a wrong code. */
export async function confirmSetup(user: UserAttributes, code: string, sealer: Sealer): Promise<string[] | null> {
    if (User.hasTwoFactor(user) || !user.two_factor_secret) return null;
    if (!(await acceptTotp(user, code, sealer))) return null;

    const { codes, hashes } = await generateRecoveryCodes();
    await User.update(user.id, {
        two_factor_confirmed_at: new Date().toISOString(),
        two_factor_recovery_codes: JSON.stringify(hashes),
    });
    return codes;
}

export type CodeCheck = { ok: true; method: "totp" | "recovery"; recoveryLeft: number } | { ok: false };

/**
 * A sign-in (or a sensitive change) needs a code. Accepts a 6-digit TOTP
 * code or a recovery code (XXXXX-XXXXX); a used recovery code is removed.
 */
export async function checkCode(user: UserAttributes, input: unknown, sealer: Sealer): Promise<CodeCheck> {
    if (!User.hasTwoFactor(user)) return { ok: false };
    const code = String(input ?? "").trim();
    if (!code || code.length > 32) return { ok: false };

    if (/^\d[\d\s]*$/.test(code)) {
        return (await acceptTotp(user, code, sealer))
            ? { ok: true, method: "totp", recoveryLeft: recoveryCodesLeft(user) }
            : { ok: false };
    }

    const hashes = recoveryHashes(user);
    const index = await verifyRecoveryCode(code, hashes);
    if (index < 0) return { ok: false };
    const remaining = hashes.filter((_, i) => i !== index);
    // Compare-and-set on the stored list, so one recovery code can't sign in twice.
    const claimed = await User.updateWhere(
        { id: user.id, two_factor_recovery_codes: user.two_factor_recovery_codes },
        { two_factor_recovery_codes: JSON.stringify(remaining) },
    );
    return claimed === 1 ? { ok: true, method: "recovery", recoveryLeft: remaining.length } : { ok: false };
}

export async function newRecoveryCodes(user: UserAttributes): Promise<string[]> {
    const { codes, hashes } = await generateRecoveryCodes();
    await User.update(user.id, { two_factor_recovery_codes: JSON.stringify(hashes) });
    return codes;
}

export async function disable(user: UserAttributes): Promise<void> {
    await User.update(user.id, {
        two_factor_secret: null,
        two_factor_confirmed_at: null,
        two_factor_last_step: null,
        two_factor_recovery_codes: null,
    });
}
