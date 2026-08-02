const TEXT_SAFETY_ITEMS = new Set(['nickname', 'heckle', 'shoutout', 'spotlight', 'thread']);

const NORMALIZE_MAP = new Map([
  ['@', 'a'],
  ['4', 'a'],
  ['0', 'o'],
  ['1', 'i'],
  ['!', 'i'],
  ['3', 'e'],
  ['5', 's'],
  ['$', 's'],
  ['7', 't'],
]);

const SPACED_PATTERNS = [
  { pattern: /\b(?:kys|kill\s+yourself)\b/i, reason: 'self-harm harassment' },
  { pattern: /\b(?:porn|nsfw|nudes?|xxx|hentai|only\s*fans|sex|sexy)\b/i, reason: 'NSFW language' },
  { pattern: /\b(?:fuck|shit|bitch|asshole|cunt|slut|whore|dick|cock|pussy)\b/i, reason: 'rude or explicit language' },
  { pattern: /\b(?:idiot|moron|loser|trash)\b/i, reason: 'rude language' },
  { pattern: /\b(?:nazi|hitler)\b/i, reason: 'abusive extremist reference' },
  { pattern: /https?:\/\/|discord\.gg|\.com\b/i, reason: 'links are not allowed in shop text' },
];

const COMPACT_PATTERNS = [
  { pattern: /killyourself|onlyfans|pornhub/i, reason: 'unsafe phrase' },
];

function normalizeShopText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .split('')
    .map((ch) => NORMALIZE_MAP.get(ch) || ch)
    .join('');
}

function compactShopText(value) {
  return normalizeShopText(value).replace(/[^a-z0-9]/g, '');
}

function shouldModerateShopText(itemId) {
  return TEXT_SAFETY_ITEMS.has(String(itemId || '').trim().toLowerCase());
}

function validateShopTextValue(itemId, value) {
  if (!shouldModerateShopText(itemId)) {
    return { ok: true };
  }

  const normalized = normalizeShopText(value);
  const compact = compactShopText(value);

  for (const rule of SPACED_PATTERNS) {
    if (rule.pattern.test(normalized)) {
      return { ok: false, reason: rule.reason };
    }
  }

  for (const rule of COMPACT_PATTERNS) {
    if (rule.pattern.test(compact)) {
      return { ok: false, reason: rule.reason };
    }
  }

  return { ok: true };
}

module.exports = {
  compactShopText,
  normalizeShopText,
  shouldModerateShopText,
  validateShopTextValue,
};
