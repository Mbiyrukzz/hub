import type { Schema, CreateTableBuilder } from "@tylix/shared";

// One row per sign-in event or admin change: see app/services/Audit.
export const up = async (schema: Schema) => {
    await schema.createTable("audit_logs", (table: CreateTableBuilder) => {
        table.increments("id");
        // "auth.login", "product.updated", ...; the part before the dot is the category.
        table.string("action", 64).index();
        table.string("category", 32).index();
        // Who did it. Null for failed sign-ins of unknown accounts and system events.
        table.integer("actor_id").index();
        table.string("actor_email");
        // What it was done to: "product" + "12", "role" + "editor", "user" + "3".
        table.string("target_type", 32);
        table.string("target_id", 191);
        // One readable line: "Updated product Tylix Deploy".
        table.string("summary", 500);
        // JSON details (changed fields, reason, method). Never secrets.
        table.text("meta");
        table.string("ip", 64);
        table.text("user_agent");
        table.timestamps();
    });
};

export const down = async (schema: Schema) => {
    await schema.dropTable("audit_logs");
};
