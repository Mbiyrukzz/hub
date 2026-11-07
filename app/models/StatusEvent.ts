// app/models/StatusEvent.ts
import { Model } from "@tylix/orm";

export interface StatusEventAttributes {
    id: number;
    product_id: number;
    type: string;
    message: string;
    meta: string;
    occurred_at: string;
    created_at: string;
    updated_at: string;
    [key: string]: unknown;
}

export class StatusEvent extends Model {
    static table = "status_events";
    static fillable: string[] = ["product_id", "type", "message", "meta", "occurred_at"];
}