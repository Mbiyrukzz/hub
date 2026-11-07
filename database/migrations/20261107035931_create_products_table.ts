import type { Schema, CreateTableBuilder } from "@tylix/shared";

export const up = async (schema: Schema) => {
    await schema.createTable("products", (table: CreateTableBuilder) => {
        table.increments("id");
        table.string("name");
        table.string("slug");
        table.string("website_url");
        table.text("description");
        table.integer("is_active");
        table.timestamps();
    });
};

export const down = async (schema: Schema) => {
    await schema.dropTable("products");
};