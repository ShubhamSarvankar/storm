import { describe, it, expect } from 'vitest';
import { hasPermission, ROLE_PERMISSIONS } from './rbac.js';

describe('hasPermission', () => {
  describe('admin', () => {
    it('has all permissions', () => {
      expect(hasPermission('admin', 'message:delete:any')).toBe(true);
      expect(hasPermission('admin', 'user:deactivate')).toBe(true);
      expect(hasPermission('admin', 'channel:delete')).toBe(true);
      expect(hasPermission('admin', 'user:update:any')).toBe(true);
    });
  });

  describe('moderator', () => {
    it('can delete any message', () => {
      expect(hasPermission('moderator', 'message:delete:any')).toBe(true);
    });

    it('can archive channels', () => {
      expect(hasPermission('moderator', 'channel:archive')).toBe(true);
    });

    it('cannot delete channels', () => {
      expect(hasPermission('moderator', 'channel:delete')).toBe(false);
    });

    it('cannot deactivate users', () => {
      expect(hasPermission('moderator', 'user:deactivate')).toBe(false);
    });

    it('cannot update any user', () => {
      expect(hasPermission('moderator', 'user:update:any')).toBe(false);
    });
  });

  describe('member', () => {
    it('can send and read messages', () => {
      expect(hasPermission('member', 'message:send')).toBe(true);
      expect(hasPermission('member', 'message:read')).toBe(true);
    });

    it('can only delete own messages', () => {
      expect(hasPermission('member', 'message:delete:own')).toBe(true);
      expect(hasPermission('member', 'message:delete:any')).toBe(false);
    });

    it('cannot archive or delete channels', () => {
      expect(hasPermission('member', 'channel:archive')).toBe(false);
      expect(hasPermission('member', 'channel:delete')).toBe(false);
    });

    it('cannot update or deactivate other users', () => {
      expect(hasPermission('member', 'user:update:any')).toBe(false);
      expect(hasPermission('member', 'user:deactivate')).toBe(false);
    });
  });

  describe('ROLE_PERMISSIONS completeness', () => {
    it('every role has at least the base member permissions', () => {
      const basePermissions = ROLE_PERMISSIONS['member'];
      for (const role of ['admin', 'moderator'] as const) {
        for (const permission of basePermissions) {
          expect(
            hasPermission(role, permission),
            `${role} should have base permission: ${permission}`,
          ).toBe(true);
        }
      }
    });
  });
});