/**
 * Service: ProductWatch
 *
 * Once a minute, compares every product's last heartbeat with the online
 * window. When that changes it records an event and emails HUB_ADMINS:
 *   product.down       no heartbeat inside the window
 *   product.recovered  heartbeats are back
 *
 * Only products that have reported at least once are watched. A product
 * with no key, or one that has never sent a heartbeat, is not "down".
 *
 * The last known state is kept in memory and rebuilt from the latest
 * events when the Hub starts, so a restart doesn't repeat old events.
 * That also means this assumes a single Hub process.
 */

import { Product, type ProductAttributes } from "../models/Product.js";
import { ProductApiKey, type ProductApiKeyAttributes } from "../models/ProductApiKey.js";
import { StatusEvent, type StatusEventAttributes } from "../models/StatusEvent.js";
import { sendProductAlert } from "../mail/alerts.js";

// Keep equal to the window in StatusController and PublicController.
const ONLINE_WINDOW_MS = 3 * 60 * 1000;
const TICK_MS = 60 * 1000;
const WATCH_TYPES = ["product.down", "product.recovered"];

const known = new Map<number, "up" | "down">();
let startedAt = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** The newest down/recovered event per product tells us where each one stood. */
async function seed(): Promise<void> {
    const events = (await StatusEvent.query().orderBy("occurred_at", "DESC").get()) as StatusEventAttributes[];
    for (const e of events) {
        if (!WATCH_TYPES.includes(e.type) || known.has(e.product_id)) continue;
        known.set(e.product_id, e.type === "product.down" ? "down" : "up");
    }
}

async function record(productId: number, type: string, message: string): Promise<void> {
    await StatusEvent.create({
        product_id: productId,
        type,
        message,
        meta: JSON.stringify({ source: "hub-watch" }),
        occurred_at: new Date().toISOString(),
    });
}

/** Fire and forget: a mail problem must never stop the watcher. */
function alert(kind: "down" | "recovered", productName: string, minutes: number): void {
    void sendProductAlert(kind, productName, minutes).catch((err: unknown) => {
        console.error("ProductWatch alert email failed:", err);
    });
}

async function tick(): Promise<void> {
    if (running) return;
    running = true;

    try {
        const products = (await Product.query().get()) as ProductAttributes[];
        const keys = (await ProductApiKey.query().get()) as ProductApiKeyAttributes[];

        const keyByProduct = new Map<number, ProductApiKeyAttributes>();
        for (const k of keys) keyByProduct.set(k.product_id, k);

        const now = Date.now();
        // After a Hub restart nothing could report in while we were down,
        // so don't call anything down until one full window has passed.
        const settled = now - startedAt >= ONLINE_WINDOW_MS;
        const minutes = Math.round(ONLINE_WINDOW_MS / 60000);

        for (const p of products) {
            const key = keyByProduct.get(p.id);
            if (!key || !key.last_seen_at) continue;

            const age = now - new Date(key.last_seen_at).getTime();
            if (Number.isNaN(age)) continue;

            const online = age <= ONLINE_WINDOW_MS;
            const before = known.get(p.id);

            if (!online && before !== "down" && settled) {
                await record(p.id, "product.down", `No heartbeat for ${minutes} minutes`);
                known.set(p.id, "down");
                alert("down", p.name, minutes);
            } else if (online && before === "down") {
                await record(p.id, "product.recovered", "Heartbeat is back");
                known.set(p.id, "up");
                alert("recovered", p.name, minutes);
            } else if (online && !before) {
                known.set(p.id, "up");
            }
        }
    } catch (err) {
        console.error("ProductWatch tick failed:", err);
    } finally {
        running = false;
    }
}

export async function startProductWatch(): Promise<void> {
    if (timer) return;

    startedAt = Date.now();
    try {
        await seed();
    } catch (err) {
        console.error("ProductWatch could not read past events:", err);
    }

    timer = setInterval(() => void tick(), TICK_MS);
}