import csvData from './data.csv?raw';

/**
 * Categorias suportadas no sistema de acervo
 */
type GameCategory = 'Slot' | 'Ao Vivo' | 'Crash' | 'Mesa RNG' | 'Instant Win' | 'Scratchcard';

interface GameData {
  name: string;
  provider: string;
}

// Inicializamos o cache dos mapeamentos exatos do relatório
let exactMappingsCache: Record<string, GameCategory> | null = null;

function normalize(val: string): string {
    return String(val)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/:/g, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
}

function getExactMappings(): Record<string, GameCategory> {
  if (exactMappingsCache) return exactMappingsCache;
  
  exactMappingsCache = {};
  const lines = csvData.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) { // pula o cabeçalho
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(';');
    if (parts.length >= 3) {
      const cleanName = parts[0].trim().replace(/^["']|["']$/g, '');
      const provider = parts[1].trim();
      const category = parts[2].trim() as GameCategory;
      const key = `${normalize(provider)}::${normalize(cleanName)}`;
      exactMappingsCache[key] = category;
    }
  }
  return exactMappingsCache;
}

/**
 * Classifica automaticamente um jogo com base no nome e provedor.
 * Lógica baseada no arquivo data.csv, com fallback para análise estruturada.
 */
export function classifyGame(game: GameData): GameCategory {
  const name = game.name;
  const provider = game.provider;

  // 0. PRIORIDADE MÁXIMA: Verificar se existe no mapeamento exato (relatório)
  const mappings = getExactMappings();
  const keyMatch = `${normalize(provider)}::${normalize(name)}`;
  if (mappings[keyMatch]) {
    return mappings[keyMatch];
  }

  const nameLower = name.toLowerCase();
  const providerLower = provider.toLowerCase();

  // 1. PRIORIDADE: CRASH GAMES (Jogos de Colisão)
  // Baseado em Evolution (Red Baron/Barão Vermelho) e mecânicas de multiplicadores crescentes
  const crashKeywords = ['crash', 'jet', 'barão vermelho', 'red baron', 'aero', 'limbo', 'rocket', 'stock market', 'race track', 'crasher'];
  if (crashKeywords.some(key => nameLower.includes(key))) {
    return 'Crash';
  }

  // 2. PRIORIDADE: CASSINO AO Vivo (Live Casino)
  // Identificado por termos de transmissão em tempo real ou estúdio
  const liveKeywords = ['live', 'brasileira', 'lobby', 'dealer', 'game show', 'mega wheel', 'roulette brasileira'];
  if (liveKeywords.some(key => nameLower.includes(key)) && !nameLower.includes('virtual')) {
    return 'Ao Vivo';
  }

  // 3. PRIORIDADE: INSTANT WIN & SCRATCHCARDS
  // Baseado na vertical "Dare2Win" da Hacksaw e loterias instantâneas
  if (nameLower.includes('scratch') || nameLower.includes('raspadinha') || nameLower.includes('bilhete')) return 'Scratchcard';
  
  const instantKeywords = ['mines', 'plinko', 'penalty', 'goal', 'dare2win', 'coins', 'boxes', 'hi-lo'];
  if (instantKeywords.some(key => nameLower.includes(key))) {
    return 'Instant Win';
  }

  // 4. PRIORIDADE: MESA RNG (Gerador de Números Aleatórios)
  // Jogos de mesa sem dealer ao vivo, como a série "Virtual" da Amusnet
  const tableKeywords = ['roulette', 'blackjack', 'baccarat', 'poker', 'keno', 'dice', 'sic bo'];
  const isVirtual = nameLower.includes('virtual') || nameLower.includes('first person') || nameLower.includes('deluxe');
  
  if (tableKeywords.some(key => nameLower.includes(key))) {
    // Caso específico da PG Soft: Baccarat Deluxe é Mesa RNG
    if (providerLower.includes('pg soft') && nameLower.includes('baccarat')) return 'Mesa RNG';
    // Se for um jogo de mesa e tiver "virtual" ou o provedor for focado em RNG (como Amusnet Virtual)
    if (isVirtual) return 'Mesa RNG';
  }

  // 5. PADRÃO: SLOTS (Caça-Níqueis)
  // Categoria padrão para a grande maioria dos títulos da PG Soft, Pragmatic e Amusnet
  // Slots frequentemente usam termos de linhas, multiplicadores ou temas específicos
  const slotKeywords = ['ways', 'megaways', '1000', 'fortune', 'wild', 'hot', 'fruit', 'shining', 'bonanza', 'book of', 'reels'];
  if (slotKeywords.some(key => nameLower.includes(key))) return 'Slot';

  // Regra de Exclusão por Provedor
  if (providerLower.includes('pg soft')) return 'Slot'; // PG Soft é quase 100% focado em slots móveis verticais
  if (providerLower.includes('amusnet') && !nameLower.includes('roulette')) return 'Slot'; // Amusnet foca em "Dice Slots" e Clássicos

  return 'Slot'; // Categoria padrão caso nenhuma regra seja atingida
}
