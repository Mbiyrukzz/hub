// app/models/UptimeDay.ts
import { Model } from "@tylix/orm";

export interface UptimeDayAttributes {
    id: number;
    slot: string; // "<product_id>:<YYYY-MM-DD>", one row per product per UTC day
    product_id: number;
    day: string;
    down_seconds: number;
    started_at: string; // epoch milliseconds when accounting for this row began
    created_at: string;
    updated_at: string;
    [key: string]: unknown;
}

export class UptimeDay extends Model {
    static table = "uptime_days";
    static fillable: string[] = ["slot", "product_id", "day", "down_seconds", "started_at"];
}