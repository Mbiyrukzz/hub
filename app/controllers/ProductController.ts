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
import { requireHub } from "../services/AdminGate.js";
import { audit, changedFields } from "../services/Audit.js";
import crypto from "node:crypto";
import { ProductApiKey, type ProductApiKeyAttributes } from "../models/ProductApiKey.js";

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
        if (!(await requireHub(req, res, "products.view"))) return;

        const rows = (await Product.query().orderBy("name", "ASC").get()) as ProductAttributes[];
        return res.json(rows.map(toApi));
    }

    async show(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHub(req, res, "products.view"))) return;

        const product = await findProduct(req, res);
        if (!product) return;

        return res.json(toApi(product));
    }

    async store(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHub(req, res, "products.manage"))) return;

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

        await audit(req, "product.created", { target: ["product", product.id], summary: `Added product ${product.name}` });
        res.status(201);
        return res.json(toApi(product));
    }

    async update(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHub(req, res, "products.manage"))) return;

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
        const changed = changedFields(product, { name, website_url, description, is_active }, ["name", "website_url", "description", "is_active"]);
        if (changed.length > 0) {
            await audit(req, "product.updated", { target: ["product", product.id], summary: `Updated product ${name ?? product.name}`, meta: { changed } });
        }

        const fresh = (await Product.find(product.id)) as ProductAttributes | null;
        if (!fresh) {
            res.status(500);
            return res.json({ error: "Could not reload the product after saving." });
        }

        return res.json(toApi(fresh));
    }

    async destroy(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHub(req, res, "products.manage"))) return;

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
        await audit(req, "product.deleted", { target: ["product", product.id], summary: `Removed product ${product.name}` });

        res.status(204);
        return res.end();
    }


  

// inside class ProductController:
    /** Creates or replaces the product's ingest key. The raw key is returned once, never stored. */
    async rotateKey(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHub(req, res, "products.keys"))) return;

        const product = await findProduct(req, res);
        if (!product) return;

        const raw = "hub_" + crypto.randomBytes(24).toString("hex");
        const hash = crypto.createHash("sha256").update(raw).digest("hex");

        const existing = (await ProductApiKey.query().where("product_id", product.id).first()) as ProductApiKeyAttributes | null;
        if (existing) {
            await ProductApiKey.update(existing.id, { key_hash: hash, last_seen_at: "", last_version: "" });
        } else {
            await ProductApiKey.create({ product_id: product.id, key_hash: hash, last_seen_at: "", last_version: "" });
        }

        await audit(req, "product.key_issued", {
            target: ["product", product.id],
            summary: `Issued a new reporting key for ${product.name}${existing ? " (the old one stopped working)" : ""}`,
        });
        return res.json({ key: raw });
    }
}