// app/models/ProductMetric.ts
import { Model } from "@tylix/orm";

export interface ProductMetricAttributes {
    id: number;
    slot: string; // "<product_id>:<YYYY-MM-DD>", one row per product per UTC day
    product_id: number;
    day: string;
    users_total: number;
    users_active: number;
    active_days: number; // what "active" means: seen in the last N days
    reported_at: string; // ISO, UTC
    created_at: string;
    updated_at: string;
    [key: string]: unknown;
}

export class ProductMetric extends Model {
    static table = "product_metrics";
    static fillable: string[] = ["slot", "product_id", "day", "users_total", "users_active", "active_days", "reported_at"];
}