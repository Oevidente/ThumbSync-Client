import { useEffect, useState } from 'react';

// --- TYPINGS ---
export interface OfflineGame {
  displayName: string;
  normalized: string;
  providerName: string;
}

export interface OfflineProviderGroup {
  providerName: string;
  games: OfflineGame[];
}

export interface ClientGameListData {
  status: string;
  totalListedGames: number;
  completedGames: number;
  sentGamesCount: number;
  sentGames: OfflineGame[];
  sentGamesByProvider: OfflineProviderGroup[];
  remainingGames: OfflineGame[];
  remainingGamesByProvider: OfflineProviderGroup[];
  readyGames: OfflineGame[];
  readyGamesByProvider: OfflineProviderGroup[];
}

// --- LOGICAL REPLICATION FROM THE SERVER ---

export function normalizeGameName(value = ''): string {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.webp$/i, '')
    .replace(/:/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function getFileNameFromPath(value = ''): string {
  return String(value).split(/[\\/]/).pop() || value;
}

export function createProviderGameKey(providerName: string, normalizedGameName: string): string {
  return `${normalizeGameName(providerName || 'Sem provedor')}::${normalizedGameName}`;
}

export function getProviderNameFromRelativePath(relativePath: string): string {
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  return segments.length > 1 ? segments[0].trim() : 'Sem provedor';
}

function groupGamesByProvider(games: OfflineGame[]): OfflineProviderGroup[] {
  const groups: OfflineProviderGroup[] = [];
  const groupsByProvider = new Map<string, OfflineProviderGroup>();

  games.forEach((game) => {
    const providerName = game.providerName || 'Sem provedor';
    const providerKey = normalizeGameName(providerName);
    let group = groupsByProvider.get(providerKey);

    if (!group) {
      group = { providerName, games: [] };
      groupsByProvider.set(providerKey, group);
      groups.push(group);
    }

    group.games.push(game);
  });

  return groups.sort((a, b) =>
    a.providerName.localeCompare(b.providerName, 'pt-BR', { sensitivity: 'base' })
  );
}

/**
 * Parses the raw list text file content client-side to dynamically recalculate game states (Ready / Pending)
 * based on last known source/destination file indices.
 */
export function parseListContentClient(
  content: string,
  comparedFiles: any[] = [],
  recordsData: any = {}
): ClientGameListData {
  const listedGames: OfflineGame[] = [];
  const createdGameNames = new Set<string>();
  const createdProviderGameKeys = new Set<string>();
  const sentGameNames = new Set<string>();
  const sentProviderGameKeys = new Set<string>();

  // 1. Populate indexing sets using comparedFiles (source/destination states)
  if (Array.isArray(comparedFiles)) {
    comparedFiles.forEach((file: any) => {
      const relPath = file.relativePath || '';
      const filename = getFileNameFromPath(relPath);
      const normGame = normalizeGameName(filename);
      createdGameNames.add(normGame);

      const providerName = getProviderNameFromRelativePath(relPath);
      const provKey = createProviderGameKey(providerName, normGame);
      createdProviderGameKeys.add(provKey);

      // Track if already sent
      if (file.syncStatus?.isPending === false) {
        sentGameNames.add(normGame);
        sentProviderGameKeys.add(provKey);
      }
    });
  }

  // 2. Populate using recordsData (existing in destination)
  const destProviders = recordsData?.providers || [];
  destProviders.forEach((provider: any) => {
    const providerName = provider?.providerName || 'Sem provedor';
    provider?.games?.forEach((game: any) => {
      const fileName = game?.fileName || getFileNameFromPath(game?.relativePath || game?.destPath || game?.displayName);
      const normGame = normalizeGameName(fileName || game?.displayName);
      if (!normGame) return;

      createdGameNames.add(normGame);
      sentGameNames.add(normGame);

      const gameProv = game?.providerName || providerName;
      const provKey = createProviderGameKey(gameProv, normGame);
      createdProviderGameKeys.add(provKey);
      sentProviderGameKeys.add(provKey);
    });
  });

  // 3. Process each line of list.txt
  let currentProviderName = 'Sem provedor';
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const displayName = line.replace(/^\uFEFF/, '').replace(/^\s*(?:[-*•]\s+|\d+\s*[\).\]-]\s*)/, '').trim();
    if (!displayName || displayName.startsWith('#') || displayName.includes('?')) {
      continue;
    }

    // Provider Header detection
    const match = displayName.match(/^provedor\s*:\s*(.+)$/i);
    if (match) {
      currentProviderName = match[1].trim() || 'Sem provedor';
      continue;
    }

    if (/^provedor\s*:/i.test(displayName)) {
      continue;
    }

    const normalized = normalizeGameName(displayName);
    if (!normalized) continue;

    listedGames.push({
      displayName,
      normalized,
      providerName: currentProviderName,
    });
  }

  // 4. Compute status filters
  const isGameCreated = (game: OfflineGame) => {
    const providerKey = normalizeGameName(game.providerName);
    const gameKey = createProviderGameKey(game.providerName, game.normalized);

    if (providerKey === normalizeGameName('Sem provedor')) {
      return createdProviderGameKeys.has(gameKey) || createdGameNames.has(game.normalized);
    }
    return createdProviderGameKeys.has(gameKey);
  };

  const isGameSent = (game: OfflineGame) => {
    const providerKey = normalizeGameName(game.providerName);
    const gameKey = createProviderGameKey(game.providerName, game.normalized);

    if (providerKey === normalizeGameName('Sem provedor')) {
      return sentProviderGameKeys.has(gameKey) || sentGameNames.has(game.normalized);
    }
    return sentProviderGameKeys.has(gameKey);
  };

  const remainingGames = listedGames.filter((g) => !isGameCreated(g));
  const readyGames = listedGames.filter((g) => isGameCreated(g));
  const sentGames = listedGames.filter((g) => isGameSent(g));

  return {
    status: 'ok',
    totalListedGames: listedGames.length,
    completedGames: readyGames.length,
    sentGamesCount: sentGames.length,
    sentGames,
    sentGamesByProvider: groupGamesByProvider(sentGames),
    remainingGames,
    remainingGamesByProvider: groupGamesByProvider(remainingGames),
    readyGames,
    readyGamesByProvider: groupGamesByProvider(readyGames),
  };
}

