import type { Router } from '@tylix/core'
import { permissions } from '../permissions.js'
import { AccessController } from '../controllers/AccessController.js'

// The admin API for roles and permissions, used by /admin/access.
// Registered from protectedRoutes() in web.ts, so it needs a session;
// every route also needs the roles.manage permission.
export function accessRoutes(router: Router) {
  const access = new AccessController()
  const manage = permissions.middleware('roles.manage')

  router.get('/api/admin/access', manage, (req, res) => access.index(req, res))
  router.post('/api/admin/roles', manage, (req, res) => access.createRole(req, res))
  router.put('/api/admin/roles/:name', manage, (req, res) => access.updateRole(req, res))
  router.delete('/api/admin/roles/:name', manage, (req, res) => access.deleteRole(req, res))
  router.post('/api/admin/permissions', manage, (req, res) => access.createPermission(req, res))
  router.delete('/api/admin/permissions/:name', manage, (req, res) => access.deletePermission(req, res))
  router.put('/api/admin/users/:id/roles', manage, (req, res) => access.syncUserRoles(req, res))
}
