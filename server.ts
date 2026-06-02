import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- LOGIC FROM SCRIPTS ---

const DEFAULT_SOURCE = process.platform === 'win32' 
  ? 'G:\\Documentos\\Creative Cloud Files Personal Account andreluiz1902@gmail.com 14392106563A51EF7F000101@AdobeID\\Thumbs'
  : path.join(__dirname, 'mock_data', 'source');
const DEFAULT_DEST = process.platform === 'win32'
  ? 'H:\\Meu Drive\\Thumbs'
  : path.join(__dirname, 'mock_data', 'dest');
const DEFAULT_GAME_LIST = process.platform === 'win32'
  ? 'G:\\Documentos\\Creative Cloud Files Personal Account andreluiz1902@gmail.com 14392106563A51EF7F000101@AdobeID\\cassino\\lista.txt'
  : path.join(__dirname, 'mock_data', 'lista.txt');
const DEFAULT_PSD = process.platform === 'win32'
  ? DEFAULT_SOURCE
  : path.join(__dirname, 'mock_data', 'psds');

let appConfig = {
  source: DEFAULT_SOURCE,
  dest: DEFAULT_DEST,
  list: DEFAULT_GAME_LIST,
  simulateDates: true,
  simulateDateMinutesOffset: 1,
  psd: DEFAULT_PSD
};

const PENDING_LIST_EXPORT_FILE = 'lista-de-pendentes.txt';
const DEFAULT_BATCH_SIZE = 17;
const MAX_BATCH_SIZE = 1000;
const FILE_TIME_TOLERANCE_MS = 1000;
type CopyOrder = 'newest' | 'oldest';

// --- TIME LOGIC CONSTANTS ---
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 10;
const WORK_START_HOUR = 14;
const WORK_START_MINUTE = 0;
const WORK_END_HOUR = 17;
const WORK_END_MINUTE = 30;
const FIRST_COPY_RELEASE_MINUTES_AFTER_START = 10;
const STRETCH_VARIATION_OPTIONS_MS = [30 * 1000, 60 * 1000, 2 * 60 * 1000];

function sumDelays(delays: number[]) {
  return delays.reduce((total, delay) => total + delay, 0);
}

function floorToSecond(ms: number) {
  return Math.floor(ms / 1000) * 1000;
}

function buildWorkWindow(now = new Date(), settings: any = {}) {
  const startAt = new Date(now);
  startAt.setHours(settings.startHour ?? WORK_START_HOUR, settings.startMinute ?? WORK_START_MINUTE, 0, 0);

  const endAt = new Date(now);
  endAt.setHours(settings.endHour ?? WORK_END_HOUR, settings.endMinute ?? WORK_END_MINUTE, 0, 0);

  // Se já passou do fim do expediente de hoje, a janela é amanhã.
  if (now.getTime() > endAt.getTime()) {
      startAt.setDate(startAt.getDate() + 1);
      endAt.setDate(endAt.getDate() + 1);
  }

  // Se cruza a meia-noite
  if (startAt.getTime() > endAt.getTime()) {
      if (now.getTime() <= endAt.getTime()) {
          startAt.setDate(startAt.getDate() - 1);
      } else {
          endAt.setDate(endAt.getDate() + 1);
      }
  }

  const firstCopyReleaseAt = new Date(
    startAt.getTime() + FIRST_COPY_RELEASE_MINUTES_AFTER_START * 60 * 1000,
  );
  const fullWindowMs = endAt.getTime() - startAt.getTime();

  return {
    now,
    startAt,
    endAt,
    firstCopyReleaseAt,
    fullWindowMs,
  };
}

// Function to block flow until time window opens
async function waitForWindow(state: any, settings: any) {
    while (state && state.status === 'running') {
        const win = buildWorkWindow(new Date(), settings);
        const now = new Date();
        if (now.getTime() >= win.startAt.getTime() && now.getTime() <= win.endAt.getTime()) {
            state.waitingForWindow = false;
            return true;
        }
        
        state.waitingForWindow = true;
        state.nextCopyAt = win.startAt.getTime();
        await new Promise(r => setTimeout(r, 2000));
    }
    return false;
}

function buildStretchDelaySchedule(queueLength: number, firstCopyDelayMs: number, availableWindowMs: number) {
  if (queueLength <= 0) return [];
  if (queueLength === 1) return [firstCopyDelayMs];

  const intervalCount = queueLength - 1;
  const remainingWindowAfterFirstMs = Math.max(0, availableWindowMs - firstCopyDelayMs);
  const baseIntervalMs = remainingWindowAfterFirstMs / intervalCount;
  const minIntervalMs = Math.max(5 * 1000, Math.min(30 * 1000, baseIntervalMs * 0.25));
  const rawIntervals: number[] = [];

  for (let index = 0; index < intervalCount; index += 1) {
    const variationOptionMs = STRETCH_VARIATION_OPTIONS_MS[Math.floor(Math.random() * STRETCH_VARIATION_OPTIONS_MS.length)];
    const variationMs = Math.min(variationOptionMs, baseIntervalMs * 0.75);
    const direction = Math.random() < 0.5 ? -1 : 1;
    const rawIntervalMs = Math.max(minIntervalMs, baseIntervalMs + direction * variationMs);
    rawIntervals.push(rawIntervalMs);
  }

  const rawTotalMs = sumDelays(rawIntervals);
  const scale = rawTotalMs ? remainingWindowAfterFirstMs / rawTotalMs : 0;
  const delays = [firstCopyDelayMs];
  let usedWindowMs = 0;

  for (let index = 0; index < rawIntervals.length; index += 1) {
    if (index === rawIntervals.length - 1) {
      delays.push(Math.max(0, remainingWindowAfterFirstMs - usedWindowMs));
      continue;
    }
    const scaledIntervalMs = Math.max(0, floorToSecond(rawIntervals[index] * scale));
    delays.push(scaledIntervalMs);
    usedWindowMs += scaledIntervalMs;
  }
  return delays;
}

// Workflow state
let currentCopyState: any = null;
let watchInterval: NodeJS.Timeout | null = null;

