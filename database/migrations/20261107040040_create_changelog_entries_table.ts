import type { Schema, CreateTableBuilder } from "@tylix/shared";

export const up = async (schema: Schema) => {
    await schema.createTable("changelog_entries", (table: CreateTableBuilder) => {
        table.increments("id");
        table.integer("product_id");
        table.string("version");
        table.string("title");
        table.text("body");
        table.string("category");
        table.string("status");
        table.string("published_at");
        table.integer("created_by");
        table.timestamps();
    });
};

export const down = async (schema: Schema) => {
    await schema.dropTable("changelog_entries");
};