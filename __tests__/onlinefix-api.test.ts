import { describe, expect, it } from 'vitest';

const {
  searchOnlineFixGames,
  clearOnlineFixListCache,
} = require('../scripts/lib/onlinefix-api');

describe('onlinefix-api helpers', () => {
  it('filters indexed games from a list payload', () => {
    clearOnlineFixListCache();
    const games = [
      { name: 'Palworld Online Fix', fileName: 'Palworld_Fix.rar', fileSize: '120 MB', searches: 10 },
      { name: 'Skyrim Special Edition Fix', fileName: 'Skyrim_Fix.rar', fileSize: '80 MB', searches: 3 },
    ];

    const results = searchOnlineFixGames(games, 'palworld', {
      limit: 5,
      orderBySearch: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Palworld Online Fix');
  });
});
