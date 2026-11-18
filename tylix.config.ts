import { defineConfig } from "@tylix/shared";

export default defineConfig({
  // Installable app and offline support (@tylix/pwa). Tylix serves the
  // manifest and the service worker; icons and offline.html are in public/.
  // Pages are never cached (they can hold a signed-in user's data): offline
  // visitors get public/offline.html. See the @tylix/pwa README for caching
  // rules, shortcuts and screenshots.
  //
  // On-call people install it on their phones: the shortcuts open status
  // and incidents straight from the home-screen icon.
  pwa: {
    name: "Ashmif Hub",
    shortName: "Hub",
    description: "Release notes, status and incidents for every Ashmif product.",
    startUrl: "/dashboard",
    themeColor: "#09090b",
    backgroundColor: "#09090b",
    shortcuts: [
      { name: "Status", url: "/status" },
      { name: "Post an incident", url: "/announcements?new=1" },
      { name: "Changelog", url: "/changelog" },
    ],
  },
  auth: {
    // Lifetime of an access token, in seconds. Tylix 2 caps it at an hour:
    // the rotating refresh session (30 days) keeps people signed in, and
    // logout, "sign out everywhere" and password resets apply at once.
    tokenExpiresInSeconds: 15 * 60,
    // Refuse new passwords found in public breaches (Have I Been Pwned,
    // k-anonymity: only a hash prefix leaves the server).
    checkBreachedPasswords: true,
  },
  logging: {
    // LOG_CHANNEL / LOG_STACK pick the channels (default console + daily
    // files in storage/logs). Alerts and ingest get their own file so a
    // flapping product doesn't bury everything else.
    channels: {
      alerts: { driver: "daily", path: "storage/logs/alerts.log", level: "info" },
      ingest: { driver: "daily", path: "storage/logs/ingest.log", level: "warning" },
    },
  },
  queue: {
    // Defaults for every job (alert mails, welcome mails). A job can set its own.
    tries: 3,
    backoff: "exponential",
  },
  plugins: [],
});
