const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const STORAGE_PATH = process.env.STORAGE_PATH || path.join(process.cwd(), 'data');

async function migrate() {
  console.log('--- Forge Persistence Migration ---');
  console.log(`Storage Path: ${STORAGE_PATH}`);

  // Ensure directories
  const scriptDir = path.join(STORAGE_PATH, 'user-data', 'scripts');
  const profileDir = path.join(STORAGE_PATH, 'user-data', 'profiles');
  
  if (!fs.existsSync(scriptDir)) fs.mkdirSync(scriptDir, { recursive: true });
  if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

  // 1. Sync Scripts
  const scripts = await prisma.extensionScript.findMany();
  console.log(`Found ${scripts.length} scripts in database.`);
  for (const script of scripts) {
    const filePath = path.join(scriptDir, `${script.id}.js`);
    fs.writeFileSync(filePath, script.content);
    console.log(`  - Persisted script: ${script.name} (${script.id})`);
  }

  // 2. Sync Profiles
  // manifestProfile might not be in the standard prisma client if it was added manually
  try {
    const profiles = await prisma.manifestProfile.findMany();
    console.log(`Found ${profiles.length} profiles in database.`);
    for (const profile of profiles) {
      const filePath = path.join(profileDir, `${profile.id}.json`);
      fs.writeFileSync(filePath, profile.config);
      console.log(`  - Persisted profile: ${profile.name} (${profile.id})`);
    }
  } catch (e) {
    console.warn('Could not sync manifestProfile (maybe model name is different or missing):', e.message);
  }

  console.log('--- Migration Complete ---');
}

migrate()
  .catch(err => console.error(err))
  .finally(() => prisma.$disconnect());
