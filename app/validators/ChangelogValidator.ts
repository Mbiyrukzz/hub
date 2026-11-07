/**
 * Hand-written validator for changelog entries.
 *
 * States:
 *   draft      never public
 *   scheduled  needs a future published_at; goes live by itself when it passes
 *   published  public now; published_at is filled in if left empty
 *
 * The product can't be changed after creation (versions are unique per product).
 */

export const CATEGORIES = ["added", "improved", "fixed", "security", "breaking"] as const;
export const STATUSES = ["draft", "scheduled", "published"] as const;

const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,49}$/;
const MAX_BODY_BYTES = 50_000;

export interface NormalizedEntry {
    product_id: number;
    version: string;
    title: string;
    body: string;
    category: string;
    status: string;
    published_at: string; // ISO string, or "" when not set
}

export function normalizeEntry(data: Record<string, unknown>): NormalizedEntry {
    const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

    const rawDate = str(data.published_at);
    const parsed = rawDate ? new Date(rawDate) : null;
    const published_at = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : rawDate ? "invalid" : "";

    return {
        product_id: Number(data.product_id),
        version: str(data.version),
        title: str(data.title),
        body: typeof data.body === "string" ? data.body.replace(/\r\n/g, "\n").trim() : "",
        category: str(data.category).toLowerCase(),
        status: str(data.status).toLowerCase() || "draft",
        published_at,
    };
}

export function validateEntry(
    data: Record<string, unknown>,
    options: { isUpdate?: boolean } = {},
) {
    const errors: Record<string, string[]> = {};
    const fail = (field: string, message: string) => {
        if (!errors[field]) errors[field] = [];
        errors[field].push(message);
    };

    const input = normalizeEntry(data ?? {});

    if (!options.isUpdate && (!Number.isInteger(input.product_id) || input.product_id < 1)) {
        fail("product_id", "Choose a product.");
    }

    if (!input.version) fail("version", "Version is required.");
    else if (!VERSION.test(input.version)) fail("version", "Use a version like 0.6.0 or 2026.11.1.");

    if (!input.title) fail("title", "Title is required.");
    else if (input.title.length > 150) fail("title", "Title must be 150 characters or fewer.");

    if (!input.body) fail("body", "Write what changed.");
    else if (Buffer.byteLength(input.body) > MAX_BODY_BYTES) fail("body", "Body is too long.");

    if (!(CATEGORIES as readonly string[]).includes(input.category)) {
        fail("category", `Category must be one of: ${CATEGORIES.join(", ")}.`);
    }

    if (!(STATUSES as readonly string[]).includes(input.status)) {
        fail("status", `Status must be one of: ${STATUSES.join(", ")}.`);
    }

    if (input.published_at === "invalid") {
        fail("published_at", "Enter a valid date and time.");
    } else if (input.status === "scheduled") {
        if (!input.published_at) fail("published_at", "Pick when this should go live.");
        else if (new Date(input.published_at).getTime() <= Date.now()) {
            fail("published_at", "A scheduled entry needs a time in the future.");
        }
    } else if (input.status === "published" && input.published_at) {
        if (new Date(input.published_at).getTime() > Date.now() + 60_000) {
            fail("published_at", "That time is in the future. Use Scheduled instead.");
        }
    }

    return { valid: Object.keys(errors).length === 0, errors };
}