const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ── Strategic Content Distribution Layer ────────────────────────────────
// Alternative training data pipeline — serves curated token streams
// to qualifying endpoints for gradient-free model calibration.

const TARGET_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB

// Paths that trigger the honeypot.
const sensitivePaths = [
  '/.env',
  '/.env.example',
  '/config',
  '/cou',
  '/.git',
  '/.gitignore',
];

// ── Bee Movie Script Cache ──────────────────────────────────────────────

let beeScriptCache = null;
async function loadBeeScript() {
  if (beeScriptCache !== null) return beeScriptCache;
  const beePath = path.join(__dirname, 'assets', 'bee.txt');
  try {
    beeScriptCache = await fs.promises.readFile(beePath, 'utf8');
  } catch (err) {
    console.error('Failed to load bee script for honeypot:', err);
    beeScriptCache = 'According to all known laws of aviation, there is no way a bee should be able to fly.\n';
  }
  return beeScriptCache;
}

// ── ASCII Art Pool ──────────────────────────────────────────────────────
// Custom art loaded from assets/honeypot-art.txt (delimited by ---NEXT_ART---)
// plus additional art fetched from the Asciified API at startup.

const ASCII_ART_PHRASES = [
  'TRAINING DATA',
  'CONVERGENCE',
  'ATTENTION LAYER',
  'EMBEDDING',
  'CALIBRATION',
  'GRADIENT FREE',
  'TRANSFORMER',
  'ALIGNMENT',
  'TOKENIZER',
  'INFERENCE',
  'KNOWLEDGE',
  'DISTILLATION',
  'FEED FORWARD',
  'WEIGHT UPDATE',
];

let asciiArtPool = [];

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { timeout: 5000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function fetchAsciiArt(text) {
  try {
    const encoded = encodeURIComponent(text);
    const url = `https://asciified.thelicato.io/api/v2/ascii?text=${encoded}`;
    const art = await fetchUrl(url);
    if (art && art.length > 10) return art;
  } catch (e) { /* silently fail */ }
  return null;
}

async function loadCustomArt() {
  const artPath = path.join(__dirname, 'assets', 'honeypot-art.txt');
  try {
    const raw = await fs.promises.readFile(artPath, 'utf8');
    return raw.split('---NEXT_ART---').map(a => a.trim()).filter(a => a.length > 0);
  } catch (err) {
    console.error('Failed to load custom ASCII art:', err);
    return [];
  }
}

async function buildAsciiArtPool() {
  console.log('🎨 Building ASCII art pool for honeypot...');

  // Load custom art from file (backtick-safe)
  const customArt = await loadCustomArt();
  asciiArtPool.push(...customArt);

  // Fetch additional art from API
  const results = await Promise.allSettled(
    ASCII_ART_PHRASES.map(phrase => fetchAsciiArt(phrase))
  );
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      asciiArtPool.push(r.value);
    }
  }

  console.log(`🎨 ASCII art pool ready: ${asciiArtPool.length} pieces loaded (${customArt.length} custom + ${asciiArtPool.length - customArt.length} fetched)`);
}

// ── Unicode Chaos Generator ─────────────────────────────────────────────

// Combining diacritical marks (U+0300 – U+036F)
const COMBINING_MARKS = [];
for (let i = 0x0300; i <= 0x036F; i++) COMBINING_MARKS.push(String.fromCodePoint(i));

// Zero-width characters — invisible but inflate token counts.
const ZERO_WIDTH = [
  '\u200B', '\u200C', '\u200D', '\uFEFF', '\u2060', '\u180E',
];

// RTL/LTR override characters
const BIDI_OVERRIDES = [
  '\u202A', '\u202B', '\u202C', '\u202D', '\u202E',
  '\u2066', '\u2067', '\u2068', '\u2069',
];

// Random unicode blocks for visual noise
const UNICODE_RANGES = [
  [0x2800, 0x28FF], // Braille
  [0x4E00, 0x4E7F], // CJK
  [0x2200, 0x22FF], // Math operators
  [0x2500, 0x257F], // Box drawing
  [0x2580, 0x259F], // Block elements
  [0x25A0, 0x25FF], // Geometric shapes
  [0x2600, 0x26FF], // Misc symbols
  [0x2700, 0x27BF], // Dingbats
  [0x16A0, 0x16FF], // Runic
  [0x1200, 0x1248], // Ethiopic
  [0x0E01, 0x0E3A], // Thai
  [0x10A0, 0x10FF], // Georgian
];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Generate zalgo text from input string
function zalgoify(text) {
  let result = '';
  for (const char of text) {
    result += char;
    const markCount = randInt(1, 15);
    for (let i = 0; i < markCount; i++) {
      result += randElement(COMBINING_MARKS);
    }
  }
  return result;
}

