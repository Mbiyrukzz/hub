/**
 * Admin routes (signed in AND listed in HUB_ADMINS).
 *
 * GET/POST          /api/admin/products
 * GET/PUT/DELETE    /api/admin/products/:id
 * GET/POST          /api/admin/changelog          (?product_id= to filter)
 * GET/PUT/DELETE    /api/admin/changelog/:id
 *
 * "auth" only proves who the caller is. Each controller method then calls
 * requireHubAdmin, which decides whether that person may manage the Hub.
 */

import type { Router } from "@tylix/core";
import { ProductController } from "../controllers/ProductController.js";
import { ChangelogController } from "../controllers/ChangelogController.js";

type Handler = Parameters<Router["get"]>[1];

export async function routes(router: Router, { auth }: { auth: (handler: Handler) => Handler }) {
    const products = new ProductController();
    const changelog = new ChangelogController();

    router.get("/api/admin/products", auth((req, res) => products.index(req, res)));
    router.post("/api/admin/products", auth((req, res) => products.store(req, res)));
    router.get("/api/admin/products/:id", auth((req, res) => products.show(req, res)));
    router.put("/api/admin/products/:id", auth((req, res) => products.update(req, res)));
    router.delete("/api/admin/products/:id", auth((req, res) => products.destroy(req, res)));

    router.get("/api/admin/changelog", auth((req, res) => changelog.index(req, res)));
    router.post("/api/admin/changelog", auth((req, res) => changelog.store(req, res)));
    router.get("/api/admin/changelog/:id", auth((req, res) => changelog.show(req, res)));
    router.put("/api/admin/changelog/:id", auth((req, res) => changelog.update(req, res)));
    router.delete("/api/admin/changelog/:id", auth((req, res) => changelog.destroy(req, res)));
}