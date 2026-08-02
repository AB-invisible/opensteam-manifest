import { APPLICATION_MAX_SCORE, APPLICATION_PASS_SCORE } from './config';
import { normalizeDiscordSnowflake } from './discord-id';
import { prisma } from './prisma';

const TRELLO_API_BASE = 'https://api.trello.com/1';

interface TrelloCredentials {
  apiKey: string;
  apiToken: string;
  boardId: string;
}

export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  labels: { id: string; name: string; color: string }[];
  list: string; // list name
  listId: string;
  status: 'PENDING' | 'ACCEPTED' | 'FAILED' | 'UNKNOWN';
  dateLastActivity: string;
  url: string;
  members: { id: string; fullName: string; username: string }[];
}

export interface TrelloSyncResult {
  cards: TrelloCard[];
  lists: { id: string; name: string; cardCount: number }[];
  stats: {
    total: number;
    pending: number;
    accepted: number;
    failed: number;
    unknown: number;
  };
  syncedAt: string;
}

/**
 * Get Trello credentials from systemConfig DB or env vars
 */
async function getTrelloCredentials(): Promise<TrelloCredentials> {
  // Try DB systemConfig first
  const [apiKeyCfg, apiTokenCfg, boardIdCfg] = await Promise.all([
    prisma.systemConfig.findUnique({ where: { key: 'TRELLO_API_KEY' } }),
    prisma.systemConfig.findUnique({ where: { key: 'TRELLO_API_TOKEN' } }),
    prisma.systemConfig.findUnique({ where: { key: 'TRELLO_BOARD_ID' } }),
  ]);

  const apiKey = apiKeyCfg?.value || process.env.TRELLO_API_KEY;
  const apiToken = apiTokenCfg?.value || process.env.TRELLO_API_TOKEN;
  const boardId = boardIdCfg?.value || process.env.TRELLO_BOARD_ID;

  if (!apiKey || !apiToken || !boardId) {
    throw new Error(
      'Trello integration not configured. Set TRELLO_API_KEY, TRELLO_API_TOKEN, and TRELLO_BOARD_ID in System Config or environment variables.'
    );
  }

  return { apiKey, apiToken, boardId };
}

/**
 * Make an authenticated Trello API request
 */
