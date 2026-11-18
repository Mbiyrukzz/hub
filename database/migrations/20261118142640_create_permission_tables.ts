import type { Schema } from '@tylix/shared'
import { createPermissionTables, dropPermissionTables } from '@tylix/permissions/schema'

// permissions, roles, role_has_permissions, role_inherits, model_has_roles
// and model_has_permissions. See @tylix/permissions for what each holds.
export const up = async (schema: Schema) => {
  await createPermissionTables(schema)
}

export const down = async (schema: Schema) => {
  await dropPermissionTables(schema)
}
