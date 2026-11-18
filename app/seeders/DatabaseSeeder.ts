import { seed as seedPermissions } from './PermissionSeeder.js'

export async function seed() {
  // Roles and permissions from app/permissions
  await seedPermissions()

  // e.g.:
  // await Post.create({ title: 'First post', body: '...' })
}