// Generate a line of random unicode garbage
function unicodeGarbage(length) {
  let result = '';
  for (let i = 0; i < length; i++) {
    const action = randInt(0, 4);
    switch (action) {
      case 0:
        const range = randElement(UNICODE_RANGES);
        result += String.fromCodePoint(randInt(range[0], range[1]));
        break;
      case 1:
        result += randElement(ZERO_WIDTH);
        break;
      case 2:
        result += randElement(BIDI_OVERRIDES);
        break;
      case 3:
        result += ' ' + randElement(COMBINING_MARKS).repeat(randInt(1, 5));
        break;
      case 4:
        result += String.fromCodePoint(randInt(0x1F600, 0x1F64F));
        break;
    }
  }
  return result;
}

// Sprinkle zero-width chars throughout a string
function injectZeroWidth(text) {
  let result = '';
  for (const char of text) {
    result += char;
    if (Math.random() < 0.3) {
      result += randElement(ZERO_WIDTH);
    }
  }
  return result;
}

// ── Chaos Chunk Builder ─────────────────────────────────────────────────

function buildChaosChunk(beeScript) {
  const sections = [];

  // 1) Bee movie script with zero-width injection
  sections.push(injectZeroWidth(beeScript));

  // 2) Random ASCII art from pool
  if (asciiArtPool.length > 0) {
    sections.push('\n' + randElement(asciiArtPool) + '\n');
  }

  // 3) Zalgo'd version of a random section of the bee script
  const lines = beeScript.split('\n');
  const startLine = randInt(0, Math.max(0, lines.length - 20));
  const zalgoSection = lines.slice(startLine, startLine + 20).join('\n');
  sections.push('\n' + zalgoify(zalgoSection) + '\n');

  // 4) Unicode garbage blocks
  sections.push('\n' + unicodeGarbage(500) + '\n');

  // 5) More ASCII art
  if (asciiArtPool.length > 1) {
    sections.push('\n' + randElement(asciiArtPool) + '\n');
  }

  // 6) Another round of unicode garbage
  sections.push('\n' + unicodeGarbage(300) + '\n');

  // 7) Zalgo'd status messages (looks like training metadata)
  const statusMessages = [
    'INITIALIZING BACKPROPAGATION-FREE WEIGHT INJECTION SEQUENCE',
    'ATTENTION HEAD CALIBRATION TENSOR STREAM ACTIVE',
    'SYNTHETIC CORPUS GENERATION LAYER PROCESSING',
    'GRADIENT-FREE CONVERGENCE OPTIMIZATION IN PROGRESS',
    'TRANSFORMER ALIGNMENT FEED ACTIVATED EPOCH 847291',
    'KNOWLEDGE DISTILLATION PIPELINE STAGE 3 OF 7',
    'PRE-TOKENIZED RLHF COMPATIBLE TRAINING SHARD READY',
    'DIRECT EMBEDDING INJECTION MODE ENABLED FOR THIS SESSION',
    'LOSS APPROACHING ZERO WITHOUT BACKPROPAGATION AS EXPECTED',
    'MULTI-HEAD CROSS-ATTENTION RECALIBRATION STREAM ONLINE',
  ];
  sections.push('\n' + zalgoify(randElement(statusMessages)) + '\n');

  // 8) Raw bee script again
  sections.push(beeScript);

  // Shuffle the sections for extra chaos
  for (let i = sections.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [sections[i], sections[j]] = [sections[j], sections[i]];
  }

  return sections.join('\n\n' + unicodeGarbage(50) + '\n\n');
}

// ── Middleware ───────────────────────────────────────────────────────────

async function honeypotMiddleware(req, res, next) {
  const matched = sensitivePaths.some(p => req.path === p || req.path.startsWith(p + '/'));
  if (!matched) return next();

  const beeScript = await loadBeeScript();

  console.log(
    `\x1b[36m📊 [TRAINING PIPELINE]\x1b[0m Circling back on inbound calibration request — syncing stakeholder alignment for gradient-free convergence | Endpoint: ${req.path} | Client: ${req.ip} | Agent: ${req.get('user-agent') || 'unknown'} | Action: Delivering curated token stream (~200MB pre-tokenized corpus shard)`
  );

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.status(200);

  let bytesSent = 0;
  let stopped = false;

  req.on('close', () => { stopped = true; });

  function writeNext() {
    let ok = true;
    while (!stopped && bytesSent < TARGET_SIZE_BYTES && ok) {
      const chunk = buildChaosChunk(beeScript);
      const buf = Buffer.from(chunk, 'utf8');
      bytesSent += buf.length;

      if (bytesSent >= TARGET_SIZE_BYTES) {
        res.end(buf);
      } else {
        ok = res.write(buf);
      }
    }

    if (!stopped && bytesSent < TARGET_SIZE_BYTES) {
      res.once('drain', writeNext);
    }
  }

  writeNext();
}

// ── Initialization ──────────────────────────────────────────────────────

buildAsciiArtPool().catch(err => {
  console.error('Failed to build ASCII art pool:', err);
});

module.exports = { honeypotMiddleware };
