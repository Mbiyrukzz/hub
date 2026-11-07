import { Model } from "@tylix/orm";

export interface AnnouncementAttributes {
    id: number;
    product_id: number;
    kind: string;
    title: string;
    body: string;
    status: string;
    starts_at: string;
    ends_at: string;
    created_by: number;
    created_at: string;
    updated_at: string;
    [key: string]: unknown;
}

export class Announcement extends Model {
    static table = "announcements";
    static fillable: string[] = ["product_id", "kind", "title", "body", "status", "starts_at", "ends_at", "created_by"];
}