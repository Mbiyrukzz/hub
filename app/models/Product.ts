import { Model } from "@tylix/orm";

export interface ProductAttributes {
    id: number;
    name: string;
    slug: string;
    website_url: string;
    description: string;
    is_active: number;
    created_at: string;
    updated_at: string;
    [key: string]: unknown;
}

export class Product extends Model {
    static table = "products";
    static fillable: string[] = [
        "name",
        "slug",
        "website_url",
        "description",
        "is_active",
    ];
}