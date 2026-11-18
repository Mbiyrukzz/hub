// Syncs the Hub's roles and permissions from app/permissions.
// Safe to run again: it adds and updates, and never removes anything.
//
// HUB_ADMINS (comma-separated emails) is now only a bootstrap: each listed
// account that exists and has a verified email is given the admin role
// here. After that, manage access in /admin/access or with
// tylix permission:assign / permission:revoke.
import { permissions, definition } from "../permissions.js";
import { User } from "../models/User.js";
import { hubAdminEmails } from "../services/AdminGate.js";

export async function seed() {
    await permissions.sync(definition);

    for (const email of hubAdminEmails()) {
        const user = await User.findByEmail(email);
        if (!user) {
            console.log(`  HUB_ADMINS: no account for ${email} yet, skipped.`);
            continue;
        }
        if (!User.isEmailVerified(user)) {
            console.log(`  HUB_ADMINS: ${email} hasn't verified their email, skipped.`);
            continue;
        }
        if (!(await permissions.hasRole(user, "admin"))) {
            await permissions.for(user).assignRole("admin");
            console.log(`  HUB_ADMINS: ${email} is now an admin.`);
        }
    }
}