function collectWebpFiles(rootDir: string) {
  const results: string[] = [];
  if (!fs.existsSync(rootDir)) return results;
  const stack = [rootDir];

  while (stack.length) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) { continue; }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.webp') {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function collectPsdFiles(rootDir: string) {
  const results: string[] = [];
  if (!fs.existsSync(rootDir)) return results;
  const stack = [rootDir];

  while (stack.length) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) { continue; }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.psd') {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function collectPsdCatalogData(psdDir: string, sourceDir: string, destDir: string, listPath: string) {
  const catalogMap = new Map<string, any>();

  // Helper helper to find or create entry
  const getOrCreateEntry = (providerName: string, gameName: string, displayNameDefault: string) => {
    const normProv = normalizeProviderName(providerName);
    const normGame = normalizeGameName(gameName);
    const key = `${normalizeGameName(normProv)}::${normGame}`;
    
    if (catalogMap.has(key)) {
      return catalogMap.get(key);
    }

    // See if any entry exists with the same game name under 'Sem provedor' to merge or match elegantly
    const noProvKey = `${normalizeGameName('Sem provedor')}::${normGame}`;
    if (catalogMap.has(noProvKey)) {
      // Move to correct provider if found
      const entry = catalogMap.get(noProvKey);
      catalogMap.delete(noProvKey);
      entry.providerName = normProv;
      catalogMap.set(key, entry);
      return entry;
    }

    // Otherwise create new
    const newEntry = {
      id: `${normProv}__${normGame}`,
      normalizedName: normGame,
      displayName: displayNameDefault,
      providerName: normProv,
      isListed: false,
      hasPsd: false,
      psdPath: '',
      psdSize: 0,
      psdModifiedAtMs: 0,
      hasSourceWebp: false,
      sourceWebpPath: '',
      hasDestWebp: false,
      destWebpPath: ''
    };
    catalogMap.set(key, newEntry);
    return newEntry;
  };

  // 1. Scan lista.txt to populate initial entries
  if (fs.existsSync(listPath)) {
    try {
      const content = fs.readFileSync(listPath, 'utf8');
      let currentProviderName = 'Sem provedor';
      content.split(/\r?\n/).forEach(line => {
        const displayName = cleanGameListLine(line);
        if (!displayName || displayName.startsWith('#') || displayName.includes('?')) return;

        const providerName = getProviderListName(displayName);
        if (providerName) {
          currentProviderName = normalizeProviderName(providerName);
          return;
        }

        if (isProviderListLine(displayName)) return;

        const normalized = normalizeGameName(displayName);
        if (!normalized) return;
        
        getOrCreateEntry(currentProviderName, normalized, displayName).isListed = true;
      });
    } catch (e) {
      console.error("Error reading list in PSD scan:", e);
    }
  }

  // 2. Scan PSD directory
  if (fs.existsSync(psdDir)) {
    const psdFiles = collectPsdFiles(psdDir);
    psdFiles.forEach(filePath => {
      const relativePath = path.relative(psdDir, filePath);
      const fileName = getFileNameFromRelativePath(relativePath);
      const providerName = getProviderNameFromRelativePath(relativePath);
      const gameName = path.parse(fileName).name;
      const stats = getFileStats(filePath);

      const entry = getOrCreateEntry(providerName, gameName, getDisplayNameFromFileName(fileName));
      entry.hasPsd = true;
      entry.psdPath = relativePath;
      if (stats) {
        entry.psdSize = stats.size;
        entry.psdModifiedAtMs = stats.mtimeMs;
      }
    });
  }

  // Also scan Source (Origem) directory for PSDs, as the user stores PSD files alongside WebPs in the Source directory
  if (fs.existsSync(sourceDir) && sourceDir !== psdDir) {
    const sourcePsdFiles = collectPsdFiles(sourceDir);
    sourcePsdFiles.forEach(filePath => {
      const relativePath = path.relative(sourceDir, filePath);
      const fileName = getFileNameFromRelativePath(relativePath);
      const providerName = getProviderNameFromRelativePath(relativePath);
      const gameName = path.parse(fileName).name;
      const stats = getFileStats(filePath);

      const entry = getOrCreateEntry(providerName, gameName, getDisplayNameFromFileName(fileName));
      entry.hasPsd = true;
      entry.psdPath = relativePath;
      if (stats) {
        entry.psdSize = stats.size;
        entry.psdModifiedAtMs = stats.mtimeMs;
      }
    });
  }

  // 3. Scan Source directory (WebPs)
  if (fs.existsSync(sourceDir)) {
    const sourceFiles = collectWebpFiles(sourceDir);
    sourceFiles.forEach(filePath => {
      const relativePath = path.relative(sourceDir, filePath);
      const fileName = getFileNameFromRelativePath(relativePath);
      const providerName = getProviderNameFromRelativePath(relativePath);
      const gameName = path.parse(fileName).name;

      const entry = getOrCreateEntry(providerName, gameName, getDisplayNameFromFileName(fileName));
      entry.hasSourceWebp = true;
      entry.sourceWebpPath = relativePath;
    });
  }

  // 4. Scan Dest directory (WebPs)
  if (fs.existsSync(destDir)) {
    const destFiles = collectWebpFiles(destDir);
    destFiles.forEach(filePath => {
      const relativePath = path.relative(destDir, filePath);
      const fileName = getFileNameFromRelativePath(relativePath);
      const providerName = getProviderNameFromRelativePath(relativePath);
      const gameName = path.parse(fileName).name;

      const entry = getOrCreateEntry(providerName, gameName, getDisplayNameFromFileName(fileName));
      entry.hasDestWebp = true;
      entry.destWebpPath = relativePath;
    });
  }

  // Compile calculations
  const items = Array.from(catalogMap.values());
  let totalPsds = 0;
  let totalWebps = 0;
  let psdsMatched = 0;
  let psdsMissingWebp = 0;
  let webpsMissingPsd = 0;
  let unlistedAssets = 0;

  items.forEach(item => {
    if (item.hasPsd) totalPsds++;
    if (item.hasSourceWebp || item.hasDestWebp) totalWebps++;

    if (item.hasPsd && (item.hasSourceWebp || item.hasDestWebp)) {
      psdsMatched++;
    } else if (item.hasPsd && !item.hasSourceWebp && !item.hasDestWebp) {
      psdsMissingWebp++;
    } else if (!item.hasPsd && (item.hasSourceWebp || item.hasDestWebp)) {
      webpsMissingPsd++;
    }

    if (!item.isListed && (item.hasPsd || item.hasSourceWebp || item.hasDestWebp)) {
      unlistedAssets++;
    }
  });

  return {
    totalPsds,
    totalWebps,
    psdsMatched,
    psdsMissingWebp,
    webpsMissingPsd,
    unlistedAssets,
    items
  };
}

