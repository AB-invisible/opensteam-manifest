const axios = require('axios');

const DEFAULT_DEPOTBOX_BASE_URL = 'https://depotbox.org';
const DEFAULT_REQUESTS_PER_MINUTE = 120;

let nextDepotBoxRequestAt = 0;

function depotBoxBaseUrl(value) {
  return String(value || DEFAULT_DEPOTBOX_BASE_URL).replace(/\/+$/, '');
}

function resolveDepotBoxUrl(pathOrUrl, baseUrl = DEFAULT_DEPOTBOX_BASE_URL) {
  const raw = String(pathOrUrl || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = depotBoxBaseUrl(baseUrl);
  return `${base}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function requestSpacingMs(requestsPerMinute = DEFAULT_REQUESTS_PER_MINUTE) {
  const rpm = Number(requestsPerMinute);
  if (!Number.isFinite(rpm) || rpm <= 0) return 0;
  return Math.ceil(60_000 / Math.min(DEFAULT_REQUESTS_PER_MINUTE, Math.max(1, rpm)));
}

async function waitForDepotBoxSlot(requestsPerMinute = DEFAULT_REQUESTS_PER_MINUTE) {
  const spacing = requestSpacingMs(requestsPerMinute);
  if (spacing <= 0) return;

  const now = Date.now();
  const waitMs = Math.max(0, nextDepotBoxRequestAt - now);
  nextDepotBoxRequestAt = Math.max(now, nextDepotBoxRequestAt) + spacing;
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

function looksLikeArchive(buffer) {
  if (!buffer || buffer.length < 1000) return false;
  if (buffer.slice(0, 2).toString('utf8') === 'PK') return true;
  if (buffer.slice(0, 4).toString('utf8') === 'Rar!') return true;
  if (buffer.slice(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) return true;
  const preview = buffer.slice(0, 200).toString('utf8').toLowerCase();
  return !preview.includes('<html') && !preview.includes('"error"') && !preview.includes('"message"');
}

function parseFilenameFromDisposition(disposition, fallback) {
  const value = String(disposition || '');
  const utf8Match = value.match(/filename\*=UTF-8''([^;\n]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const filenameMatch = value.match(/filename="?([^";\n]+)"?/i);
  return filenameMatch?.[1] || fallback;
}

function apiErrorMessage(prefix, status, body) {
  const message =
    body && typeof body === 'object'
      ? body.message || body.error || body.detail
      : typeof body === 'string'
        ? body
        : '';
  if (status === 429) return `${prefix} rate limit exceeded.`;
  if (status === 401 || status === 403) return `${prefix} API key was rejected.`;
  return message ? `${prefix}: ${message}` : `${prefix} returned HTTP ${status}.`;
}

async function depotBoxRequest(config, options = {}) {
  await waitForDepotBoxSlot(options.requestsPerMinute);
  return axios({
    timeout: 60_000,
    validateStatus: () => true,
    ...config,
  });
}

async function checkDepotBoxAvailability(appId, options = {}) {
  const apiKey = String(options.apiKey || process.env.DEPOTBOX_API_KEY || '').trim();
  if (!apiKey) {
    return { available: false, error: 'DEPOTBOX_API_KEY is not configured.' };
  }

  const baseUrl = depotBoxBaseUrl(options.baseUrl || process.env.DEPOTBOX_API_BASE);
  const appIdValue = String(appId || '').trim();

  const response = await depotBoxRequest(
    {
      method: 'GET',
      url: `${baseUrl}/api/games/${encodeURIComponent(appIdValue)}/availability`,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'OpenSteam/1.0',
        'X-API-Key': apiKey,
      },
    },
    { requestsPerMinute: options.requestsPerMinute },
  );

  if (response.status < 200 || response.status >= 300) {
    return {
      available: false,
      error: apiErrorMessage('DepotBox availability check failed', response.status, response.data),
      statusCode: response.status,
    };
  }

  return {
    available: response.data?.available === true,
    sources: response.data?.sources || null,
  };
}

async function fetchManifestFromDepotBox(appId, options = {}) {
  const apiKey = String(options.apiKey || process.env.DEPOTBOX_API_KEY || '').trim();
  if (!apiKey) {
    return { success: false, error: 'DEPOTBOX_API_KEY is not configured.' };
  }

  const baseUrl = depotBoxBaseUrl(options.baseUrl || process.env.DEPOTBOX_API_BASE);
  const requestsPerMinute = options.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE;
  const appIdValue = String(appId || '').trim();
  const headers = {
    Accept: 'application/json, application/zip, application/octet-stream, */*',
    'Content-Type': 'application/json',
    'User-Agent': 'OpenSteam/1.0',
    'X-API-Key': apiKey,
  };

  const startBody = { appid: appIdValue };
  if (options.specificDbId) startBody.specific_db_id = String(options.specificDbId);

  const start = await depotBoxRequest(
    {
      method: 'POST',
      url: `${baseUrl}/api/download`,
      headers,
      data: startBody,
    },
    { requestsPerMinute },
  );

  if (start.status < 200 || start.status >= 300) {
    return {
      success: false,
      error: apiErrorMessage('DepotBox download start failed', start.status, start.data),
      statusCode: start.status,
    };
  }

  const token = start.data?.token;
  if (!token) {
    return { success: false, error: 'DepotBox did not return a download token.', statusCode: start.status };
  }

  const maxPolls = Number.isFinite(Number(options.maxPolls)) ? Number(options.maxPolls) : 36;
  const pollIntervalMs = Number.isFinite(Number(options.pollIntervalMs)) ? Number(options.pollIntervalMs) : 5000;
  const initialPollDelayMs = Number.isFinite(Number(options.initialPollDelayMs)) ? Number(options.initialPollDelayMs) : 1500;
  let statusBody = null;

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const waitMs = attempt === 0 ? initialPollDelayMs : pollIntervalMs;
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));

    const status = await depotBoxRequest(
      {
        method: 'GET',
        url: `${baseUrl}/api/status/${encodeURIComponent(token)}`,
        headers,
      },
      { requestsPerMinute },
    );

    if (status.status < 200 || status.status >= 300) {
      return {
        success: false,
        error: apiErrorMessage('DepotBox status check failed', status.status, status.data),
        statusCode: status.status,
      };
    }

    statusBody = status.data || {};
    const state = String(statusBody.status || '').toLowerCase();
    if (state === 'completed') break;
    if (state === 'failed' || state === 'error') {
      return {
        success: false,
        error: statusBody.message || 'DepotBox failed to prepare the manifest archive.',
        statusCode: status.status,
        gameName: statusBody.gameName,
      };
    }
  }

  const downloadLink =
    statusBody?.download_link ||
    (start.data?.download_url_prefix ? `${start.data.download_url_prefix}${token}` : `/api/download/${token}`);
  if (!downloadLink) {
    return { success: false, error: 'DepotBox did not return a completed download link.' };
  }

  const download = await depotBoxRequest(
    {
      method: 'GET',
      url: resolveDepotBoxUrl(downloadLink, baseUrl),
      headers: {
        Accept: 'application/zip, application/octet-stream, */*',
        'User-Agent': 'OpenSteam/1.0',
        'X-API-Key': apiKey,
      },
      responseType: 'arraybuffer',
      timeout: 300_000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    },
    { requestsPerMinute },
  );

  if (download.status < 200 || download.status >= 300) {
    return {
      success: false,
      error: apiErrorMessage('DepotBox archive download failed', download.status, download.data),
      statusCode: download.status,
    };
  }

  const zipBuffer = Buffer.from(download.data || []);
  if (!looksLikeArchive(zipBuffer)) {
    return { success: false, error: 'DepotBox response was not a valid manifest archive.' };
  }

  const { cleanManifestZip } = require('./clean-manifest');
  const cleanedZipBuffer = await cleanManifestZip(zipBuffer);

  const filename =
    parseFilenameFromDisposition(download.headers?.['content-disposition'], statusBody?.finalUserZipName || `${appIdValue}.zip`);

  return {
    success: true,
    zipBuffer: cleanedZipBuffer,
    filename,
    gameName: statusBody?.gameName,
    source: 'DEPOTBOX',
  };
}

function resetDepotBoxRateLimiterForTests() {
  nextDepotBoxRequestAt = 0;
}

module.exports = {
  DEFAULT_DEPOTBOX_BASE_URL,
  DEFAULT_REQUESTS_PER_MINUTE,
  depotBoxBaseUrl,
  checkDepotBoxAvailability,
  fetchManifestFromDepotBox,
  looksLikeArchive,
  parseFilenameFromDisposition,
  requestSpacingMs,
  resetDepotBoxRateLimiterForTests,
  resolveDepotBoxUrl,
};
