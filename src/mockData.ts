import { DriveFile } from './types';

// Let's list some very realistic game logos from popular providers (Pragmatic Play, PG Soft, etc.)
// These can represent the actual mock files, which match exactly with standard games in Brazilian casinos.
export const INITIAL_MOCK_LIST_CONTENT = `Provedor: Pragmatic Play
Gates of Olympus
Sweet Bonanza
Sugar Rush
Starlight Princess
Zeus vs Hades

Provedor: PG Soft
Fortune Tiger
Fortune Ox
Fortune Rabbit
Dragon Hatch
Midas Golden Touch

Provedor: Sem provedor
Spaceman
Aviator`;

export const MOCK_DRIVE_FILES: DriveFile[] = [
  {
    id: 'mock-gates-of-olympus',
    name: 'Gates of Olympus.webp',
    mimeType: 'image/webp',
    size: '124090',
    modifiedTime: '2026-05-31T14:20:00Z',
    providerName: 'Pragmatic Play'
  },
  {
    id: 'mock-sweet-bonanza',
    name: 'Sweet Bonanza.webp',
    mimeType: 'image/webp',
    size: '135921',
    modifiedTime: '2026-05-30T10:15:20Z',
    providerName: 'Pragmatic Play'
  },
  {
    id: 'mock-sugar-rush',
    name: 'Sugar Rush.webp',
    mimeType: 'image/webp',
    size: '95420',
    modifiedTime: '2026-05-28T16:05:10Z',
    providerName: 'Pragmatic Play'
  },
  {
    id: 'mock-starlight-princess',
    name: 'Starlight Princess.webp',
    mimeType: 'image/webp',
    size: '112500',
    modifiedTime: '2026-05-29T11:45:00Z',
    providerName: 'Pragmatic Play'
  },
  {
    id: 'mock-fortune-tiger',
    name: 'Fortune Tiger.webp',
    mimeType: 'image/webp',
    size: '89124',
    modifiedTime: '2026-05-27T08:30:19Z',
    providerName: 'PG Soft'
  },
  {
    id: 'mock-fortune-ox',
    name: 'Fortune Ox.webp',
    mimeType: 'image/webp',
    size: '79421',
    modifiedTime: '2026-05-26T09:12:00Z',
    providerName: 'PG Soft'
  },
  {
    id: 'mock-fortune-rabbit',
    name: 'Fortune Rabbit.webp',
    mimeType: 'image/webp',
    size: '82400',
    modifiedTime: '2026-05-25T13:40:40Z',
    providerName: 'PG Soft'
  },
  {
    id: 'mock-spaceman',
    name: 'Spaceman.webp',
    mimeType: 'image/webp',
    size: '105120',
    modifiedTime: '2026-05-24T15:20:11Z',
    providerName: 'Sem provedor'
  },
  {
    id: 'mock-aviator',
    name: 'Aviator.webp',
    mimeType: 'image/webp',
    size: '72590',
    modifiedTime: '2026-05-23T12:05:00Z',
    providerName: 'Sem provedor'
  }
];

// Provide gorgeous high-contrast gradient assets or matching URLs for placeholders
export const PROVIDER_GRADIENTS: Record<string, string> = {
  'pragmatic play': 'from-[#0a84ff]/30 via-transparent to-black/80',
  'pg soft': 'from-amber-500/30 via-transparent to-black/80',
  'sem provedor': 'from-purple-500/30 via-transparent to-black/80',
  'default': 'from-zinc-700/30 via-transparent to-black/80'
};

export const PROVIDER_BORDER_GLOWS: Record<string, string> = {
  'pragmatic play': 'rgba(10, 132, 255, 0.35)',
  'pg soft': 'rgba(245, 158, 11, 0.35)',
  'sem provedor': 'rgba(168, 85, 247, 0.35)',
  'default': 'rgba(255, 255, 255, 0.15)'
};

export const PROVIDER_BADGE_STYLE: Record<string, string> = {
  'pragmatic play': 'bg-[#0a84ff]/10 text-[#0a84ff] border-[#0a84ff]/20',
  'pg soft': 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  'sem provedor': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  'default': 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
};
