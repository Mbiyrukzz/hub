// Who may do what in the Hub.
// Started by tylix make:permissions; the roles below are the Hub's own.
//
// Server:   await permissions.can(req.user, "changelog.manage")
// Pages:    can("products.manage"), hasRole("admin") (from user.access)
// Terminal: tylix permission:assign editor ada@example.com
//           tylix permission:show
//
// Signing in proves who someone is; a role decides what they can open.
// A signed-in account with no role sees nothing in the console.
import { Model } from "@tylix/orm";
import { createPermissions, ormStore } from "@tylix/permissions";

export const permissions = createPermissions({
    store: ormStore({ Model }),

    // Passes every check, denies included. Keep it for the owner.
    superAdmin: "super-admin",

    // The Hub is internal: an account gets nothing until it's given a role.
    defaultRoles: [],
});

// PermissionSeeder syncs this (tylix db:seed or tylix permission:sync). It
// only adds and updates, so roles made in /admin/access are kept.
export const definition = {
    permissions: [
        { name: "products.view", description: "See products and their health" },
        { name: "products.manage", description: "Add, edit and remove products" },
        { name: "products.keys", description: "Issue a product's reporting key (the old one stops working)" },
        { name: "changelog.view", description: "See every release note, drafts included" },
        { name: "changelog.manage", description: "Write, edit and delete release notes" },
        { name: "announcements.view", description: "See announcements and maintenance windows" },
        { name: "announcements.manage", description: "Post, edit and resolve announcements" },
        { name: "status.view", description: "See status, uptime and metrics" },
        { name: "alerts.receive", description: "Get an email when a product goes down or comes back" },
        { name: "users.view", description: "See the list of accounts" },
        { name: "roles.manage", description: "Create roles and give them to people" },
        { name: "audit.view", description: "Read the audit log of sign-ins and admin changes" },
        { name: "account.two-factor", description: "Turn on two-factor sign-in for their own account" },
    ],
    roles: {
        "super-admin": { description: "Passes every check", permissions: [] },
        admin: {
            description: "Runs the Hub: products, keys and who has access",
            inherits: ["editor"],
            permissions: ["products.*", "users.*", "roles.manage", "alerts.receive", "audit.view", "account.two-factor"],
        },
        editor: {
            description: "Writes release notes and announcements",
            inherits: ["viewer"],
            permissions: ["changelog.*", "announcements.*"],
        },
        viewer: {
            description: "Reads everything in the console, changes nothing",
            permissions: ["products.view", "changelog.view", "announcements.view", "status.view"],
        },
        "on-call": {
            description: "Gets downtime alerts and can post incident announcements",
            inherits: ["viewer"],
            permissions: ["alerts.receive", "announcements.manage"],
        },
    },
};
