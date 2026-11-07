/**
 * Hand-written validator for announcements.
 *
 * Kinds:
 *   info         a notice, such as a new feature
 *   maintenance  planned work; needs a start and an end once published
 *   incident     something is wrong now; resolve it by setting an end time
 *
 * States:
 *   draft      never public
 *   published  public from starts_at until ends_at (no end = until ended by hand)
 *
 * product_id 0 means the announcement applies to every product.
 */

export const KINDS = ["info", "maintenance", "incident"] as const;
export const STATUSES = ["draft", "published"] as const;

const MAX_BODY_BYTES = 20_000;

export interface NormalizedAnnouncement {
    product_id: number;
    kind: string;
    title: string;
    body: string;
    status: string;
    starts_at: string; // ISO string, "" when not set, "invalid" when unreadable
    ends_at: string; // same
}

function isoOrFlag(value: string): string {
    if (!value) return "";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "invalid" : parsed.toISOString();
}

export function normalizeAnnouncement(data: Record<string, unknown>): NormalizedAnnouncement {
    const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

    return {
        product_id: Number(data.product_id ?? 0),
        kind: str(data.kind).toLowerCase(),
        title: str(data.title),
        body: typeof data.body === "string" ? data.body.replace(/\r\n/g, "\n").trim() : "",
        status: str(data.status).toLowerCase() || "draft",
        starts_at: isoOrFlag(str(data.starts_at)),
        ends_at: isoOrFlag(str(data.ends_at)),
    };
}

export function validateAnnouncement(data: Record<string, unknown>) {
    const errors: Record<string, string[]> = {};
    const fail = (field: string, message: string) => {
        if (!errors[field]) errors[field] = [];
        errors[field].push(message);
    };

    const input = normalizeAnnouncement(data ?? {});

    if (!Number.isInteger(input.product_id) || input.product_id < 0) {
        fail("product_id", "Choose a product, or all products.");
    }

    if (!(KINDS as readonly string[]).includes(input.kind)) {
        fail("kind", `Kind must be one of: ${KINDS.join(", ")}.`);
    }

    if (!input.title) fail("title", "Title is required.");
    else if (input.title.length > 150) fail("title", "Title must be 150 characters or fewer.");

    if (!input.body) fail("body", "Write what is happening.");
    else if (Buffer.byteLength(input.body) > MAX_BODY_BYTES) fail("body", "Body is too long.");

    if (!(STATUSES as readonly string[]).includes(input.status)) {
        fail("status", `Status must be one of: ${STATUSES.join(", ")}.`);
    }

    if (input.starts_at === "invalid") fail("starts_at", "Enter a valid start date and time.");
    if (input.ends_at === "invalid") fail("ends_at", "Enter a valid end date and time.");

    if (input.starts_at && input.starts_at !== "invalid" && input.ends_at && input.ends_at !== "invalid") {
        if (new Date(input.ends_at).getTime() <= new Date(input.starts_at).getTime()) {
            fail("ends_at", "The end must be after the start.");
        }
    }

    if (input.status === "published" && input.kind === "maintenance") {
        if (!input.starts_at) fail("starts_at", "Planned maintenance needs a start time.");
        if (!input.ends_at) fail("ends_at", "Planned maintenance needs an end time.");
    }

    return { valid: Object.keys(errors).length === 0, errors };
}