import type { Router } from '@tylix/core'
import { PostController } from '../controllers/PostController.js'
import { UploadController } from '../controllers/UploadController.js'

// Public routes: no login needed.
export async function publicRoutes(router: Router) {
  const posts = new PostController()

  router.get('/api/public/posts', (req, res) => posts.publicIndex(req, res))
  router.get('/api/public/posts/:id', (req, res) => posts.publicShow(req, res))
}

// Protected routes: every route here requires a logged-in user.
export async function protectedRoutes(router: Router) {
  const uploads = new UploadController()

  router.post('/api/uploads', (req, res) => uploads.store(req, res))
}
