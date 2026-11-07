import type { Schema, CreateTableBuilder } from "@tylix/shared";

export const up = async (schema: Schema) => {
    await schema.createTable("announcements", (table: CreateTableBuilder) => {
        table.increments("id");
        table.integer("product_id");
        table.string("kind");
        table.string("title");
        table.text("body");
        table.string("status");
        table.string("starts_at");
        table.string("ends_at");
        table.integer("created_by");
        table.timestamps();
    });
};

export const down = async (schema: Schema) => {
    await schema.dropTable("announcements");
};