// Ensure mock directories and static mockup lists exist for the browser preview
function ensureMockDirs() {
  const sourceDir = path.join(__dirname, 'mock_data', 'source');
  const destDir = path.join(__dirname, 'mock_data', 'dest');
  const listFile = path.join(__dirname, 'mock_data', 'lista.txt');

  if (!fs.existsSync(sourceDir)) fs.mkdirSync(sourceDir, { recursive: true });
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  if (!fs.existsSync(listFile)) {
    const initialContent = `Provedor: Pragmatic Play
Gates of Olympus
Sweet Bonanza
Sugar Rush
Starlight Princess

Provedor: PG Soft
Fortune Tiger
Fortune Ox
Fortune Rabbit
Dragon Hatch

Provedor: Sem provedor
Spaceman
Aviator`;
    fs.writeFileSync(listFile, initialContent, 'utf8');
  }

  // Generate some realistic mock images if directories are completely empty
  const mockWebps = [
    'Gates of Olympus.webp', 'Sweet Bonanza.webp', 'Sugar Rush.webp', 'Starlight Princess.webp',
    'Fortune Tiger.webp', 'Fortune Ox.webp', 'Fortune Rabbit.webp', 'Dragon Hatch.webp',
    'Spaceman.webp', 'Aviator.webp', 'Zeus vs Hades.webp', 'Midas Golden Touch.webp'
  ];

  const filesInSource = collectWebpFiles(sourceDir);
  if (filesInSource.length === 0) {
    // Write small blank wepb placeholders to source so there is always mock data during testing
    const placeholderBuffer = Buffer.from('RIFF_webp_placeholder_data');
    mockWebps.forEach((name, idx) => {
      let subDir = sourceDir;
      if (idx < 4) {
        subDir = path.join(sourceDir, 'Pragmatic Play');
      } else if (idx < 8) {
        subDir = path.join(sourceDir, 'PG Soft');
      }
      if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, name), placeholderBuffer);
      
      // Delay modified times so some look newer or missing
      const pastDate = new Date();
      pastDate.setMinutes(pastDate.getMinutes() - (idx * 15));
      fs.utimesSync(path.join(subDir, name), pastDate, pastDate);
    });
  }

  // Create mock PSD files
  const psdDir = path.join(__dirname, 'mock_data', 'psds');
  if (!fs.existsSync(psdDir)) fs.mkdirSync(psdDir, { recursive: true });

  const filesInPsd = collectPsdFiles(psdDir);
  if (filesInPsd.length === 0) {
    const placeholderBuffer = Buffer.from('RIFF_psd_placeholder_data');
    const mockPsds = [
      'Gates of Olympus.psd', 
      'Sweet Bonanza.psd', 
      'Fortune Tiger.psd', 
      'Zeus vs Hades.psd', 
      'Aviator.psd', 
      'Midas Golden Touch.psd',
      'Gates of Olympus 1000.psd', 
      'Ninja Raccoon.psd'
    ];
    mockPsds.forEach((name, idx) => {
      let subDir = psdDir;
      if (idx === 0 || idx === 1) {
        subDir = path.join(psdDir, 'Pragmatic Play');
      } else if (idx === 2) {
        subDir = path.join(psdDir, 'PG Soft');
      }
      if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, name), placeholderBuffer);
    });
  }
}

function getFileStats(filePath: string) {
  try { return fs.statSync(filePath); } catch (err) { return null; }
}

function analyzeFileSyncStatus(sourcePath: string, destPath: string) {
  const sourceStats = getFileStats(sourcePath);
  if (!sourceStats) return { isPending: false, reason: 'missing-source', sourceModifiedAtMs: 0 };

  const destStats = getFileStats(destPath);
  if (!destStats) return { isPending: true, reason: 'missing-dest', sourceModifiedAtMs: sourceStats.mtimeMs };

  const sourceIsNewer = sourceStats.mtimeMs - destStats.mtimeMs > FILE_TIME_TOLERANCE_MS;
  return { isPending: sourceIsNewer, reason: sourceIsNewer ? 'source-newer' : 'up-to-date', sourceModifiedAtMs: sourceStats.mtimeMs };
}

function normalizeGameName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\.webp$/i, '').replace(/:/g, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function cleanGameListLine(line: string) {
  return line.replace(/^\uFEFF/, '').replace(/^\s*(?:[-*•]\s+|\d+\s*[\).\]-]\s*)/, '').trim();
}

// Validates a line to check if it represents a provider section header
function isProviderLine(line: string) {
  return /^provedor\s*:/i.test(line);
}

function isProviderListLine(line: string) {
  return /^provedor\s*:/i.test(line);
}

