
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '../src/data/saints_2026_full.json');

initializeApp({
  credential: applicationDefault(),
  projectId: 'kandilo-2f7a9'
});

const db = getFirestore();

async function seed() {
  console.log('Reading saints data...');
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  
  const collectionName = 'saints';
  const batchSize = 50;
  let count = 0;

  console.log(`Starting seed of ${data.length} days into collection "${collectionName}"...`);

  for (let i = 0; i < data.length; i += batchSize) {
    const batch = db.batch();
    const chunk = data.slice(i, i + batchSize);

    chunk.forEach(day => {
      const docRef = db.collection(collectionName).doc(day.date);
      batch.set(docRef, {
        date: day.date,
        saints: day.saints
      });
    });

    await batch.commit();
    count += chunk.length;
    console.log(`✓ Progress: ${count}/${data.length} days seeded...`);
  }

  console.log('\nSuccess! 2026 Saints Calendar is now live in Firestore.');
}

seed().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
