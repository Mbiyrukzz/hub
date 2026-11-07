/**
 * Hand-written validator for products.
 *
 * The slug is the product's public identity (it appears in the API URL that
 * every consumer site calls), so it is set once at creation and can't be
 * changed afterwards.
 */

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface NormalizedProduct {
    name: string;
    slug: string;
    website_url: string;
    description: string;
    is_active: number;
}

export function normalizeProduct(data: Record<string, unknown>): NormalizedProduct {
    const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
    const off = data.is_active === false || data.is_active === 0 || data.is_active === "0";

    return {
        name: str(data.name),
        slug: str(data.slug).toLowerCase(),
        website_url: str(data.website_url),
        description: str(data.description),
        is_active: off ? 0 : 1,
    };
}

function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

export function validateProduct(
    data: Record<string, unknown>,
    options: { isUpdate?: boolean } = {},
) {
    const errors: Record<string, string[]> = {};
    const fail = (field: string, message: string) => {
        if (!errors[field]) errors[field] = [];
        errors[field].push(message);
    };

    const input = normalizeProduct(data ?? {});

    if (!input.name) fail("name", "Name is required.");
    else if (input.name.length > 100) fail("name", "Name must be 100 characters or fewer.");

    if (!options.isUpdate) {
        if (!input.slug) fail("slug", "Slug is required.");
        else if (input.slug.length > 50) fail("slug", "Slug must be 50 characters or fewer.");
        else if (!SLUG.test(input.slug)) {
            fail("slug", "Use lowercase letters, numbers and single hyphens, like tylix-deploy.");
        }
    }

    if (input.website_url && !isHttpUrl(input.website_url)) {
        fail("website_url", "Enter a full address starting with http:// or https://.");
    }

    if (input.description.length > 2000) {
        fail("description", "Description must be 2000 characters or fewer.");
    }

    return { valid: Object.keys(errors).length === 0, errors };
}