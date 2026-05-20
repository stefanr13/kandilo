import { describe, expect, it } from 'vitest';
import {
  canAccessManagementTools,
  canDeleteNewsletters,
  canInviteChurchRole,
  canManageMemberRoles,
  canManageMemberStatus,
  isAdminOrPriestRole,
  isPriestRole,
} from './roles';

describe('role permissions', () => {
  it('identifies priest and admin management access', () => {
    expect(isPriestRole('priest')).toBe(true);
    expect(isPriestRole('admin')).toBe(false);
    expect(isAdminOrPriestRole('priest')).toBe(true);
    expect(isAdminOrPriestRole('admin')).toBe(true);
    expect(isAdminOrPriestRole('member')).toBe(false);
    expect(canAccessManagementTools(null)).toBe(false);
  });

  it('keeps member role and status permissions distinct', () => {
    expect(canManageMemberRoles('priest')).toBe(true);
    expect(canManageMemberRoles('admin')).toBe(false);
    expect(canManageMemberStatus('priest')).toBe(true);
    expect(canManageMemberStatus('admin')).toBe(true);
    expect(canManageMemberStatus('member')).toBe(false);
  });

  it('limits priest-only operations', () => {
    expect(canDeleteNewsletters('priest')).toBe(true);
    expect(canDeleteNewsletters('admin')).toBe(false);
    expect(canInviteChurchRole('priest', 'admin')).toBe(true);
    expect(canInviteChurchRole('admin', 'admin')).toBe(false);
    expect(canInviteChurchRole('admin', 'member')).toBe(true);
    expect(canInviteChurchRole('member', 'member')).toBe(false);
  });
});
