import { ChurchSummary, SuperAdminChurchInput } from '../../domain/church';

export interface ChurchFormData {
  name: string;
  denomination: string;
  jurisdiction: string;
  diocese: string;
  foundedYear: string;
  about: string;
  languages: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  latitude: string;
  longitude: string;
  timezone: string;
  phone: string;
  contactEmail: string;
  website: string;
  imageURL: string;
  coverImageURL: string;
}

export const EMPTY_CHURCH_FORM: ChurchFormData = {
  name: '',
  denomination: 'Eastern Orthodox',
  jurisdiction: '',
  diocese: '',
  foundedYear: '',
  about: '',
  languages: 'English',
  address: '',
  city: '',
  state: '',
  country: 'US',
  postalCode: '',
  latitude: '',
  longitude: '',
  timezone: 'America/New_York',
  phone: '',
  contactEmail: '',
  website: '',
  imageURL: '',
  coverImageURL: '',
};

export function buildChurchInput(form: ChurchFormData): SuperAdminChurchInput {
  return {
    ...form,
    foundedYear: Number.parseInt(form.foundedYear, 10) || 0,
    latitude: Number.parseFloat(form.latitude) || 0,
    longitude: Number.parseFloat(form.longitude) || 0,
    languages: form.languages.split(',').map((language) => language.trim()).filter(Boolean),
  };
}

export function buildEditChurchForm(church: ChurchSummary): ChurchFormData {
  return {
    name: church.name,
    denomination: church.denomination,
    jurisdiction: church.jurisdiction,
    diocese: church.diocese,
    foundedYear: String(church.foundedYear || ''),
    about: church.about,
    languages: church.languages.join(', '),
    address: church.address,
    city: church.city,
    state: church.state,
    country: church.country,
    postalCode: church.postalCode,
    latitude: church.latitude ? String(church.latitude) : '',
    longitude: church.longitude ? String(church.longitude) : '',
    timezone: church.timezone || 'America/New_York',
    phone: church.phone,
    contactEmail: church.contactEmail,
    website: church.website,
    imageURL: church.imageURL,
    coverImageURL: church.coverImageURL,
  };
}
