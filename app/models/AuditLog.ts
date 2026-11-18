import { Model } from "@tylix/orm";

export interface AuditLogAttributes {
    id: number;
    action: string;
    category: string;
    actor_id: number | null;
    actor_email: string | null;
    target_type: string | null;
    target_id: string | null;
    summary: string;
    meta: string | null;
    ip: string | null;
    user_agent: string | null;
    created_at: string;
    updated_at: string;
    [key: string]: unknown;
}

// Written only through app/services/Audit (audit()), never from a request body.
export class AuditLog extends Model {
    static table = "audit_logs";
    static fillable: string[] = [
        "action",
        "category",
        "actor_id",
        "actor_email",
        "target_type",
        "target_id",
        "summary",
        "meta",
        "ip",
        "user_agent",
    ];
}
