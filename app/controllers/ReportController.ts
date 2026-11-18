/**
 * Controller: ReportController (admin)
 *
 * Downloads, for sharing outside the Hub:
 *
 *   GET /api/admin/changelog/export?format=pdf|xlsx[&product_id=]   changelog.view
 *   GET /api/admin/status/export?format=pdf|xlsx[&days=30]          status.view
 *   GET /api/admin/audit/export?format=xlsx[&category=]              audit.view
 *
 * PDFs are made with @tylix/pdf and workbooks with @tylix/excel, both on
 * the server, so the numbers match what the pages show. Every download is
 * recorded in the audit log.
 */

import type { TylixRequest, TylixResponse } from "@tylix/core";
import { createPdf } from "@tylix/pdf";
import type { Node as PdfNode } from "@tylix/pdf";
import { createWorkbook } from "@tylix/excel";
import { Product, type ProductAttributes } from "../models/Product.js";
import { ChangelogEntry, type ChangelogEntryAttributes } from "../models/ChangelogEntry.js";
import { ProductApiKey, type ProductApiKeyAttributes } from "../models/ProductApiKey.js";
import { StatusEvent, type StatusEventAttributes } from "../models/StatusEvent.js";
import { AuditLog, type AuditLogAttributes } from "../models/AuditLog.js";
import { requireHub } from "../services/AdminGate.js";
import { instantOf, isoOf } from "../services/ChangelogService.js";
import { ONLINE_WINDOW_MS, uptimeFor, type UptimeReport } from "../services/Uptime.js";
import { audit, toEntry } from "../services/Audit.js";

type Format = "pdf" | "xlsx";

const BRAND = "#4f46e5";
const STATE_LABEL: Record<string, string> = { live: "Published", scheduled: "Scheduled", draft: "Draft" };
const STATUS_LABEL: Record<string, string> = { online: "Online", offline: "Offline", waiting: "Waiting for first report", no_key: "Not connected" };

function formatOf(req: TylixRequest, res: TylixResponse, allowed: Format[]): Format | null {
    const format = String(req.query?.format ?? allowed[0]).toLowerCase() as Format;
    if (!allowed.includes(format)) {
        res.status(422).json({ error: `format must be ${allowed.join(" or ")}.` });
        return null;
    }
    return format;
}

function today(): string {
    return new Date().toISOString().slice(0, 10);
}

function dateOrNull(value: unknown): Date | null {
    const at = instantOf(value);
    return Number.isNaN(at) ? null : new Date(at);
}

function stamp(): string {
    return new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
}

