import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault(), projectId: 'kandilo-2f7a9' });
const db = getFirestore();

const stSimeon = {
  name: 'St. Simeon Mirotocivi',
  denomination: 'Eastern Orthodox',
  jurisdiction: 'Serbian Orthodox Diocese of Eastern America',
  diocese: 'Diocese of Eastern America',
  foundedYear: 1968,
  about:
    'St. Simeon Mirotocivi Serbian Orthodox Church has served the South Miami community since 1968. ' +
    'Named after St. Simeon the Myrrh-Gusher, the first crowned king of Serbia, our parish is a spiritual ' +
    'home for Orthodox Christians of Serbian heritage and all who seek the ancient faith. ' +
    'We celebrate the Divine Liturgy in both English and Serbian, preserving the richness of Orthodox tradition.',
  languages: ['English', 'Serbian'],

  address: '7901 SW 68th Ave',
  city: 'South Miami',
  state: 'FL',
  country: 'US',
  postalCode: '33143',
  latitude: 25.7053,
  longitude: -80.3014,
  timezone: 'America/New_York',

  phone: '+1 (305) 661-0282',
  contactEmail: 'stefanr13@gmail.com',
  website: 'https://kandilo-2f7a9.web.app',

  imageURL: 'https://picsum.photos/seed/st-simeon/400/400',
  coverImageURL: 'https://picsum.photos/seed/st-simeon-cover/1200/600',

  clergy: [
    {
      name: 'Fr. Stefan Radeta',
      title: 'Priest',
      photoURL: 'https://i.pravatar.cc/300?u=fr-stefan',
      email: 'stefanr13@gmail.com',
      bio: 'Father Stefan was ordained to the Holy Priesthood in 2015. He holds a Master of Divinity from St. Vladimir\'s Orthodox Theological Seminary and has served St. Simeon since 2019.',
      isPrimary: true,
    },
    {
      name: 'Dn. Nikola Petrović',
      title: 'Deacon',
      photoURL: 'https://i.pravatar.cc/300?u=dn-nikola',
      email: 'nikola@st-simeon.org',
      bio: 'Deacon Nikola serves as the parish deacon and youth director, leading our GOYA chapter and Sunday school programs.',
      isPrimary: false,
    },
  ],

  serviceSchedule: [
    { day: 'Sunday', name: 'Orthros (Matins)', time: '9:00 AM', notes: '' },
    { day: 'Sunday', name: 'Divine Liturgy', time: '10:00 AM', notes: 'Confession available 30 min before Liturgy' },
    { day: 'Saturday', name: 'Great Vespers', time: '5:00 PM', notes: '' },
    { day: 'Wednesday', name: 'Akathist to the Theotokos', time: '7:00 PM', notes: 'During Great Lent' },
    { day: 'Friday', name: 'Paraklesis', time: '7:00 PM', notes: 'August fast' },
  ],

  socialMedia: {
    instagram: 'https://instagram.com/kandilo_faith',
    facebook: 'https://facebook.com/stsimeonmiami',
    youtube: 'https://youtube.com/@stsimeonmiami',
  },

  isVerified: true,
};

const holyTrinity = {
  name: 'Holy Trinity Orthodox Cathedral',
  denomination: 'Eastern Orthodox',
  jurisdiction: 'Greek Orthodox Archdiocese of America',
  diocese: 'Metropolis of Chicago',
  foundedYear: 1897,
  about:
    'Holy Trinity Orthodox Cathedral is one of the oldest Greek Orthodox parishes in the Midwest, ' +
    'founded in 1897 by Greek immigrants who brought their faith to Chicago. ' +
    'Our cathedral stands as a pillar of Orthodox Christianity, serving thousands of faithful ' +
    'across the greater Chicago area. We offer services in English and Greek, with vibrant ' +
    'ministries for all ages.',
  languages: ['English', 'Greek'],

  address: '60 W Roslyn Pl',
  city: 'Chicago',
  state: 'IL',
  country: 'US',
  postalCode: '60614',
  latitude: 41.9214,
  longitude: -87.6395,
  timezone: 'America/Chicago',

  phone: '+1 (773) 525-6388',
  contactEmail: 'office@holytrinitychicago.org',
  website: 'https://holytrinitychicago.org',

  imageURL: 'https://picsum.photos/seed/holy-trinity/400/400',
  coverImageURL: 'https://picsum.photos/seed/holy-trinity-cover/1200/600',

  clergy: [
    {
      name: 'Fr. Alexander Papadopoulos',
      title: 'Priest',
      photoURL: 'https://i.pravatar.cc/300?u=fr-alexander',
      email: 'fr.alexander@holytrinitychicago.org',
      bio: 'Father Alexander has served as the Dean of Holy Trinity Cathedral since 2010. He is a graduate of Holy Cross Greek Orthodox School of Theology and is known for his inspiring homilies and pastoral care.',
      isPrimary: true,
    },
    {
      name: 'Fr. Konstantinos Stavros',
      title: 'Associate Priest',
      photoURL: 'https://i.pravatar.cc/300?u=fr-konstantinos',
      email: 'fr.konstantinos@holytrinitychicago.org',
      bio: 'Father Konstantinos joined the cathedral staff in 2018 and oversees the young adult ministry and Greek school program.',
      isPrimary: false,
    },
    {
      name: 'Dn. Georgios Nikolaou',
      title: 'Deacon',
      photoURL: 'https://i.pravatar.cc/300?u=dn-georgios',
      email: 'dn.georgios@holytrinitychicago.org',
      bio: 'Deacon Georgios assists in all liturgical services and serves as the coordinator for the parish outreach and philoptochos ministries.',
      isPrimary: false,
    },
  ],

  serviceSchedule: [
    { day: 'Sunday', name: 'Orthros (Matins)', time: '8:45 AM', notes: '' },
    { day: 'Sunday', name: 'Divine Liturgy', time: '10:00 AM', notes: 'Confession available upon request' },
    { day: 'Saturday', name: 'Great Vespers', time: '5:00 PM', notes: '' },
    { day: 'Wednesday', name: 'Divine Liturgy', time: '9:00 AM', notes: 'Feast days and first Wednesday of month' },
  ],

  socialMedia: {
    instagram: 'https://instagram.com/holytrinitychicago',
    facebook: 'https://facebook.com/holytrinitychicago',
    youtube: 'https://youtube.com/@holytrinitychicago',
  },

  isVerified: true,
};

async function run() {
  await db.collection('churches').doc('st-simeon-south-miami').update(stSimeon);
  console.log('✓ Updated st-simeon-south-miami');

  await db.collection('churches').doc('holy-trinity-chicago').update(holyTrinity);
  console.log('✓ Updated holy-trinity-chicago');

  console.log('\nDone. Both church profiles are now complete.');
}

run().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
