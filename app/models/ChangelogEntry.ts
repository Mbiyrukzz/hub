import { Model } from "@tylix/orm";

export interface ChangelogEntryAttributes {
    id: number;
    product_id: number;
    version: string;
    title: string;
    body: string;
    category: string;
    status: string;
    published_at: string;
    created_by: number;
    created_at: string;
    updated_at: string;
    [key: string]: unknown;
}

export class ChangelogEntry extends Model {
    static table = "changelog_entries";
    static fillable: string[] = [
        "product_id",
        "version",
        "title",
        "body",
        "category",
        "status",
        "published_at",
        "created_by",
    ];
}