/**
 * Public API, version 1. Read-only, no login.
 *
 * GET /api/v1/products
 * GET /api/v1/products/:slug/changelog
 */

import type { Router } from "@tylix/core";
import { PublicController } from "../controllers/PublicController.js";

export async function routes(router: Router) {
    const pub = new PublicController();

    router.get("/api/v1/products", (req, res) => pub.products(req, res));
    router.get("/api/v1/products/:slug/changelog", (req, res) => pub.changelog(req, res));
}