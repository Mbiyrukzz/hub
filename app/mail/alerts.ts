/**
 * Sends the "product is down" and "product is back" emails to everyone
 * listed in HUB_ADMINS.
 *
 * ProductWatch runs outside any request, so it can't be handed the mail
 * settings the way AuthController is. They are read from the same MAIL_*
 * variables in .env.
 */

import type { MailConfig } from "@tylix/mail";
import { ProductAlertMail } from "./ProductAlertMail.js";
import { hubAdminEmails } from "../services/AdminGate.js";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

function mailConfig(): MailConfig {
    const secure = String(process.env.MAIL_SECURE ?? "").toLowerCase();

    return {
        driver: process.env.MAIL_DRIVER === "smtp" ? "smtp" : "log",
        from: process.env.MAIL_FROM,
        host: process.env.MAIL_HOST,
        port: Number(process.env.MAIL_PORT) || undefined,
        secure: secure === "true" || secure === "1",
        user: process.env.MAIL_USER,
        password: process.env.MAIL_PASSWORD,
    };
}

function nairobiTime(date: Date): string {
    const text = date.toLocaleString("en-GB", {
        timeZone: "Africa/Nairobi",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
    return `${text} (EAT)`;
}

export async function sendProductAlert(kind: "down" | "recovered", productName: string, minutes: number): Promise<void> {
    const to = hubAdminEmails();
    if (to.length === 0) return;

    const down = kind === "down";

    await new ProductAlertMail({
        subject: down ? `[Hub] ${productName} is down` : `[Hub] ${productName} is back`,
        headline: down ? `${productName} is down` : `${productName} is back online`,
        product: productName,
        detail: down
            ? `has not sent a heartbeat for ${minutes} minutes.`
            : "is sending heartbeats again.",
        when: nairobiTime(new Date()),
        statusUrl: `${APP_URL.replace(/\/+$/, "")}/status`,
    }).send(to, mailConfig());
}