import { describe, expect, it } from 'vitest';
import {
  canAccessManagementTools,
  canDeleteNewsletters,
  canInviteChurchRole,
  canManageTaxReceipts,
  canManageMemberRoles,
  canManageMemberStatus,
  isAdminOrPriestRole,
  isPriestRole,
  isTreasurerRole,
} from './roles';

describe('role permissions', () => {
  it('identifies priest and admin management access', () => {
    expect(isPriestRole('priest')).toBe(true);
    expect(isPriestRole('admin')).toBe(false);
    expect(isTreasurerRole('treasurer')).toBe(true);
    expect(isTreasurerRole('admin')).toBe(false);
    expect(isAdminOrPriestRole('priest')).toBe(true);
    expect(isAdminOrPriestRole('admin')).toBe(true);
    expect(isAdminOrPriestRole('treasurer')).toBe(false);
    expect(isAdminOrPriestRole('member')).toBe(false);
    expect(canAccessManagementTools('treasurer')).toBe(true);
    expect(canAccessManagementTools(null)).toBe(false);
  });

  it('keeps member role and status permissions distinct', () => {
    expect(canManageMemberRoles('priest')).toBe(true);
    expect(canManageMemberRoles('treasurer')).toBe(false);
    expect(canManageMemberRoles('admin')).toBe(false);
    expect(canManageMemberStatus('priest')).toBe(true);
    expect(canManageMemberStatus('treasurer')).toBe(false);
    expect(canManageMemberStatus('admin')).toBe(true);
    expect(canManageMemberStatus('member')).toBe(false);
  });

  it('limits priest-only operations', () => {
    expect(canDeleteNewsletters('priest')).toBe(true);
    expect(canDeleteNewsletters('treasurer')).toBe(false);
    expect(canDeleteNewsletters('admin')).toBe(false);
    expect(canManageTaxReceipts('priest')).toBe(true);
    expect(canManageTaxReceipts('treasurer')).toBe(true);
    expect(canManageTaxReceipts('admin')).toBe(false);
    expect(canInviteChurchRole('priest', 'admin')).toBe(true);
    expect(canInviteChurchRole('priest', 'treasurer')).toBe(true);
    expect(canInviteChurchRole('admin', 'admin')).toBe(false);
    expect(canInviteChurchRole('admin', 'treasurer')).toBe(false);
    expect(canInviteChurchRole('admin', 'member')).toBe(true);
    expect(canInviteChurchRole('member', 'member')).toBe(false);
  });
});
