import type { Role } from './church';

export type NullableRole = Role | null | undefined;
export type InviteAssignableRole = Extract<Role, 'admin' | 'member'>;

export function isPriestRole(role: NullableRole): boolean {
  return role === 'priest';
}

export function isAdminOrPriestRole(role: NullableRole): boolean {
  return role === 'admin' || role === 'priest';
}

export function canAccessManagementTools(role: NullableRole): boolean {
  return isAdminOrPriestRole(role);
}

export function canManageMemberRoles(role: NullableRole): boolean {
  return isPriestRole(role);
}

export function canManageMemberStatus(role: NullableRole): boolean {
  return isAdminOrPriestRole(role);
}

export function canDeleteNewsletters(role: NullableRole): boolean {
  return isPriestRole(role);
}

export function canInviteChurchRole(
  actorRole: NullableRole,
  targetRole: InviteAssignableRole
): boolean {
  if (targetRole === 'admin') {
    return isPriestRole(actorRole);
  }

  return isAdminOrPriestRole(actorRole);
}
