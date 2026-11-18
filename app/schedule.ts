import type { Scheduler } from '@tylix/core'
import { Log } from '@tylix/core'
import { pruneAuditLog } from './services/Audit.js'

// Runs with `tylix schedule:work`.
export async function schedule(scheduler: Scheduler) {
  // Audit entries older than AUDIT_RETENTION_DAYS (default 365) are removed.
  scheduler.daily('03:15', async () => {
    const removed = await pruneAuditLog()
    if (removed > 0) Log.info(`Removed ${removed} audit log entries past retention`)
  })
}
