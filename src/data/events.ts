export type Category = 'Divine Liturgy' | 'Vespers & Vigil' | 'Feast Day' | 'Ministry & Education' | 'Community & Social' | 'Sacramental';
export type City = 'Parish' | 'Diocese' | 'All';

export interface Event {
  id: number;
  date: string;
  month: string;
  year?: number;
  sortTime?: number;
  title: string;
  time: string;
  endTime: string;
  location: string;
  description: string;
  attendees: number;
  hasLimitedSpots: boolean;
  isVirtual?: boolean;
  category: Category;
  city: City;
  price: number;
  color: string;
  commemoration?: string; // For Saint or Feast name
}

export const ALL_EVENTS: Event[] = [
  {
    id: 1, date: '16', month: 'OCT', title: 'Divine Liturgy', time: '09:00 AM', endTime: '11:00 AM', location: 'Main Sanctuary',
    description: 'Sunday morning Divine Liturgy followed by coffee hour.', attendees: 120, hasLimitedSpots: false,
    category: 'Divine Liturgy', city: 'Parish', price: 0, color: '#800000',
    commemoration: '18th Sunday after Pentecost'
  },
  {
    id: 2, date: '19', month: 'OCT', title: 'Great Vespers', time: '06:00 PM', endTime: '07:00 PM', location: 'Main Sanctuary',
    description: 'Evening prayer service for the feast of St. John.', attendees: 45, hasLimitedSpots: false,
    category: 'Vespers & Vigil', city: 'Parish', price: 0, color: '#111827',
    commemoration: 'St. John of Rila'
  },
  {
    id: 3, date: '24', month: 'OCT', title: 'Orthodoxy 101', time: '07:00 PM', endTime: '08:30 PM', location: 'Parish Hall',
    description: 'Introduction to the Orthodox faith for seekers and catechumens.', attendees: 15, hasLimitedSpots: false,
    category: 'Ministry & Education', city: 'Parish', price: 0, color: '#937022'
  },
  {
    id: 4, date: '28', month: 'OCT', title: 'Parish Potluck', time: '12:00 PM', endTime: '02:00 PM', location: 'Parish Hall',
    description: 'Community meal following the Liturgy. Please bring a dish to share.', attendees: 80, hasLimitedSpots: false,
    category: 'Community & Social', city: 'Parish', price: 0, color: '#4B5563'
  },
  {
    id: 5, date: '12', month: 'OCT', title: 'Food Bank Drive', time: '09:00 AM', endTime: '04:00 PM', location: 'Community Center',
    description: 'Collecting non-perishable items for the local food bank.', attendees: 25, hasLimitedSpots: false,
    category: 'Community & Social', city: 'Parish', price: 0, color: '#10B981'
  },
  {
    id: 6, date: '22', month: 'OCT', title: 'Choir Rehearsal', time: '07:00 PM', endTime: '08:30 PM', location: 'Choir Loft',
    description: 'Weekly practice for the parish choir.', attendees: 12, hasLimitedSpots: false,
    category: 'Ministry & Education', city: 'Parish', price: 0, color: '#111827'
  }
];