// Excel refuses sheet names longer than 31 characters or with []:*?/\.
function sheetName(name: string, used: Set<string>): string {
    const base = name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 28) || "Sheet";
    let candidate = base;
    for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${base.slice(0, 26)} ${i}`;
    used.add(candidate.toLowerCase());
    return candidate;
}

// Release notes are Markdown; a PDF paragraph wants plain text.
function plainText(markdown: string): string {
    return String(markdown ?? "")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/!\[[^\]]*]\([^)]*\)/g, "")
        .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/(\*\*|__)(.*?)\1/g, "$2")
        .replace(/(\*|_)(.*?)\1/g, "$2")
        .replace(/^\s*[-*+]\s+/gm, "• ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function stateOf(entry: ChangelogEntryAttributes): string {
    if (entry.status === "draft") return "draft";
    const at = instantOf(entry.published_at);
    if (entry.status === "scheduled" && at > Date.now()) return "scheduled";
    return "live";
}

function onlineStateOf(key: ProductApiKeyAttributes | undefined): string {
    if (!key) return "no_key";
    if (!key.last_seen_at) return "waiting";
    const age = Date.now() - instantOf(key.last_seen_at);
    if (Number.isNaN(age)) return "waiting";
    return age <= ONLINE_WINDOW_MS ? "online" : "offline";
}

export class ReportController {
    // --- Changelog ------------------------------------------------------

    async changelog(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHub(req, res, "changelog.view"))) return;
        const format = formatOf(req, res, ["pdf", "xlsx"]);
        if (!format) return;

        const productId = Number(req.query?.product_id);
        const products = (await Product.query().orderBy("name", "ASC").get()) as ProductAttributes[];
        const only = Number.isInteger(productId) && productId > 0 ? products.find((p) => p.id === productId) : null;
        if (productId && !only) return res.status(404).json({ error: "Product not found." });

        const entries = (
            only
                ? await ChangelogEntry.query().where("product_id", only.id).orderBy("published_at", "DESC").get()
                : await ChangelogEntry.query().orderBy("published_at", "DESC").get()
        ) as ChangelogEntryAttributes[];

        const nameOf = new Map(products.map((p) => [p.id, p.name]));
        const rows = entries.map((e) => ({
            product: nameOf.get(e.product_id) ?? "Unknown product",
            version: e.version,
            title: e.title,
            category: e.category,
            state: STATE_LABEL[stateOf(e)],
            published: dateOrNull(e.published_at),
            body: e.body ?? "",
        }));

        const scope = only ? only.name : "All products";
        const filename = `changelog-${only ? only.slug : "all"}-${today()}.${format}`;
        await audit(req, "report.downloaded", { summary: `Downloaded the changelog (${scope}) as ${format.toUpperCase()}`, meta: { report: "changelog", format, product_id: only?.id } });

        if (format === "xlsx") {
            const workbook = createWorkbook({ title: `Changelog: ${scope}`, creator: "Ashmif Hub" });
            workbook.addSheet("Changelog", {
                columns: [
                    { header: "Product", key: "product" },
                    { header: "Version", key: "version" },
                    { header: "Title", key: "title" },
                    { header: "Category", key: "category" },
                    { header: "State", key: "state" },
                    { header: "Published", key: "published", format: "datetime" },
                    { header: "Notes (Markdown)", key: "body", width: 80 },
                ],
                rows,
                tabColor: BRAND,
            });
            return res.download(workbook, filename);
        }

        // PDF: release notes as a document, newest first, grouped by product.
        const content: PdfNode[] = [
            { h1: `Changelog: ${scope}` },
            { text: `${rows.length} ${rows.length === 1 ? "release" : "releases"} · exported ${stamp()}`, style: "muted" },
            { spacer: 8 },
        ];
        const groups = new Map<string, typeof rows>();
        for (const r of rows) groups.set(r.product, [...(groups.get(r.product) ?? []), r]);
        if (rows.length === 0) content.push({ text: "No release notes yet." });
        for (const [product, list] of groups) {
            if (!only) content.push({ h2: product, keepWithNext: true });
            for (const r of list) {
                content.push(
                    {
                        text: [
                            { text: `${r.version}  `, bold: true, color: BRAND },
                            { text: r.title, bold: true },
                        ],
                        size: 12,
                        margin: [0, 10, 0, 2],
                        keepWithNext: true,
                    },
                    {
                        text: `${r.category} · ${r.state}${r.published ? " · " + r.published.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}`,
                        style: "muted",
                        size: 9,
                        keepWithNext: true,
                    },
                    plainText(r.body) || { text: "No notes.", style: "muted" },
                );
            }
        }
        return res.download(createPdf({ title: `Changelog: ${scope}`, author: "Ashmif Hub", pageNumbers: true, content }), filename);
    }

    // --- Status and uptime ----------------------------------------------

    async status(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHub(req, res, "status.view"))) return;
        const format = formatOf(req, res, ["pdf", "xlsx"]);
        if (!format) return;
        const days = Math.min(Math.max(Number(req.query?.days) || 30, 1), 90);

        const products = (await Product.query().orderBy("name", "ASC").get()) as ProductAttributes[];
        const keys = (await ProductApiKey.query().get()) as ProductApiKeyAttributes[];
        const keyOf = new Map(keys.map((k) => [k.product_id, k]));
        const reports: (UptimeReport | null)[] = await Promise.all(
            products.map((p) => uptimeFor(p.id, keyOf.get(p.id)?.last_seen_at, days).catch(() => null)),
        );
        const events = ((await StatusEvent.query().orderBy("occurred_at", "DESC").limit(200).get()) as StatusEventAttributes[]);
        const nameOf = new Map(products.map((p) => [p.id, p.name]));

        const summary = products.map((p, i) => {
            const key = keyOf.get(p.id);
            const report = reports[i];
            return {
                product: p.name,
                status: STATUS_LABEL[onlineStateOf(key)],
                version: key?.last_version || "",
                last_seen: dateOrNull(key?.last_seen_at),
                uptime: report?.uptime_percent == null ? null : report.uptime_percent / 100,
                down_minutes: report ? report.days.reduce((sum, d) => sum + (d.down_minutes || 0), 0) : 0,
            };
        });

        const filename = `uptime-${days}d-${today()}.${format}`;
        await audit(req, "report.downloaded", { summary: `Downloaded the ${days}-day uptime report as ${format.toUpperCase()}`, meta: { report: "uptime", format, days } });

        if (format === "xlsx") {
            const workbook = createWorkbook({ title: `Uptime, last ${days} days`, creator: "Ashmif Hub" });
            const used = new Set<string>(["summary", "events"]);
            const sheet = workbook.addSheet("Summary", {
                columns: [
                    { header: "Product", key: "product" },
                    { header: "Status", key: "status" },
                    { header: "Version", key: "version" },
                    { header: "Last seen", key: "last_seen", format: "datetime" },
                    { header: `Uptime (${days}d)`, key: "uptime", format: "percent" },
                    { header: "Down (minutes)", key: "down_minutes", format: "integer", total: "sum" },
                ],
                rows: summary,
                tabColor: BRAND,
            });
            sheet.conditionalFormat(`E2:E${summary.length + 1}`, { type: "dataBar", color: "#818cf8" });

            products.forEach((p, i) => {
                const report = reports[i];
                if (!report) return;
                workbook.addSheet(sheetName(p.name, used), {
                    columns: [
                        { header: "Day (UTC)", key: "day", format: "date" },
                        { header: "Uptime", key: "uptime", format: "percent" },
                        { header: "Down (minutes)", key: "down", format: "integer", total: "sum" },
                    ],
                    rows: report.days.map((d) => ({
                        day: new Date(d.day + "T00:00:00Z"),
                        uptime: d.uptime_percent == null ? null : d.uptime_percent / 100,
                        down: d.down_minutes,
                    })),
                });
            });

            workbook.addSheet("Events", {
                columns: [
                    { header: "When", key: "when", format: "datetime" },
                    { header: "Product", key: "product" },
                    { header: "Type", key: "type" },
                    { header: "Message", key: "message", width: 60 },
                ],
                rows: events.map((e) => ({
                    when: dateOrNull(e.occurred_at),
                    product: nameOf.get(e.product_id) ?? "Unknown product",
                    type: e.type,
                    message: e.message,
                })),
            });
            return res.download(workbook, filename);
        }

        const pct = (v: number | null) => (v == null ? "No data" : `${(v * 100).toFixed(2)}%`);
        const content: PdfNode[] = [
            { h1: `Uptime report, last ${days} days` },
            { text: `${products.length} products · exported ${stamp()}`, style: "muted" },
            { spacer: 10 },
            {
                table: {
                    columns: [
                        { header: "Product", key: "product", width: "*" },
                        { header: "Status", value: (r: (typeof summary)[number]) => ({ text: r.status, color: r.status === "Online" ? "#047857" : r.status === "Offline" ? "#be123c" : "#64748b" }) },
                        { header: "Version", key: "version" },
                        { header: `Uptime`, value: (r: (typeof summary)[number]) => pct(r.uptime), align: "right" },
                        { header: "Down (min)", key: "down_minutes", format: "integer" },
                    ],
                    rows: summary,
                    zebra: true,
                    emptyText: "No products yet",
                },
            },
        ];
        // The worst days per product, so a reader sees where the downtime was.
        products.forEach((p, i) => {
            const bad = (reports[i]?.days ?? []).filter((d) => d.down_minutes > 0).sort((a, b) => b.down_minutes - a.down_minutes).slice(0, 10);
            if (bad.length === 0) return;
            content.push(
                { h3: `${p.name}: days with downtime`, margin: [0, 16, 0, 4], keepWithNext: true },
                {
                    table: {
                        columns: [
                            { header: "Day (UTC)", key: "day", width: "*" },
                            { header: "Uptime", value: (d: { uptime_percent: number | null }) => pct(d.uptime_percent == null ? null : d.uptime_percent / 100) },
                            { header: "Down (min)", key: "down_minutes", format: "integer" },
                        ],
                        rows: bad,
                        borders: "horizontal",
                    },
                },
            );
        });
        const recent = events.slice(0, 25);
        if (recent.length > 0) {
            content.push(
                { h2: "Latest events", margin: [0, 18, 0, 4], keepWithNext: true },
                {
                    table: {
                        columns: [
                            { header: "When (UTC)", value: (e: StatusEventAttributes) => isoOf(e.occurred_at).replace("T", " ").slice(0, 16) },
                            { header: "Product", value: (e: StatusEventAttributes) => nameOf.get(e.product_id) ?? "Unknown" },
                            { header: "Type", key: "type" },
                            { header: "Message", key: "message", width: "*" },
                        ],
                        rows: recent,
                        borders: "horizontal",
                    },
                },
            );
        }
        return res.download(createPdf({ title: `Uptime report, last ${days} days`, author: "Ashmif Hub", pageNumbers: true, content }), filename);
    }

    // --- Audit log --------------------------------------------------------

    async audit(req: TylixRequest, res: TylixResponse) {
        if (!(await requireHub(req, res, "audit.view"))) return;
        const format = formatOf(req, res, ["xlsx"]);
        if (!format) return;

        const category = String(req.query?.category ?? "");
        const query = AuditLog.query();
        const rows = ((category ? await query.where("category", category).orderBy("id", "DESC").limit(10000).get() : await query.orderBy("id", "DESC").limit(10000).get()) as AuditLogAttributes[]).map(toEntry);

        await audit(req, "report.downloaded", { summary: `Downloaded the audit log${category ? ` (${category})` : ""} as XLSX`, meta: { report: "audit", category: category || undefined } });

        const workbook = createWorkbook({ title: "Hub audit log", creator: "Ashmif Hub" });
        workbook.addSheet("Audit log", {
            columns: [
                { header: "When (UTC)", key: "when", format: "datetime" },
                { header: "Action", key: "action" },
                { header: "Who", key: "actor_email" },
                { header: "What happened", key: "summary", width: 60 },
                { header: "Target", key: "target" },
                { header: "IP", key: "ip" },
                { header: "Details", key: "meta", width: 40 },
            ],
            rows: rows.map((r) => ({
                ...r,
                when: new Date(r.created_at),
                target: r.target_type ? `${r.target_type} ${r.target_id ?? ""}`.trim() : "",
                meta: r.meta ? JSON.stringify(r.meta) : "",
            })),
            tabColor: BRAND,
        });
        return res.download(workbook, `audit-log-${today()}.xlsx`);
    }
}