// --- LOCAL PERSISTENCE LAYER CONTROLLER ---

const CACHE_ANALYSIS_KEY = 'thumbsync_last_analysis_data';
const CACHE_LIST_KEY = 'thumbsync_offline_list_content';
const PENDING_SYNC_KEY = 'thumbsync_has_pending_changes';
const SERVER_STABLE_CONTENT_KEY = 'thumbsync_list_server_stable';

export function getCachedAnalysisData() {
  try {
    const stored = localStorage.getItem(CACHE_ANALYSIS_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (e) {
    console.error('Failed to parse cached analysis data:', e);
    return null;
  }
}

export function saveCachedAnalysisData(data: any) {
  if (!data) return;
  try {
    localStorage.setItem(CACHE_ANALYSIS_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to set cache analysis data:', e);
  }
}

export function getCachedListContent(): string {
  return localStorage.getItem(CACHE_LIST_KEY) || localStorage.getItem(SERVER_STABLE_CONTENT_KEY) || '';
}

export function saveLocalListContent(content: string, markPending = true) {
  localStorage.setItem(CACHE_LIST_KEY, content);
  if (markPending) {
    localStorage.setItem(PENDING_SYNC_KEY, 'true');
  }
}

export function getPendingChangesFlag(): boolean {
  return localStorage.getItem(PENDING_SYNC_KEY) === 'true';
}

export function clearPendingChangesFlag(stableServerContent?: string) {
  localStorage.setItem(PENDING_SYNC_KEY, 'false');
  if (stableServerContent !== undefined) {
    localStorage.setItem(SERVER_STABLE_CONTENT_KEY, stableServerContent);
    localStorage.setItem(CACHE_LIST_KEY, stableServerContent); // align
  }
}

export function saveServerStableContent(content: string) {
  localStorage.setItem(SERVER_STABLE_CONTENT_KEY, content);
  // If we don't have pending changes, align the active client list with the server list
  if (!getPendingChangesFlag()) {
    localStorage.setItem(CACHE_LIST_KEY, content);
  }
}
