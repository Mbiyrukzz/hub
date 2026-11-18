import type { Router } from '@tylix/core'
import { UploadController } from '../controllers/UploadController.js'
import { TwoFactorController } from '../controllers/TwoFactorController.js'
import { authController } from '../controllers/AuthController.js'
import { accessRoutes } from './access.js'

// Public routes: no login needed.
export async function publicRoutes(router: Router) {
  // The second step of signing in, for accounts with two-factor on. It
  // reads the short-lived challenge cookie that /api/login (or the
  // Google/GitHub callback) set; see AuthController.twoFactorVerify.
  router.post('/api/auth/two-factor', (req, res) => authController().twoFactorVerify(req, res))
}

// Protected routes: every route here requires a logged-in user.
export async function protectedRoutes(router: Router) {
  // Roles and permissions admin API (app/routes/access)
  accessRoutes(router)

  // Two-factor settings for the signed-in account (app/pages/Account)
  const twoFactor = new TwoFactorController()
  router.get('/api/account/two-factor', (req, res) => twoFactor.status(req, res))
  router.post('/api/account/two-factor/setup', (req, res) => twoFactor.setup(req, res))
  router.post('/api/account/two-factor/confirm', (req, res) => twoFactor.confirm(req, res))
  router.post('/api/account/two-factor/recovery-codes', (req, res) => twoFactor.recoveryCodes(req, res))
  router.post('/api/account/two-factor/disable', (req, res) => twoFactor.disable(req, res))

  const uploads = new UploadController()

  router.post('/api/uploads', (req, res) => uploads.store(req, res))
}