function getProviderListName(line: string) {
  const match = line.match(/^provedor\s*:\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

function normalizeProviderName(providerName: string) {
  return providerName.replace(/\s+/g, ' ').trim() || 'Sem provedor';
}

function getProviderNameFromRelativePath(relativePath: string) {
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  return segments.length > 1 ? normalizeProviderName(segments[0]) : 'Sem provedor';
}

function getFileNameFromRelativePath(relativePath: string) {
  return relativePath.split(/[\\/]/).pop() || relativePath;
}

// Computes a structured string key pairing of provider + game name
function createProviderGameKey(providerName: string, normalizedGameName: string) {
  return `${normalizeGameName(providerName)}::${normalizedGameName}`;
}

function createProviderGameKeyFromRelativePath(relativePath: string) {
  const normalizedGameName = normalizeGameName(getFileNameFromRelativePath(relativePath));
  if (!normalizedGameName) return null;
  return createProviderGameKey(getProviderNameFromRelativePath(relativePath), normalizedGameName);
}

function groupGamesByProvider(games: any[]) {
  const groups: any[] = [];
  const groupsByProvider = new Map<string, any>();

  games.forEach((game) => {
    const providerName = normalizeProviderName(game.providerName || 'Sem provedor');
    const providerKey = normalizeGameName(providerName);
    let group = groupsByProvider.get(providerKey);

    if (!group) {
      group = { providerName, games: [] };
      groupsByProvider.set(providerKey, group);
      groups.push(group);
    }

    group.games.push(game);
  });

  return groups;
}

function getDisplayNameFromFileName(fileName: string) {
  const parsedName = path.parse(fileName).name;
  return parsedName.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || parsedName;
}

function collectDestinationRecords(destDir: string) {
  if (!fs.existsSync(destDir)) {
    return { status: 'missing', totalGames: 0, providers: [] };
  }

  const groupsByProvider = new Map<string, any>();
  let totalGames = 0;

  collectWebpFiles(destDir).forEach((filePath) => {
    const stats = getFileStats(filePath);
    if (!stats) return;

    const relativePath = path.relative(destDir, filePath);
    const fileName = getFileNameFromRelativePath(relativePath);
    const providerName = getProviderNameFromRelativePath(relativePath);
    const providerKey = normalizeGameName(providerName);
    const modifiedAtMs = stats.mtimeMs;
    const createdAtMs = stats.birthtimeMs;
    const sizeBytes = stats.size;
    const extension = path.extname(fileName).replace('.', '').toLowerCase() || 'webp';

    let group = groupsByProvider.get(providerKey);
    if (!group) {
      group = {
        providerName,
        providerKey,
        gameCount: 0,
        totalSizeBytes: 0,
        coverPath: filePath,
        latestModifiedAtMs: modifiedAtMs,
        oldestModifiedAtMs: modifiedAtMs,
        games: [],
      };
      groupsByProvider.set(providerKey, group);
    }

    const gameRecord = {
      providerName,
      providerKey,
      displayName: getDisplayNameFromFileName(fileName),
      fileName,
      relativePath,
      destPath: filePath,
      modifiedAtMs,
      createdAtMs,
      sizeBytes,
      extension,
    };

    group.games.push(gameRecord);
    group.gameCount += 1;
    group.totalSizeBytes += sizeBytes;
    totalGames += 1;

    if (modifiedAtMs > group.latestModifiedAtMs) {
      group.latestModifiedAtMs = modifiedAtMs;
      group.coverPath = filePath;
    }
    if (modifiedAtMs < group.oldestModifiedAtMs) {
      group.oldestModifiedAtMs = modifiedAtMs;
    }
  });

  const providers = Array.from(groupsByProvider.values())
    .map((group) => ({
      ...group,
      games: [...group.games].sort((a, b) => b.modifiedAtMs - a.modifiedAtMs),
    }))
    .sort((a, b) => a.providerName.localeCompare(b.providerName, 'pt-BR', { sensitivity: 'base' }));

  return { status: 'ok', totalGames, providers };
}

function collectComparisonData(sourceDir: string, destDir: string) {
  const sourceFiles = collectWebpFiles(sourceDir);
  const comparedFiles = sourceFiles.map((sourcePath) => {
    const relativePath = path.relative(sourceDir, sourcePath);
    const destPath = path.join(destDir, relativePath);
    const syncStatus = analyzeFileSyncStatus(sourcePath, destPath);
    return { sourcePath, relativePath, destPath, modifiedAtMs: syncStatus.sourceModifiedAtMs, syncStatus };
  });

  const pendingFiles = comparedFiles.filter(f => f.syncStatus.isPending).sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);
  return { comparedFiles, totalSourceFiles: sourceFiles.length, pendingFiles };
}

function getCopyOrder(settings: any = {}): CopyOrder {
  return settings.copyOrder === 'oldest' ? 'oldest' : 'newest';
}

function getFileModifiedAtMs(file: any) {
  return Number(file?.modifiedAtMs ?? file?.syncStatus?.sourceModifiedAtMs ?? 0) || 0;
}

function sortPendingFilesByOrder(files: any[] = [], settings: any = {}) {
  const copyOrder = getCopyOrder(settings);
  return [...files].sort((a, b) => {
    const diff = getFileModifiedAtMs(a) - getFileModifiedAtMs(b);
    return copyOrder === 'newest' ? -diff : diff;
  });
}

function normalizeCopyPathKey(filePath: string) {
  const resolvedPath = path.resolve(filePath);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

function getCopyQueueKey(file: any) {
  return normalizeCopyPathKey(file?.destPath || file?.relativePath || file?.sourcePath || '');
}

function dedupePendingFilesByDestination(files: any[] = []) {
  const seen = new Set<string>();
  const uniqueFiles: any[] = [];

  for (const file of files) {
    const key = getCopyQueueKey(file);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueFiles.push(file);
  }

  return uniqueFiles;
}

function buildCopyQueue(files: any[] = [], settings: any = {}) {
  return sortPendingFilesByOrder(dedupePendingFilesByDestination(files), settings);
}

function getBatchLimit(settings: any = {}) {
  const configuredLimit = Number(settings.sendLimit);
  const limit = Number.isFinite(configuredLimit) && configuredLimit > 0
    ? Math.floor(configuredLimit)
    : DEFAULT_BATCH_SIZE;

  return Math.min(limit, MAX_BATCH_SIZE);
}

function copyPendingFile(file: any) {
  const destFolder = path.dirname(file.destPath);
  if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });

  // Simulate creation/modification timestamps if enabled
  const simulate = appConfig.simulateDates ?? true;
  const offsetMinutes = appConfig.simulateDateMinutesOffset ?? 1;

  if (simulate) {
    // Exact moment of copy minus specified minutes offset (typically 1 minute)
    const targetTime = new Date(Date.now() - offsetMinutes * 60 * 1000);
    try {
      if (fs.existsSync(file.sourcePath)) {
        fs.utimesSync(file.sourcePath, targetTime, targetTime);
      }
    } catch (err) {
      console.warn(`Could not set source timestamp for ${file.sourcePath}:`, err);
    }

    fs.copyFileSync(file.sourcePath, file.destPath);

    try {
      fs.utimesSync(file.destPath, targetTime, targetTime);
    } catch (err) {
      console.warn(`Copied ${file.destPath}, but could not set simulated timestamps:`, err);
    }
  } else {
    fs.copyFileSync(file.sourcePath, file.destPath);

    const sourceStats = getFileStats(file.sourcePath);
    if (!sourceStats) return;

    try {
      fs.utimesSync(file.destPath, sourceStats.atime, sourceStats.mtime);
    } catch (err) {
      console.warn(`Copied ${file.destPath}, but could not preserve timestamps:`, err);
    }
  }
}

function getCopiedDisplayName(file: any) {
  const filePath = file?.relativePath || file?.destPath || file?.sourcePath || '';
  return path.basename(filePath, '.webp');
}

