export type ChurchRole = 'member' | 'admin' | 'priest';

export type ChurchMembershipRecord = {
  role?: ChurchRole | string;
  status?: string;
  displayName?: string;
};
