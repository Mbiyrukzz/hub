import type { Schema, AlterTableBuilder } from "@tylix/shared";

// Two-factor sign-in (TOTP authenticator apps), see app/controllers/TwoFactorController.
//   two_factor_secret          the TOTP key, sealed with AUTH_SECRET (never stored in clear)
//   two_factor_confirmed_at    set once the user proved the app works; 2FA is on only then
//   two_factor_last_step       the last accepted 30s step, so a code can't be replayed
//   two_factor_recovery_codes  JSON array of hashed one-time recovery codes
export const up = async (schema: Schema) => {
    await schema.alterTable("users", (table: AlterTableBuilder) => {
        table.text("two_factor_secret");
        table.datetime("two_factor_confirmed_at");
        table.bigInteger("two_factor_last_step");
        table.text("two_factor_recovery_codes");
    });
};

export const down = async (schema: Schema) => {
    await schema.alterTable("users", (table: AlterTableBuilder) => {
        table.dropColumn("two_factor_secret", "two_factor_confirmed_at", "two_factor_last_step", "two_factor_recovery_codes");
    });
};