function recordCopiedFile(state: any, file: any, copiedAt = new Date()) {
  const name = getCopiedDisplayName(file);
  state.copiedNames.push(name);
  state.copiedLog.push({
    name,
    relativePath: file?.relativePath || '',
    copiedAt: copiedAt.toISOString(),
    copiedAtMs: copiedAt.getTime(),
  });
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '10mb' }));

  // Bootstrap mock files so that the browser-based environment is robust
  ensureMockDirs();

  const CUSTOM_LOGOS_FILE = path.join(process.cwd(), 'custom_logos.json');

  function getCustomLogos() {
    if (fs.existsSync(CUSTOM_LOGOS_FILE)) {
      try {
        return JSON.parse(fs.readFileSync(CUSTOM_LOGOS_FILE, 'utf8'));
      } catch (e) {
        console.error("Error reading custom_logos.json", e);
      }
    }
    return {};
  }

  function saveCustomLogos(logos: any) {
    try {
      fs.writeFileSync(CUSTOM_LOGOS_FILE, JSON.stringify(logos, null, 2), 'utf8');
    } catch (e) {
      console.error("Error writing custom_logos.json", e);
    }
  }

  // --- API ROUTES ---

  app.get("/api/custom-logos", (req, res) => {
    res.json(getCustomLogos());
  });

  app.post("/api/custom-logos", (req, res) => {
    const { providerKey, customCover, customBgGradient, customGlowColor, brandText, tagline } = req.body;
    if (!providerKey) {
      return res.status(400).json({ error: "providerKey is required" });
    }
    const logos = getCustomLogos();
    if (customCover === null || customCover === "") {
      delete logos[providerKey];
    } else {
      logos[providerKey] = {
        customCover,
        customBgGradient: customBgGradient || undefined,
        customGlowColor: customGlowColor || undefined,
        brandText: brandText || undefined,
        tagline: tagline || undefined,
      };
    }
    saveCustomLogos(logos);
    res.json({ status: "success", logos });
  });

  app.get("/api/config", (req, res) => {
    res.json({ 
      source: appConfig.source, 
      dest: appConfig.dest, 
      list: appConfig.list,
      simulateDates: appConfig.simulateDates ?? true,
      simulateDateMinutesOffset: appConfig.simulateDateMinutesOffset ?? 1,
      psd: appConfig.psd ?? DEFAULT_PSD
    });
  });

  app.post("/api/config", (req, res) => {
    const { source, dest, list, simulateDates, simulateDateMinutesOffset, psd } = req.body;
    if (source) appConfig.source = source;
    if (dest) appConfig.dest = dest;
    if (list) appConfig.list = list;
    if (simulateDates !== undefined) appConfig.simulateDates = !!simulateDates;
    if (simulateDateMinutesOffset !== undefined) appConfig.simulateDateMinutesOffset = Number(simulateDateMinutesOffset);
    if (psd) appConfig.psd = psd;
    res.json({ 
      source: appConfig.source, 
      dest: appConfig.dest, 
      list: appConfig.list,
      simulateDates: appConfig.simulateDates,
      simulateDateMinutesOffset: appConfig.simulateDateMinutesOffset,
      psd: appConfig.psd
    });
  });

  app.get("/api/analyze", (req, res) => {
    const source = (req.query.source as string) || appConfig.source;
    const dest = (req.query.dest as string) || appConfig.dest;
    const listPath = (req.query.list as string) || appConfig.list;

    const data = collectComparisonData(source, dest);
    const recordsData = collectDestinationRecords(dest);
    
    // Game List Logic
    let gameListData: any = { status: 'missing' };
    if (fs.existsSync(listPath)) {
      try {
        const content = fs.readFileSync(listPath, 'utf8');
        const listedGames: any[] = [];
        const createdGameNames = new Set(data.comparedFiles.map(f => normalizeGameName(getFileNameFromRelativePath(f.relativePath))));
        const createdProviderGameKeys = new Set(
          data.comparedFiles
            .map(f => createProviderGameKeyFromRelativePath(f.relativePath))
            .filter(Boolean)
        );
        const sentGameNames = new Set<string>();
        const sentProviderGameKeys = new Set<string>();
        let currentProviderName = 'Sem provedor';
        
        // Add existing in dest
        collectWebpFiles(dest).forEach(f => {
          const relativePath = path.relative(dest, f);
          const providerGameKey = createProviderGameKeyFromRelativePath(relativePath);
          if (providerGameKey) {
            createdProviderGameKeys.add(providerGameKey);
            sentProviderGameKeys.add(providerGameKey);
          }
          const normalizedGameName = normalizeGameName(getFileNameFromRelativePath(relativePath));
          createdGameNames.add(normalizedGameName);
          sentGameNames.add(normalizedGameName);
        });

        content.split(/\r?\n/).forEach(line => {
          const displayName = cleanGameListLine(line);
          if (!displayName || displayName.startsWith('#') || displayName.includes('?')) return;

          const providerName = getProviderListName(displayName);
          if (providerName) {
            currentProviderName = normalizeProviderName(providerName);
            return;
          }

          if (isProviderListLine(displayName)) return;

          const normalized = normalizeGameName(displayName);
          if (!normalized) return;
          listedGames.push({ displayName, normalized, providerName: currentProviderName });
        });

        const isGameCreated = (game: any) => {
          const providerKey = normalizeGameName(game.providerName || 'Sem provedor');
          const gameKey = createProviderGameKey(game.providerName || 'Sem provedor', game.normalized);

          if (providerKey === normalizeGameName('Sem provedor')) {
            return createdProviderGameKeys.has(gameKey) || createdGameNames.has(game.normalized);
          }

          return createdProviderGameKeys.has(gameKey);
        };

        const isGameSent = (game: any) => {
          const providerKey = normalizeGameName(game.providerName || 'Sem provedor');
          const gameKey = createProviderGameKey(game.providerName || 'Sem provedor', game.normalized);

          if (providerKey === normalizeGameName('Sem provedor')) {
            return sentProviderGameKeys.has(gameKey) || sentGameNames.has(game.normalized);
          }

          return sentProviderGameKeys.has(gameKey);
        };

        const remaining = listedGames.filter(g => !isGameCreated(g));
        const readyGames = listedGames.filter(g => isGameCreated(g));
        const sentGames = listedGames.filter(g => isGameSent(g));
        gameListData = {
          status: 'ok',
          totalListedGames: listedGames.length,
          completedGames: readyGames.length,
          sentGamesCount: sentGames.length,
          sentGames,
          sentGamesByProvider: groupGamesByProvider(sentGames),
          remainingGames: remaining,
          remainingGamesByProvider: groupGamesByProvider(remaining),
          readyGames: readyGames,
          readyGamesByProvider: groupGamesByProvider(readyGames)
        };
      } catch (err) {
        gameListData = { status: 'error', message: (err as Error).message };
      }
    }

    const psdData = collectPsdCatalogData(
      appConfig.psd ?? DEFAULT_PSD,
      source,
      dest,
      listPath
    );

    res.json({ ...data, gameListData, recordsData, psdData });
  });

  app.post("/api/copy/start", (req, res) => {
    const { files, settings } = req.body;
    const queuedFiles = buildCopyQueue(Array.isArray(files) ? files : [], settings).slice(0, getBatchLimit(settings));
    if (currentCopyState && currentCopyState.status === 'running') {
      return res.status(400).json({ error: "A copy process is already running." });
    }

    currentCopyState = {
      mode: 'scheduled',
      status: 'running',
      progress: 0,
      total: queuedFiles.length,
      copied: 0,
      skipped: 0,
      failed: 0,
      copiedNames: [],
      copiedLog: [],
      startTime: new Date(),
      nextCopyAt: 0,
      currentFileWaiting: null
    };

    (async () => {
      // First, block if outside the work window
      if (!await waitForWindow(currentCopyState, settings)) return;

      const windowInfo = buildWorkWindow(new Date(), settings);
      const availableWindowMs = windowInfo.endAt.getTime() - windowInfo.now.getTime();
      const firstCopyDelayMs = Math.max(0, windowInfo.firstCopyReleaseAt.getTime() - windowInfo.now.getTime());
      
      console.log(`[Lote] Calculando schedule para ${availableWindowMs} ms disponíveis.`);
      const delays = buildStretchDelaySchedule(queuedFiles.length, firstCopyDelayMs, availableWindowMs);
      
      for (let i = 0; i < queuedFiles.length; i++) {
        if (!currentCopyState || currentCopyState.status !== 'running') break;
        
        // Re-check window just in case (though it should be mostly inside if calculated right)
        if (!await waitForWindow(currentCopyState, settings)) return;

        const file = queuedFiles[i];
        const delay = delays[i] || 0;
        
        currentCopyState.nextCopyAt = Date.now() + delay;
        currentCopyState.currentFileWaiting = file.relativePath.split('/').pop();
        
        if (delay > 0) {
            const step = 2000;
            for(let waited = 0; waited < delay; waited += step) {
                if (!currentCopyState || currentCopyState.status !== 'running') return;
                await new Promise(r => setTimeout(r, Math.min(step, delay - waited)));
            }
        }

        try {
          copyPendingFile(file);
          currentCopyState.copied++;
          recordCopiedFile(currentCopyState, file);
        } catch (err) {
          currentCopyState.failed++;
        }
        currentCopyState.progress = Math.round(((currentCopyState.copied + currentCopyState.failed + currentCopyState.skipped) / currentCopyState.total) * 100);
      }
      if (currentCopyState) {
        currentCopyState.status = 'finished';
        currentCopyState.nextCopyAt = 0;
        currentCopyState.currentFileWaiting = null;
      }
    })();

    res.json({ status: "started" });
  });

  app.post("/api/copy/sync-immediate", (req, res) => {
    const { files, settings } = req.body;
    const queuedFiles = buildCopyQueue(Array.isArray(files) ? files : [], settings);
    if (currentCopyState && currentCopyState.status === 'running') {
      return res.status(400).json({ error: "A copy process is already running." });
    }

    currentCopyState = {
      mode: 'immediate',
      status: 'running',
      progress: 0,
      total: queuedFiles.length,
      copied: 0,
      skipped: 0,
      failed: 0,
      copiedNames: [],
      copiedLog: [],
      startTime: new Date(),
      nextCopyAt: 0,
      currentFileWaiting: null
    };

    (async () => {
      for (let i = 0; i < queuedFiles.length; i++) {
        if (!currentCopyState || currentCopyState.status !== 'running') break;

        // Block if outside window! (The user wants this to be strictly respected too)
        if (!await waitForWindow(currentCopyState, settings)) return;

        const file = queuedFiles[i];
        try {
          copyPendingFile(file);
          currentCopyState.copied++;
          recordCopiedFile(currentCopyState, file);
        } catch (err) {
          currentCopyState.failed++;
        }
        currentCopyState.progress = Math.round(((currentCopyState.copied + currentCopyState.failed + currentCopyState.skipped) / currentCopyState.total) * 100);
      }
      if (currentCopyState) {
        currentCopyState.status = 'finished';
      }
    })();

    res.json({ status: "started" });
  });

  app.post("/api/copy/watch-start", (req, res) => {
    const source = (req.body.source as string) || appConfig.source;
    const dest = (req.body.dest as string) || appConfig.dest;
    const settings = req.body.settings || {};
    
    if (currentCopyState && currentCopyState.status === 'running') {
      return res.status(400).json({ error: "A copy process is already running." });
    }

    if (watchInterval) clearInterval(watchInterval);

    currentCopyState = {
      mode: 'watch',
      status: 'running',
      progress: 100,
      total: 0,
      copied: 0,
      skipped: 0,
      failed: 0,
      copiedNames: [],
      copiedLog: [],
      startTime: new Date(),
      nextCopyAt: 0,
      currentFileWaiting: null,
      watchBatchEnabled: !!settings.watchBatchEnabled,
      watchBatchLimit: Number(settings.watchBatchLimit) || 0
    };

    // Run dynamic time-splitting watch mode as an active loop
    (async () => {
      let lastQueueSignature = "";

      while (currentCopyState && currentCopyState.status === 'running' && currentCopyState.mode === 'watch') {
        try {
          const win = buildWorkWindow(new Date(), settings);
          const now = new Date();
          
          // Check if outside of-office hours
          if (now.getTime() < win.startAt.getTime() || now.getTime() > win.endAt.getTime()) {
            currentCopyState.waitingForWindow = true;
            currentCopyState.nextCopyAt = win.startAt.getTime();
            currentCopyState.currentFileWaiting = null;
            
            // Sleep for 5 seconds and poll again
            await new Promise(r => setTimeout(r, 5000));
            continue;
          }

          currentCopyState.waitingForWindow = false;

          // Scan directories
          const data = collectComparisonData(source, dest);
          let pendingFiles = buildCopyQueue(data.pendingFiles, settings);

          if (settings.watchBatchEnabled && typeof settings.watchBatchLimit === 'number' && settings.watchBatchLimit > 0) {
            pendingFiles = pendingFiles.slice(0, settings.watchBatchLimit);
          }

          if (pendingFiles.length === 0) {
            currentCopyState.currentFileWaiting = null;
            currentCopyState.nextCopyAt = 0;
            currentCopyState.total = 0;
            currentCopyState.progress = 100;
            lastQueueSignature = "";

            // Sleep for 5 seconds and check again
            await new Promise(r => setTimeout(r, 5000));
            continue;
          }

          // Generate unique queue signature (combining paths and modification times) to detect updates/additions
          const currentSignature = pendingFiles.map(f => `${getCopyQueueKey(f)}:${getFileModifiedAtMs(f)}`).join('|');

          // If signature changed OR we don't have a scheduled copy time yet, recalculate division of time
          if (currentSignature !== lastQueueSignature || currentCopyState.nextCopyAt === 0) {
            lastQueueSignature = currentSignature;

            const nowMs = Date.now();
            const availableWindowMs = Math.max(0, win.endAt.getTime() - nowMs);
            
            let firstCopyDelayMs = 0;
            if (nowMs < win.firstCopyReleaseAt.getTime()) {
              firstCopyDelayMs = Math.max(0, win.firstCopyReleaseAt.getTime() - nowMs);
            } else {
              // Recalculate time spacing to stretch files across remaining window
              firstCopyDelayMs = Math.max(0, Math.floor(availableWindowMs / pendingFiles.length));
              
              // Cap interval to a maximum of MAX_INTERVAL_MINUTES (10 mins) for small queues to ensure usability
              const maxIntervalMs = MAX_INTERVAL_MINUTES * 60 * 1000;
              if (firstCopyDelayMs > maxIntervalMs) {
                firstCopyDelayMs = maxIntervalMs;
              }
            }

            const delays = buildStretchDelaySchedule(pendingFiles.length, firstCopyDelayMs, availableWindowMs);
            const delay = delays[0] || 0;

            currentCopyState.nextCopyAt = nowMs + delay;
            currentCopyState.total = pendingFiles.length;
            
            const nextFile = pendingFiles[0];
            currentCopyState.currentFileWaiting = nextFile.relativePath.split(/[\\/]/).pop();
            
            // Calculate progress
            const remainingCount = pendingFiles.length;
            const totalCount = currentCopyState.copied + currentCopyState.failed + currentCopyState.skipped + remainingCount;
            currentCopyState.progress = totalCount > 0 ? Math.round(((currentCopyState.copied + currentCopyState.failed + currentCopyState.skipped) / totalCount) * 100) : 100;
          }

          // Check if it's copy time
          const nowMs = Date.now();
          if (nowMs >= currentCopyState.nextCopyAt) {
            const fileToCopy = pendingFiles[0];
            try {
              copyPendingFile(fileToCopy);
              currentCopyState.copied++;
              recordCopiedFile(currentCopyState, fileToCopy);
            } catch (err) {
              currentCopyState.failed++;
              console.error(`Error copying file ${fileToCopy.relativePath} in standby watch:`, err);
            }

            // Mark completed so the next tick immediately triggers a fresh scan and schedule rebuild
            currentCopyState.nextCopyAt = 0;
            
            // Recalculate progress for the next tick
            const remainingCount = pendingFiles.length - 1;
            const totalCount = currentCopyState.copied + currentCopyState.failed + currentCopyState.skipped + remainingCount;
            currentCopyState.progress = totalCount > 0 ? Math.round(((currentCopyState.copied + currentCopyState.failed + currentCopyState.skipped) / totalCount) * 100) : 100;
          }

          // Tick sleep (2 seconds) to keep scanning responsive and react quickly to additions
          await new Promise(r => setTimeout(r, 2000));

        } catch (error) {
          console.error("Error in standby watch loop:", error);
          await new Promise(r => setTimeout(r, 5000));
        }
      }
    })();

    res.json({ status: "started" });
  });

  app.get("/api/copy/status", (req, res) => {
    res.json(currentCopyState || { status: 'idle' });
  });

  app.post("/api/copy/stop", (req, res) => {
    if (currentCopyState) {
        currentCopyState.status = 'stopped';
    }
    if (watchInterval) {
        clearInterval(watchInterval);
        watchInterval = null;
    }
    currentCopyState = null;
    res.json({ status: "stopped" });
  });

  app.post("/api/copy/finalize", (req, res) => {
    if (currentCopyState) {
        currentCopyState.status = 'finished';
        currentCopyState.progress = 100;
        currentCopyState.nextCopyAt = 0;
        currentCopyState.currentFileWaiting = null;
    }
    if (watchInterval) {
        clearInterval(watchInterval);
        watchInterval = null;
    }
    res.json(currentCopyState || { status: 'idle' });
  });

  // Helper structures and algorithms for collision-free Three-way List merges (Multi-device offline safe)
  interface GameEntry {
    displayName: string;
    normalized: string;
  }

  interface ProviderBlock {
    providerName: string;
    games: GameEntry[];
  }

  function parseListToBlocks(content: string): ProviderBlock[] {
    const blocks: ProviderBlock[] = [];
    let currentProvider = "Sem provedor";
    let currentGames: GameEntry[] = [];

    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const cleanLine = line.replace(/^\uFEFF/, '').trim();
      if (!cleanLine || cleanLine.startsWith('#') || cleanLine.includes('?')) {
        continue;
      }

      const match = cleanLine.match(/^provedor\s*:\s*(.+)$/i);
      if (match) {
        if (currentGames.length > 0 || currentProvider !== "Sem provedor") {
          blocks.push({ providerName: currentProvider, games: currentGames });
        }
        currentProvider = match[1].trim() || "Sem provedor";
        currentGames = [];
        continue;
      }

      if (/^provedor\s*:/i.test(cleanLine)) {
        continue;
      }

      const normalized = cleanLine.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\.webp$/i, '')
        .replace(/:/g, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

      if (normalized) {
        currentGames.push({ displayName: cleanLine, normalized });
      }
    }

    if (currentGames.length > 0 || currentProvider !== "Sem provedor") {
      blocks.push({ providerName: currentProvider, games: currentGames });
    }

    return blocks;
  }

  function blocksToString(blocks: ProviderBlock[]): string {
    const lines: string[] = [];
    blocks.forEach((block, idx) => {
      if (block.games.length === 0 && block.providerName === "Sem provedor") {
        return; 
      }
      if (idx > 0) {
        lines.push("");
      }
      lines.push(`Provedor: ${block.providerName}`);
      block.games.forEach(g => {
        lines.push(g.displayName);
      });
    });
    return lines.join("\n");
  }

  function mergeThreeWay(baseContent: string, clientContent: string, serverContent: string): string {
    const baseBlocks = parseListToBlocks(baseContent);
    const clientBlocks = parseListToBlocks(clientContent);
    const serverBlocks = parseListToBlocks(serverContent);

    const providerNames = new Map<string, string>();
    const registerProviderName = (name: string) => {
      const key = name.toLowerCase().trim();
      if (!providerNames.has(key)) {
        providerNames.set(key, name);
      }
    };

    baseBlocks.forEach(b => registerProviderName(b.providerName));
    clientBlocks.forEach(b => registerProviderName(b.providerName));
    serverBlocks.forEach(b => registerProviderName(b.providerName));

    const gameDisplayNames = new Map<string, string>();
    const registerGameDisplayName = (provKey: string, normGame: string, dispName: string) => {
      const key = `${provKey}::${normGame}`;
      if (!gameDisplayNames.has(key)) {
        gameDisplayNames.set(key, dispName);
      }
    };

    baseBlocks.forEach(b => b.games.forEach(g => registerGameDisplayName(b.providerName.toLowerCase().trim(), g.normalized, g.displayName)));
    clientBlocks.forEach(b => b.games.forEach(g => registerGameDisplayName(b.providerName.toLowerCase().trim(), g.normalized, g.displayName)));
    serverBlocks.forEach(b => b.games.forEach(g => registerGameDisplayName(b.providerName.toLowerCase().trim(), g.normalized, g.displayName)));

    const baseKeys = new Set<string>();
    baseBlocks.forEach(b => {
      const pk = b.providerName.toLowerCase().trim();
      b.games.forEach(g => baseKeys.add(`${pk}::${g.normalized}`));
    });

    const clientKeys = new Set<string>();
    clientBlocks.forEach(b => {
      const pk = b.providerName.toLowerCase().trim();
      b.games.forEach(g => clientKeys.add(`${pk}::${g.normalized}`));
    });

    const serverKeys = new Set<string>();
    serverBlocks.forEach(b => {
      const pk = b.providerName.toLowerCase().trim();
      b.games.forEach(g => serverKeys.add(`${pk}::${g.normalized}`));
    });

    const clientAdded = new Set<string>();
    clientKeys.forEach(key => {
      if (!baseKeys.has(key)) {
        clientAdded.add(key);
      }
    });

    const clientDeleted = new Set<string>();
    baseKeys.forEach(key => {
      if (!clientKeys.has(key)) {
        clientDeleted.add(key);
      }
    });

    const finalKeys = new Set<string>(serverKeys);

    clientAdded.forEach(key => {
      finalKeys.add(key);
    });

    clientDeleted.forEach(key => {
      finalKeys.delete(key);
    });

    const providerGroups = new Map<string, Set<string>>();
    finalKeys.forEach(compositeKey => {
      const parts = compositeKey.split("::");
      const provKey = parts[0];
      const gameNorm = parts[1];
      
      let group = providerGroups.get(provKey);
      if (!group) {
        group = new Set<string>();
        providerGroups.set(provKey, group);
      }
      group.add(gameNorm);
    });

    const finalBlocks: ProviderBlock[] = [];

    const allProvKeys = Array.from(providerGroups.keys()).sort((a, b) => {
      if (a === "sem provedor") return 1;
      if (b === "sem provedor") return -1;
      return a.localeCompare(b);
    });

    allProvKeys.forEach(provKey => {
      const actualProvName = providerNames.get(provKey) || provKey;
      const gameNorms = providerGroups.get(provKey)!;
      const gamesList: GameEntry[] = [];
      
      const sortedGameNorms = Array.from(gameNorms).sort((ga, gb) => {
        const nameA = gameDisplayNames.get(`${provKey}::${ga}`) || ga;
        const nameB = gameDisplayNames.get(`${provKey}::${gb}`) || gb;
        return nameA.localeCompare(nameB, 'pt-BR');
      });

      sortedGameNorms.forEach(gn => {
        const disp = gameDisplayNames.get(`${provKey}::${gn}`) || gn;
        gamesList.push({ displayName: disp, normalized: gn });
      });

      finalBlocks.push({ providerName: actualProvName, games: gamesList });
    });

    return blocksToString(finalBlocks);
  }

  app.get("/api/list/content", (req, res) => {
    const listPath = (req.query.list as string) || appConfig.list;
    if (!fs.existsSync(listPath)) {
        return res.json({ content: '' });
    }
    try {
        const content = fs.readFileSync(listPath, 'utf8');
        res.json({ content });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/list/content", (req, res) => {
    const listPath = (req.query.list as string) || appConfig.list;
    const { content, base } = req.body;
    try {
        const destFolder = path.dirname(listPath);
        if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });

        let finalContent = content;
        if (typeof base === "string") {
          let serverContent = "";
          if (fs.existsSync(listPath)) {
            serverContent = fs.readFileSync(listPath, "utf8");
          }
          finalContent = mergeThreeWay(base, content, serverContent);
        }

        fs.writeFileSync(listPath, finalContent, "utf8");
        res.json({ status: "success", mergedContent: finalContent });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/image", (req, res) => {
    const imagePath = req.query.path as string;
    if (!imagePath || !fs.existsSync(imagePath)) {
      return res.status(404).send("Not found");
    }
    try {
      const ext = path.extname(imagePath).toLowerCase();
      let contentType = 'image/jpeg';
      if (ext === '.webp') contentType = 'image/webp';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.svg') contentType = 'image/svg+xml';
      
      res.setHeader('Content-Type', contentType);
      const fileStream = fs.createReadStream(imagePath);
      fileStream.pipe(res);
    } catch (err) {
      console.error("Error sending file:", err);
      res.status(500).send("Error reading file");
    }
  });

  // Interceptadores de cabecalhos MIME para PWA instalável
  app.get('/manifest.webmanifest', (req, res, next) => {
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    next();
  });

  app.get('/sw.js', (req, res, next) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    next();
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
