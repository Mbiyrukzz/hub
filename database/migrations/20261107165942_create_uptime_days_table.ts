import type { Schema, CreateTableBuilder } from "@tylix/shared";

export const up = async (schema: Schema) => {
    await schema.createTable("uptime_days", (table: CreateTableBuilder) => {
        table.increments("id");
        table.string("slot");
        table.integer("product_id");
        table.string("day");
        table.integer("down_seconds");
        table.string("started_at");
        table.timestamps();
    });
};

export const down = async (schema: Schema) => {
    await schema.dropTable("uptime_days");
};