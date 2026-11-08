import type { Schema, CreateTableBuilder } from "@tylix/shared";

export const up = async (schema: Schema) => {
    await schema.createTable("product_tenant_metrics", (table: CreateTableBuilder) => {
        table.increments("id");
        table.string("slot");
        table.integer("product_id");
        table.string("day");
        table.integer("tenants_total");
        table.integer("tenants_active");
        table.string("label");
        table.string("reported_at");
        table.timestamps();
    });
};

export const down = async (schema: Schema) => {
    await schema.dropTable("product_tenant_metrics");
};