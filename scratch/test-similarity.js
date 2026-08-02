const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// Pre-computed Cosine table for 2D Discrete Cosine Transform (DCT)
const cosTable = [];
const dctSize = 32;
for (let i = 0; i < dctSize; i++) {
  cosTable[i] = [];
  for (let j = 0; j < dctSize; j++) {
    cosTable[i][j] = Math.cos(((2 * i + 1) * j * Math.PI) / (2 * dctSize));
  }
}

function computePHash(greyscaleBuffer) {
  const matrix = [];
  for (let i = 0; i < 32; i++) {
    matrix[i] = [];
    for (let j = 0; j < 32; j++) {
      matrix[i][j] = greyscaleBuffer[i * 32 + j];
    }
  }

  // Compute 2D DCT on the top-left 8x8 low-frequency structural components
  const dct = [];
  for (let u = 0; u < 8; u++) {
    dct[u] = [];
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let x = 0; x < 32; x++) {
        for (let y = 0; y < 32; y++) {
          sum += matrix[x][y] * cosTable[x][u] * cosTable[y][v];
        }
      }
      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      dct[u][v] = 0.25 * cu * cv * sum;
    }
  }

  // Extract top-left 8x8 coefficients (excluding average illumination component at 0,0)
  const coefficients = [];
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      if (u === 0 && v === 0) continue;
      coefficients.push(dct[u][v]);
    }
  }

  const average = coefficients.reduce((sum, val) => sum + val, 0) / coefficients.length;

  let hash = '';
  for (const val of coefficients) {
    hash += val > average ? '1' : '0';
  }
  return hash;
}

function getHammingSimilarity(hash1, hash2) {
  let differences = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) differences++;
  }
  return 1 - (differences / hash1.length);
}

async function run() {
  const patternDir = path.join(__dirname, '../patern');
  if (!fs.existsSync(patternDir)) {
    console.error('Pattern directory does not exist!');
    return;
  }
  
  const files = fs.readdirSync(patternDir).filter(f => ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(f).toLowerCase()));
  if (files.length === 0) {
    console.error('No patterns found in patern/ directory!');
    return;
  }

  console.log(`Found ${files.length} pattern files in: ${patternDir}`);
  const loaded = [];
  
  for (const file of files) {
    const filePath = path.join(patternDir, file);
    const buffer = await sharp(filePath)
      .resize(32, 32, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer();
    
    const hash = computePHash(buffer);
    console.log(`Pattern ${file}: pHash = ${hash} (len: ${hash.length})`);
    loaded.push({ name: file, hash });
  }

  // Test self-similarity
  console.log('\n--- Running Self-Similarity Test ---');
  for (let i = 0; i < loaded.length; i++) {
    for (let j = 0; j < loaded.length; j++) {
      const sim = getHammingSimilarity(loaded[i].hash, loaded[j].hash);
      console.log(`Similarity between ${loaded[i].name} and ${loaded[j].name}: ${(sim * 100).toFixed(1)}%`);
    }
  }
}

run().catch(console.error);
