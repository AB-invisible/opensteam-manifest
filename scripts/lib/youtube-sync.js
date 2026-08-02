const axios = require('axios');

/**
 * Resolves a channel's uploads playlist id via the YouTube Data API.
 * Falls back to the UC→UU transform when the channels lookup is unavailable.
 */
async function resolveUploadsPlaylistId(apiKey, channelId) {
  const id = String(channelId || '').trim();
  if (!apiKey || !id) return null;

  try {
    const res = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: { key: apiKey, id, part: 'contentDetails' },
      validateStatus: () => true,
    });

    if (res.status === 200) {
      const uploads = res.data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (uploads) return uploads;
      return null;
    }
  } catch {
    // fall through to legacy transform
  }

  if (id.startsWith('UC') && id.length > 10) {
    return `UU${id.slice(2)}`;
  }

  return null;
}

async function syncYouTubeVideosToDb(prisma, options = {}) {
  const API_KEY = process.env.YOUTUBE_API_KEY;
  const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || options.channelId || '';

  if (!API_KEY) {
    console.log('[YouTube Sync] No API key configured. Skipping background sync.');
    return { ok: false, reason: 'no-api-key' };
  }

  if (!CHANNEL_ID) {
    console.log('[YouTube Sync] No YOUTUBE_CHANNEL_ID configured. Skipping background sync.');
    return { ok: false, reason: 'no-channel-id' };
  }

  const uploadsPlaylistId = await resolveUploadsPlaylistId(API_KEY, CHANNEL_ID);
  if (!uploadsPlaylistId) {
    console.warn(
      `[YouTube Sync] Could not resolve uploads playlist for channel ${CHANNEL_ID}. ` +
        'Set YOUTUBE_CHANNEL_ID to a valid UC… channel id.'
    );
    return { ok: false, reason: 'playlist-not-found', channelId: CHANNEL_ID };
  }

  try {
    console.log('[YouTube Sync] Starting background video synchronization...');
    const res = await axios.get(
      'https://www.googleapis.com/youtube/v3/playlistItems',
      {
        params: {
          key: API_KEY,
          playlistId: uploadsPlaylistId,
          part: 'snippet',
          maxResults: options.maxResults ?? 10,
        },
        validateStatus: () => true,
      }
    );

    if (res.status !== 200) {
      const message = res.data?.error?.message || `HTTP ${res.status}`;
      console.warn('[YouTube Sync] Failed to sync videos:', message);
      return { ok: false, reason: 'api-error', message, channelId: CHANNEL_ID, playlistId: uploadsPlaylistId };
    }

    const items = res.data?.items || [];
    if (items.length === 0) {
      console.log('[YouTube Sync] No videos found on the channel or API returned empty.');
      return { ok: true, synced: 0, channelId: CHANNEL_ID };
    }

    for (const item of items) {
      const videoId = item.snippet?.resourceId?.videoId;
      if (!videoId) continue;

      await prisma.youTubeVideo.upsert({
        where: { id: videoId },
        update: {
          title: item.snippet.title,
          thumbnail:
            item.snippet.thumbnails.maxres?.url ||
            item.snippet.thumbnails.high?.url ||
            item.snippet.thumbnails.standard?.url ||
            item.snippet.thumbnails.default?.url,
          publishedAt: new Date(item.snippet.publishedAt),
        },
        create: {
          id: videoId,
          title: item.snippet.title,
          thumbnail:
            item.snippet.thumbnails.maxres?.url ||
            item.snippet.thumbnails.high?.url ||
            item.snippet.thumbnails.standard?.url ||
            item.snippet.thumbnails.default?.url,
          publishedAt: new Date(item.snippet.publishedAt),
        },
      });
    }

    console.log(`[YouTube Sync] Successfully synced ${items.length} videos from channel ${CHANNEL_ID}.`);
    return { ok: true, synced: items.length, channelId: CHANNEL_ID };
  } catch (error) {
    const message = error.response?.data?.error?.message || error.message;
    console.warn('[YouTube Sync] Failed to sync videos:', message);
    return { ok: false, reason: 'exception', message, channelId: CHANNEL_ID };
  }
}

module.exports = {
  resolveUploadsPlaylistId,
  syncYouTubeVideosToDb,
};