async function trelloFetch(path: string, creds: TrelloCredentials, params: Record<string, string> = {}) {
  const url = new URL(`${TRELLO_API_BASE}${path}`);
  url.searchParams.set('key', creds.apiKey);
  url.searchParams.set('token', creds.apiToken);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const response = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json' },
    cache: 'no-store'
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Trello API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Infer application status from list name or labels
 * Maps common Trello list/label names to our internal statuses
 */
function inferStatus(listName: string, labels: { name: string; color: string }[]): TrelloCard['status'] {
  const lower = listName.toLowerCase();

  // Check list name first
  if (lower.includes('accepted') || lower.includes('approved') || lower.includes('passed')) return 'ACCEPTED';
  if (lower.includes('failed') || lower.includes('rejected') || lower.includes('denied')) return 'FAILED';
  if (lower.includes('pending') || lower.includes('review') || lower.includes('new') || lower.includes('inbox') || lower.includes('to do')) return 'PENDING';

  // Fallback: check label names
  for (const label of labels) {
    const lbl = label.name.toLowerCase();
    if (lbl.includes('accepted') || lbl.includes('approved') || lbl.includes('passed')) return 'ACCEPTED';
    if (lbl.includes('failed') || lbl.includes('rejected') || lbl.includes('denied')) return 'FAILED';
    if (lbl.includes('pending') || lbl.includes('review')) return 'PENDING';
  }

  // Fallback: check label colors (green=accepted, red=failed, yellow/orange=pending)
  for (const label of labels) {
    if (label.color === 'green') return 'ACCEPTED';
    if (label.color === 'red') return 'FAILED';
    if (label.color === 'yellow' || label.color === 'orange') return 'PENDING';
  }

  return 'UNKNOWN';
}

/**
 * Fetch all cards from the configured Trello board and parse their statuses
 */
export async function syncTrelloBoard(): Promise<TrelloSyncResult> {
  const creds = await getTrelloCredentials();

  // Fetch lists on the board
  const lists = await trelloFetch(`/boards/${creds.boardId}/lists`, creds, {
    fields: 'id,name',
  });

  // Fetch all cards on the board with labels and members
  const cards = await trelloFetch(`/boards/${creds.boardId}/cards`, creds, {
    fields: 'id,name,desc,labels,idList,dateLastActivity,url,idMembers',
    members: 'true',
    member_fields: 'id,fullName,username',
  });

  // Build list name lookup
  const listMap = new Map<string, string>();
  for (const list of lists) {
    listMap.set(list.id, list.name);
  }

  // Parse cards into structured format
  const parsedCards: TrelloCard[] = (cards as any[]).map((card: any) => {
    const listName = listMap.get(card.idList) || 'Unknown';
    const cardLabels = (card.labels || []).map((l: any) => ({
      id: l.id,
      name: l.name || '',
      color: l.color || '',
    }));

    return {
      id: card.id,
      name: card.name,
      desc: card.desc || '',
      labels: cardLabels,
      list: listName,
      listId: card.idList,
      status: inferStatus(listName, cardLabels),
      dateLastActivity: card.dateLastActivity,
      url: card.url,
      members: (card.members || []).map((m: any) => ({
        id: m.id,
        fullName: m.fullName || '',
        username: m.username || '',
      })),
    };
  });

  // Compute stats
  const stats = {
    total: parsedCards.length,
    pending: parsedCards.filter(c => c.status === 'PENDING').length,
    accepted: parsedCards.filter(c => c.status === 'ACCEPTED').length,
    failed: parsedCards.filter(c => c.status === 'FAILED').length,
    unknown: parsedCards.filter(c => c.status === 'UNKNOWN').length,
  };

  // List stats
  const listStats = lists.map((list: any) => ({
    id: list.id,
    name: list.name,
    cardCount: parsedCards.filter(c => c.listId === list.id).length,
  }));

  return {
    cards: parsedCards,
    lists: listStats,
    stats,
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Move a card to a different list (e.g., mark as Accepted/Failed)
 */
export async function moveCardToList(cardId: string, targetListId: string): Promise<void> {
  const creds = await getTrelloCredentials();

  const url = new URL(`${TRELLO_API_BASE}/cards/${cardId}`);
  url.searchParams.set('key', creds.apiKey);
  url.searchParams.set('token', creds.apiToken);
  url.searchParams.set('idList', targetListId);

  const response = await fetch(url.toString(), {
    method: 'PUT',
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to move Trello card: ${errorText}`);
  }
}

/**
 * Create a new Trello card
 */
export async function createTrelloCard(name: string, desc: string, listId: string): Promise<any> {
  const creds = await getTrelloCredentials();

  const url = new URL(`${TRELLO_API_BASE}/cards`);
  url.searchParams.set('key', creds.apiKey);
  url.searchParams.set('token', creds.apiToken);
  url.searchParams.set('name', name);
  url.searchParams.set('desc', desc);
  url.searchParams.set('idList', listId);

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create Trello card: ${errorText}`);
  }

  return response.json();
}

/**
 * Find an application card by Discord user id. Card titles are expected to contain
 * the snowflake in parentheses, e.g. "Name (123456789012345678)" — substring matching
 * on the id alone caused wrong-card matches and duplicate cards.
 */
export async function findTrelloCardByName(discordUserId: string): Promise<any | null> {
  const creds = await getTrelloCredentials();
  const id = normalizeDiscordSnowflake(discordUserId) || String(discordUserId).trim();
  if (!id) return null;

  const cards = await trelloFetch(`/boards/${creds.boardId}/cards`, creds, {
    fields: 'id,name,idList',
  });

  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parenSuffix = new RegExp(`\\(${escapeRe(id)}\\)\\s*$`);
  const parenAnywhere = new RegExp(`\\(${escapeRe(id)}\\)`);

  const asArr = cards as any[];
  let match = asArr.find(c => parenSuffix.test(c.name));
  if (match) return match;

  match = asArr.find(c => c.name.trim() === id);
  if (match) return match;

  const candidates = asArr.filter(c => parenAnywhere.test(c.name));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    return [...candidates].sort((a, b) => a.name.length - b.name.length)[0];
  }

  return null;
}

/**
 * High-level function to push an application result to Trello
 */
export async function pushApplicationStatus(
  discordUserId: string,
  username: string,
  status: 'Passed' | 'Failed' | 'Pending',
  score?: number,
  feedback?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const discordNorm = normalizeDiscordSnowflake(discordUserId) || String(discordUserId).trim();
    if (!discordNorm) {
      return { ok: false, error: 'Missing Discord user id for Trello sync' };
    }

    const creds = await getTrelloCredentials();
    const lists = await trelloFetch(`/boards/${creds.boardId}/lists`, creds, { fields: 'id,name' });
    
    const listArr = lists as { id: string; name: string }[];
    const pickList = (pred: (n: string) => boolean) =>
      listArr.find(l => pred(l.name.toLowerCase())) || null;

    let targetList: { id: string; name: string } | null = null;
    if (status === 'Passed') {
      targetList =
        pickList(n =>
          ['approved', 'accepted', 'passed', 'pass'].some(k => n.includes(k))
        ) || pickList(n => n.includes('won'));
    } else if (status === 'Failed') {
      targetList = pickList(n =>
        ['rejected', 'failed', 'denied', 'declined'].some(k => n.includes(k))
      );
    } else {
      targetList =
        pickList(n => ['pending', 'review', 'inbox', 'new'].some(k => n.includes(k)) || n.includes('to do')) ||
        pickList(n => n.includes('todo'));
    }

    if (!targetList) {
      targetList = listArr[0];
    }
    if (!targetList) {
      return { ok: false, error: 'Trello board has no lists' };
    }

    const cardName = `${username} (${discordNorm})`;
    const displayName = (username || '').trim() || discordNorm;

    let cardDesc = `**Discord name:** ${displayName}\n**Discord ID:** ${discordNorm}\n`;

    if (score !== undefined) {
      const passed = score >= APPLICATION_PASS_SCORE;
      cardDesc += `**Points:** ${score}/${APPLICATION_MAX_SCORE} — ${passed ? 'Passed' : 'Failed'} (${APPLICATION_PASS_SCORE}+ required)\n`;
    } else {
      cardDesc += `**Points:** — (not graded yet)\n`;
    }

    cardDesc += `**List / outcome:** ${status === 'Passed' ? 'Approved' : status === 'Failed' ? 'Rejected' : 'Pending review'}\n`;

    if (feedback && String(feedback).trim()) {
      cardDesc += `**Feedback:** ${String(feedback).trim()}\n`;
    }

    cardDesc += `\n_Updated ${new Date().toLocaleString()}_`;

    // Check if card exists
    const existingCard = await findTrelloCardByName(discordNorm);

    if (existingCard) {
      await moveCardToList(existingCard.id, targetList.id);

      const url = new URL(`${TRELLO_API_BASE}/cards/${existingCard.id}`);
      url.searchParams.set('key', creds.apiKey);
      url.searchParams.set('token', creds.apiToken);
      url.searchParams.set('desc', cardDesc);
      const putRes = await fetch(url.toString(), { method: 'PUT' });
      if (!putRes.ok) {
        const errorText = await putRes.text();
        return { ok: false, error: `Trello card update failed: ${errorText}` };
      }
    } else {
      await createTrelloCard(cardName, cardDesc, targetList.id);
    }

    return { ok: true };
  } catch (error: any) {
    console.error('[Trello Push Error]', error);
    return { ok: false, error: error?.message || String(error) };
  }
}

/**
  * Add a label to a card
 */
export async function addLabelToCard(cardId: string, labelId: string): Promise<void> {
  const creds = await getTrelloCredentials();

  const url = new URL(`${TRELLO_API_BASE}/cards/${cardId}/idLabels`);
  url.searchParams.set('key', creds.apiKey);
  url.searchParams.set('token', creds.apiToken);
  url.searchParams.set('value', labelId);

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to add label: ${errorText}`);
  }
}

/**
 * Get available labels on the board
 */
export async function getBoardLabels(): Promise<{ id: string; name: string; color: string }[]> {
  const creds = await getTrelloCredentials();
  const labels = await trelloFetch(`/boards/${creds.boardId}/labels`, creds);
  return (labels as any[]).map((l: any) => ({
    id: l.id,
    name: l.name || '',
    color: l.color || '',
  }));
}
