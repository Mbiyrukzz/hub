// app/models/ProductTenantMetric.ts
import { Model } from "@tylix/orm";

export interface ProductTenantMetricAttributes {
    id: number;
    slot: string; // "<product_id>:<YYYY-MM-DD>", one row per product per UTC day
    product_id: number;
    day: string;
    tenants_total: number;
    tenants_active: number;
    label: string; // what the product calls its tenants: "Companies", "Schools"...
    reported_at: string; // ISO, UTC
    created_at: string;
    updated_at: string;
    [key: string]: unknown;
}

export class ProductTenantMetric extends Model {
    static table = "product_tenant_metrics";
    static fillable: string[] = ["slot", "product_id", "day", "tenants_total", "tenants_active", "label", "reported_at"];
}