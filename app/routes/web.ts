import type { Router } from '@tylix/core'
import { UploadController } from '../controllers/UploadController.js'

// Public routes: no login needed.
export async function publicRoutes(router: Router) {



}

// Protected routes: every route here requires a logged-in user.
export async function protectedRoutes(router: Router) {
  const uploads = new UploadController()

  router.post('/api/uploads', (req, res) => uploads.store(req, res))
}
