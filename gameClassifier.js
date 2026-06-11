export let exactMappingsCache = null;

export async function loadMappings() {
  if (exactMappingsCache) return;
  exactMappingsCache = {};
  
  try {
    const res = await fetch('./data.csv');
    if (!res.ok) return;
    const csvData = await res.text();
    const lines = csvData.split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) { // pula o cabeçalho
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(';');
      if (parts.length >= 3) {
        const cleanName = parts[0].trim().replace(/^["']|["']$/g, '');
        const provider = parts[1].trim();
        const category = parts[2].trim();
        const key = `${normalize(provider)}::${normalize(cleanName)}`;
        exactMappingsCache[key] = category;
      }
    }
  } catch (e) {
    console.error("Erro ao carregar data.csv", e);
  }
}

function normalize(val) {
    return String(val)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/:/g, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
}

/**
 * Classifica automaticamente um jogo com base no nome e provedor.
 */
export function classifyGame(game) {
  const name = game.name;
  const provider = game.provider;

  if (exactMappingsCache) {
    const keyMatch = `${normalize(provider)}::${normalize(name)}`;
    if (exactMappingsCache[keyMatch]) {
      return exactMappingsCache[keyMatch];
    }
  }

  const nameLower = name.toLowerCase();
  const providerLower = provider.toLowerCase();

  const crashKeywords = ['crash', 'jet', 'barão vermelho', 'red baron', 'aero', 'limbo', 'rocket', 'stock market', 'race track', 'crasher'];
  if (crashKeywords.some(key => nameLower.includes(key))) {
    return 'Crash';
  }

  const liveKeywords = ['live', 'brasileira', 'lobby', 'dealer', 'game show', 'mega wheel', 'roulette brasileira'];
  if (liveKeywords.some(key => nameLower.includes(key)) && !nameLower.includes('virtual')) {
    return 'Ao Vivo';
  }

  if (nameLower.includes('scratch') || nameLower.includes('raspadinha') || nameLower.includes('bilhete')) return 'Scratchcard';
  
  const instantKeywords = ['mines', 'plinko', 'penalty', 'goal', 'dare2win', 'coins', 'boxes', 'hi-lo'];
  if (instantKeywords.some(key => nameLower.includes(key))) {
    return 'Instant Win';
  }

  const tableKeywords = ['roulette', 'blackjack', 'baccarat', 'poker', 'keno', 'dice', 'sic bo'];
  const isVirtual = nameLower.includes('virtual') || nameLower.includes('first person') || nameLower.includes('deluxe');
  
  if (tableKeywords.some(key => nameLower.includes(key))) {
    if (providerLower.includes('pg soft') && nameLower.includes('baccarat')) return 'Mesa RNG';
    if (isVirtual) return 'Mesa RNG';
  }

  const slotKeywords = ['ways', 'megaways', '1000', 'fortune', 'wild', 'hot', 'fruit', 'shining', 'bonanza', 'book of', 'reels'];
  if (slotKeywords.some(key => nameLower.includes(key))) return 'Slot';

  if (providerLower.includes('pg soft')) return 'Slot'; 
  if (providerLower.includes('amusnet') && !nameLower.includes('roulette')) return 'Slot';

  return 'Slot'; 
}
