export let exactMappingsCache = null;
export let keywordRulesCache = null;

export async function loadMappings() {
  if (exactMappingsCache && keywordRulesCache) return;
  exactMappingsCache = {};
  
  // Carrega mapeamento exato
  try {
    const res = await fetch('./data.csv');
    if (res.ok) {
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
    }
  } catch (e) {
    console.warn("Aviso ao carregar data.csv:", e);
  }

  // Carrega regras de palavras-chave
  try {
    const res = await fetch('./keyword_rules.json');
    if (res.ok) {
      keywordRulesCache = await res.json();
    }
  } catch (e) {
    console.warn("Aviso ao carregar keyword_rules.json:", e);
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

  const nameLower = name.toLowerCase();
  const providerLower = provider.toLowerCase();

  // 1. Verifica Mapeamento Exato (data.csv)
  if (exactMappingsCache) {
    const keyMatch = `${normalize(provider)}::${normalize(name)}`;
    if (exactMappingsCache[keyMatch]) {
      return exactMappingsCache[keyMatch];
    }
  }

  // 2. Fallback p/ JSON se não carregou
  if (!keywordRulesCache) {
    return fallbackClassifier(nameLower, providerLower);
  }

  // 3. Verifica Regras Especiais
  if (keywordRulesCache.specialRules) {
    for (const rule of keywordRulesCache.specialRules) {
      const matchesProvider = !rule.ifProvider || providerLower.includes(rule.ifProvider);
      
      let matchesName = false;
      if (rule.ifNameIncludes) {
        matchesName = rule.ifNameIncludes.some(kw => nameLower.includes(kw));
      } else {
        matchesName = true;
      }

      let matchesAlso = true;
      if (rule.ifAlsoIncludes) {
        matchesAlso = rule.ifAlsoIncludes.some(kw => nameLower.includes(kw));
      }

      if (matchesProvider && matchesName && matchesAlso) {
        return rule.thenCategory;
      }
    }
  }

  // 4. Verifica Categorias por Palavras-Chave em Ordem
  if (keywordRulesCache.keywordCategories) {
    for (const cat of keywordRulesCache.keywordCategories) {
      if (cat.keywords && cat.keywords.some(kw => nameLower.includes(kw))) {
        return cat.category;
      }
    }
  }

  // 5. Verifica Provedores Exatos
  if (keywordRulesCache.exactProviders) {
    for (const prov in keywordRulesCache.exactProviders) {
      if (providerLower.includes(prov)) {
        return keywordRulesCache.exactProviders[prov];
      }
    }
  }

  return keywordRulesCache.defaultCategory || 'Slot';
}

function fallbackClassifier(nameLower, providerLower) {
  const crashKeywords = ['crash', 'jet', 'barão vermelho', 'red baron', 'aero', 'limbo', 'rocket', 'stock market', 'race track', 'crasher'];
  if (crashKeywords.some(key => nameLower.includes(key))) return 'Crash';

  const liveKeywords = ['live', 'brasileira', 'lobby', 'dealer', 'game show', 'mega wheel', 'roulette brasileira'];
  if (liveKeywords.some(key => nameLower.includes(key)) && !nameLower.includes('virtual')) return 'Ao Vivo';

  if (nameLower.includes('scratch') || nameLower.includes('raspadinha') || nameLower.includes('bilhete')) return 'Scratchcard';
  
  const instantKeywords = ['mines', 'plinko', 'penalty', 'goal', 'dare2win', 'coins', 'boxes', 'hi-lo'];
  if (instantKeywords.some(key => nameLower.includes(key))) return 'Instant Win';

  const tableKeywords = ['roulette', 'blackjack', 'baccarat', 'poker', 'keno', 'dice', 'sic bo'];
  const isVirtual = nameLower.includes('virtual') || nameLower.includes('first person') || nameLower.includes('deluxe');
  
  if (tableKeywords.some(key => nameLower.includes(key))) {
    if (providerLower.includes('pg soft') && nameLower.includes('baccarat')) return 'Mesa RNG';
    if (isVirtual) return 'Mesa RNG';
    return 'Ao Vivo'; // Modificado para Ao Vivo como padrão
  }

  const slotKeywords = ['ways', 'megaways', '1000', 'fortune', 'wild', 'hot', 'fruit', 'shining', 'bonanza', 'book of', 'reels'];
  if (slotKeywords.some(key => nameLower.includes(key))) return 'Slot';

  if (providerLower.includes('pg soft')) return 'Slot'; 
  if (providerLower.includes('amusnet') && !nameLower.includes('roulette')) return 'Slot';

  return 'Slot'; 
}
