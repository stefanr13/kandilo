export type ChurchRole = 'member' | 'admin' | 'treasurer' | 'priest';

export type ChurchMembershipRecord = {
  role?: ChurchRole | string;
  status?: string;
  displayName?: string;
};
