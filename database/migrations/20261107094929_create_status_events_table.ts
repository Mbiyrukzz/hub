import type { Schema, CreateTableBuilder } from "@tylix/shared";

export const up = async (schema: Schema) => {
await schema.createTable("status_events", (table: CreateTableBuilder) => {
        table.increments("id");
        table.integer("product_id");
        table.string("type");
        table.string("message");
        table.text("meta");
        table.string("occurred_at");
        table.timestamps();
});
};

export const down = async (schema: Schema) => {
await schema.dropTable("status_events");
};