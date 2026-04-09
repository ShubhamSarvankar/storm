import type { Permission, Role } from './types.js';

// Single source of truth for all role permissions.
// Never do inline role checks — always call hasPermission().
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    'message:send',
    'message:read',
    'message:delete:own',
    'message:delete:any',
    'channel:create',
    'channel:read',
    'channel:update:own',
    'channel:archive',
    'channel:delete',
    'channel:manage:members',
    'user:read',
    'user:update:own',
    'user:update:any',
    'user:deactivate',
  ],
  moderator: [
    'message:send',
    'message:read',
    'message:delete:own',
    'message:delete:any',
    'channel:create',
    'channel:read',
    'channel:update:own',
    'channel:archive',
    'channel:manage:members',
    'user:read',
    'user:update:own',
  ],
  member: [
    'message:send',
    'message:read',
    'message:delete:own',
    'channel:create',
    'channel:read',
    'channel:update:own',
    'channel:manage:members',
    'user:read',
    'user:update:own',
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}