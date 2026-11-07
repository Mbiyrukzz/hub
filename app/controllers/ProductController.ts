/**
 * Controller: ProductController (admin)
 *
 * The product registry. Every route is admin-only (see AdminGate).
 * A product with changelog entries can't be deleted.
 */

import type { TylixRequest, TylixResponse } from "@tylix/core";
import { Product, type ProductAttributes } from "../models/Product.js";
import { ChangelogEntry } from "../models/ChangelogEntry.js";
import { validateProduct, normalizeProduct } from "../validators/ProductValidator.js";
import { requireHubAdmin } from "../services/AdminGate.js";

function toApi(row: ProductAttributes) {
    return { ...row, is_active: Boolean(row.is_active) };
}

async function findProduct(req: TylixRequest, res: TylixResponse): Promise<ProductAttributes | null> {
    const product = (await Product.find(req.params.id)) as ProductAttributes | null;
    if (!product) {
        res.status(404);
        res.json({ error: "Product not found." });
        return null;
    }
    return product;
}

async function slugTaken(slug: string, exceptId?: number): Promise<boolean> {
    const hit = (await Product.query().where("slug", slug).first()) as ProductAttributes | null;
    return Boolean(hit) && hit!.id !== exceptId;
}

export class ProductController {
    async index(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHubAdmin(req, res))) return;

        const rows = (await Product.query().orderBy("name", "ASC").get()) as ProductAttributes[];
        return res.json(rows.map(toApi));
    }

    async show(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHubAdmin(req, res))) return;

        const product = await findProduct(req, res);
        if (!product) return;

        return res.json(toApi(product));
    }

    async store(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHubAdmin(req, res))) return;

        const result = validateProduct(req.body);
        if (!result.valid) {
            res.status(422);
            return res.json({ errors: result.errors });
        }

        const input = normalizeProduct(req.body);

        if (await slugTaken(input.slug)) {
            res.status(409);
            return res.json({ errors: { slug: ["That slug is already used by another product."] } });
        }

        const product = (await Product.create({ ...input })) as ProductAttributes | null;
        if (!product) {
            res.status(500);
            return res.json({ error: "Could not save the product." });
        }

        res.status(201);
        return res.json(toApi(product));
    }

    async update(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHubAdmin(req, res))) return;

        const product = await findProduct(req, res);
        if (!product) return;

        const result = validateProduct(req.body, { isUpdate: true });
        if (!result.valid) {
            res.status(422);
            return res.json({ errors: result.errors });
        }

        // The slug is deliberately not part of the patch.
        const { name, website_url, description, is_active } = normalizeProduct(req.body);
        await Product.update(product.id, { name, website_url, description, is_active });

        const fresh = (await Product.find(product.id)) as ProductAttributes | null;
        if (!fresh) {
            res.status(500);
            return res.json({ error: "Could not reload the product after saving." });
        }

        return res.json(toApi(fresh));
    }

    async destroy(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHubAdmin(req, res))) return;

        const product = await findProduct(req, res);
        if (!product) return;

        const hasEntries = await ChangelogEntry.query().where("product_id", product.id).first();
        if (hasEntries) {
            res.status(409);
            return res.json({
                error: "This product still has changelog entries. Delete them first, or mark the product inactive instead.",
            });
        }

        await Product.delete(product.id);

        res.status(204);
        return res.end();
    }
}