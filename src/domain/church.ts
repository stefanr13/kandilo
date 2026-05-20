import type { FieldValue, Timestamp } from 'firebase/firestore';

export type Role = 'priest' | 'admin' | 'member';
export type MembershipStatus = 'active' | 'pending' | 'suspended';

export interface Church {
  id: string;
  name: string;
  location: string;
  image: string;
}

export interface ClergyMember {
  name: string;
  title: string;
  photoURL: string;
  email: string;
  bio: string;
  isPrimary: boolean;
}

export interface ServiceScheduleEntry {
  day: string;
  name: string;
  time: string;
  notes: string;
}

export interface ChurchSocialMedia {
  instagram: string;
  facebook: string;
  youtube: string;
}

export interface ChurchEditableFields {
  name: string;
  denomination: string;
  jurisdiction: string;
  diocese: string;
  foundedYear: number;
  about: string;
  languages: string[];
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  timezone: string;
  phone: string;
  contactEmail: string;
  website: string;
  imageURL: string;
  coverImageURL: string;
  clergy: ClergyMember[];
  serviceSchedule: ServiceScheduleEntry[];
  socialMedia: ChurchSocialMedia;
  /** Whether to display Orthodox saint days in the calendar and home screen. Off by default. */
  showSaintDays: boolean;
}

export interface ChurchDoc extends ChurchEditableFields {
  createdAt: Timestamp | FieldValue;
  createdBy: string;
  isVerified: boolean;
  isActive: boolean;
}

export interface ChurchSummary extends ChurchEditableFields {
  id: string;
  location: string;
  isVerified: boolean;
  isActive: boolean;
}

export type SuperAdminChurchInput = Omit<
  ChurchEditableFields,
  'clergy' | 'serviceSchedule' | 'socialMedia' | 'showSaintDays'
>;

export interface SuperAdminChurchStats {
  churchId: string;
  name: string;
  city: string;
  state: string;
  denomination: string;
  isActive: boolean;
  isVerified: boolean;
  foundedYear: number;
  memberCount: number;
  priestCount: number;
  adminCount: number;
  donationTotal: number;
  eventCount: number;
  newsletterCount: number;
  imageURL: string;
}

export const EMPTY_CHURCH_SOCIAL_MEDIA: ChurchSocialMedia = {
  instagram: '',
  facebook: '',
  youtube: '',
};

export function buildChurchLocation({
  city,
  state,
  legacyLocation,
}: {
  city: string;
  state: string;
  legacyLocation?: string;
}): string {
  if (legacyLocation) return legacyLocation;
  if (city && state) return `${city}, ${state}`;
  return city || state;
}

export function mapChurchSummary(
  id: string,
  data: Record<string, unknown>
): ChurchSummary {
  const city = typeof data.city === 'string' ? data.city : '';
  const state = typeof data.state === 'string' ? data.state : '';
  const legacyLocation = typeof data.location === 'string' ? data.location : '';

  return {
    id,
    name: typeof data.name === 'string' ? data.name : '',
    location: buildChurchLocation({ city, state, legacyLocation }),
    imageURL: typeof data.imageURL === 'string' ? data.imageURL : '',
    coverImageURL:
      typeof data.coverImageURL === 'string'
        ? data.coverImageURL
        : typeof data.imageURL === 'string'
          ? data.imageURL
          : '',
    denomination: typeof data.denomination === 'string' ? data.denomination : '',
    jurisdiction: typeof data.jurisdiction === 'string' ? data.jurisdiction : '',
    diocese: typeof data.diocese === 'string' ? data.diocese : '',
    foundedYear: typeof data.foundedYear === 'number' ? data.foundedYear : 0,
    about: typeof data.about === 'string' ? data.about : '',
    languages: Array.isArray(data.languages)
      ? data.languages.filter((value): value is string => typeof value === 'string')
      : [],
    address: typeof data.address === 'string' ? data.address : '',
    city,
    state,
    country: typeof data.country === 'string' ? data.country : '',
    postalCode: typeof data.postalCode === 'string' ? data.postalCode : '',
    latitude: typeof data.latitude === 'number' ? data.latitude : 0,
    longitude: typeof data.longitude === 'number' ? data.longitude : 0,
    timezone: typeof data.timezone === 'string' ? data.timezone : '',
    phone: typeof data.phone === 'string' ? data.phone : '',
    contactEmail: typeof data.contactEmail === 'string' ? data.contactEmail : '',
    website: typeof data.website === 'string' ? data.website : '',
    clergy: Array.isArray(data.clergy)
      ? data.clergy.filter(
          (value): value is ClergyMember =>
            typeof value === 'object' && value !== null && typeof value.name === 'string'
        )
      : [],
    serviceSchedule: Array.isArray(data.serviceSchedule)
      ? data.serviceSchedule.filter(
          (value): value is ServiceScheduleEntry =>
            typeof value === 'object' && value !== null && typeof value.day === 'string'
        )
      : [],
    socialMedia:
      typeof data.socialMedia === 'object' && data.socialMedia !== null
        ? {
            instagram:
              typeof (data.socialMedia as Record<string, unknown>).instagram === 'string'
                ? (data.socialMedia as Record<string, string>).instagram
                : '',
            facebook:
              typeof (data.socialMedia as Record<string, unknown>).facebook === 'string'
                ? (data.socialMedia as Record<string, string>).facebook
                : '',
            youtube:
              typeof (data.socialMedia as Record<string, unknown>).youtube === 'string'
                ? (data.socialMedia as Record<string, string>).youtube
                : '',
          }
        : EMPTY_CHURCH_SOCIAL_MEDIA,
    isVerified: data.isVerified === true,
    isActive: data.isActive !== false,
    showSaintDays: data.showSaintDays === true,
  };
}

export function toChurch(
  summary: Pick<ChurchSummary, 'id' | 'name' | 'location' | 'imageURL'>
): Church {
  return {
    id: summary.id,
    name: summary.name,
    location: summary.location,
    image: summary.imageURL,
  };
}
