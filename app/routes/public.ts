/**
 * Public API, version 1. No login.
 *
 * Read-only, for sites that show Hub data:
 *   GET  /api/v1/products
 *   GET  /api/v1/products/:slug/changelog
 *   GET  /api/v1/products/:slug/status
 *   GET  /api/v1/products/:slug/announcements
 *   GET  /api/v1/products/:slug/uptime
 *
 * Authenticated by a product's API key (see IngestController):
 *   POST /api/v1/ingest/heartbeat
 *   POST /api/v1/ingest/events
 */

import type { Router } from "@tylix/core";
import { PublicController } from "../controllers/PublicController.js";
import { IngestController } from "../controllers/IngestController.js";
import { startProductWatch } from "../services/ProductWatch.js";

let watchStarted = false;

export async function routes(router: Router) {
    const pub = new PublicController();
    const ingest = new IngestController();

    router.post("/api/v1/ingest/heartbeat", (req, res) => ingest.heartbeat(req, res));
    router.post("/api/v1/ingest/events", (req, res) => ingest.event(req, res));

    router.get("/api/v1/products", (req, res) => pub.products(req, res));
    router.get("/api/v1/products/:slug/changelog", (req, res) => pub.changelog(req, res));
    router.get("/api/v1/products/:slug/status", (req, res) => pub.status(req, res));
    router.get("/api/v1/products/:slug/announcements", (req, res) => pub.announcements(req, res));
    router.get("/api/v1/products/:slug/uptime", (req, res) => pub.uptime(req, res));

    // routes() runs once when the web server boots. Guard against a double start.
    if (!watchStarted) {
        watchStarted = true;
        void startProductWatch();
    }
}