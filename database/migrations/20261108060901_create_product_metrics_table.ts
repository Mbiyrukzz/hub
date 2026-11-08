import type { Schema, CreateTableBuilder } from "@tylix/shared";

export const up = async (schema: Schema) => {
    await schema.createTable("product_metrics", (table: CreateTableBuilder) => {
        table.increments("id");
        table.string("slot");
        table.integer("product_id");
        table.string("day");
        table.integer("users_total");
        table.integer("users_active");
        table.integer("active_days");
        table.string("reported_at");
        table.timestamps();
    });
};

export const down = async (schema: Schema) => {
    await schema.dropTable("product_metrics");
};