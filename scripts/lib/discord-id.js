/**
 * Normalize Discord snowflake fields from forms or manual entry so
 * "<@123...>", "<@!123...>", and plain IDs compare equal after trim.
 */
function normalizeDiscordSnowflake(input) {
  if (input == null) return '';
  const s = String(input).trim();
  if (!s) return '';
  const mention = s.match(/^<@!?(\d{15,22})>$/);
  if (mention) return mention[1];
  const digits = s.match(/^(\d{15,22})$/);
  if (digits) return digits[1];
  return s;
}

function isValidDiscordSnowflake(input) {
  const normalized = normalizeDiscordSnowflake(input);
  return /^\d{15,22}$/.test(normalized);
}

module.exports = { normalizeDiscordSnowflake, isValidDiscordSnowflake };
