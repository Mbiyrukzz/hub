/**
 * Public API, version 1. Read-only, no login.
 *
 * GET /api/v1/products
 * GET /api/v1/products/:slug/changelog
 */

import type { Router } from "@tylix/core";
import { PublicController } from "../controllers/PublicController.js";
import { IngestController } from "../controllers/IngestController.js";


export async function routes(router: Router) {
    const pub = new PublicController();

// inside routes():
const ingest = new IngestController();
router.post("/api/v1/ingest/heartbeat", (req, res) => ingest.heartbeat(req, res));
router.post("/api/v1/ingest/events", (req, res) => ingest.event(req, res));

    router.get("/api/v1/products", (req, res) => pub.products(req, res));
    router.get("/api/v1/products/:slug/changelog", (req, res) => pub.changelog(req, res));
        router.get("/api/v1/products/:slug/status", (req, res) => pub.status(req, res));
}