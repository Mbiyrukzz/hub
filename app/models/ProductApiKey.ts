// app/models/ProductApiKey.ts
import { Model } from "@tylix/orm";

export interface ProductApiKeyAttributes {
    id: number;
    product_id: number;
    key_hash: string;
    last_seen_at: string;
    last_version: string;
    created_at: string;
    updated_at: string;
    [key: string]: unknown;
}

export class ProductApiKey extends Model {
    static table = "product_api_keys";
    static fillable: string[] = ["product_id", "key_hash", "last_seen_at", "last_version"];
}