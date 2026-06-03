/**
 * ThumbSync Client Component - Vanilla ES Module
 * Companion do Sistema de sincronização de miniaturas de jogos voltado para o cliente
 * 100% Client-Side, compatível com GitHub Pages (sem backend Node/NPM obrigatório).
 */

// --- GOOGLE DRIVE WEB API CLIENT ---
export class DriveApiClient {
  constructor() {
    this.accessToken = null;
  }

  setAccessToken(token) {
    this.accessToken = token;
  }

  getAccessToken() {
    return this.accessToken;
  }

  isAuthenticated() {
    return !!this.accessToken;
  }

  async fetchWithAuth(url, options = {}) {
    if (!this.accessToken) {
      throw new Error("Usuário não autenticado no Google Drive.");
    }

    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${this.accessToken}`);

    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      this.accessToken = null;
      localStorage.removeItem('gdrive_access_token');
      localStorage.removeItem('gdrive_token_expires_at');
      window.dispatchEvent(new Event('gdrive_unauthorized'));
      throw new Error("Sessão do Google Drive expirada. Faça login novamente.");
    }
    return res;
  }

  /**
   * Procura uma pasta por nome. Se não existir, cria.
   */
  async findOrCreateFolder(folderName) {
    const q = `name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`;
    
    const res = await this.fetchWithAuth(url);
    if (!res.ok) {
      throw new Error(`Erro ao buscar pasta no Drive: ${res.statusText}`);
    }
    const data = await res.json();
    
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }

    // Criar pasta
    const createUrl = 'https://www.googleapis.com/drive/v3/files';
    const createRes = await this.fetchWithAuth(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      })
    });

    if (!createRes.ok) {
      throw new Error(`Erro ao criar pasta no Drive: ${createRes.statusText}`);
    }
    const folder = await createRes.json();
    return folder.id;
  }

  /**
   * Procura uma pasta por nome dentro de uma pasta pai. Se não existir, cria.
   */
  async findOrCreateSubfolder(folderName, parentFolderId) {
    const q = `name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`;
    
    const res = await this.fetchWithAuth(url);
    if (!res.ok) {
      throw new Error(`Erro ao buscar subpasta no Drive: ${res.statusText}`);
    }
    const data = await res.json();
    
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }

    // Criar subpasta com pai especificado
    const createUrl = 'https://www.googleapis.com/drive/v3/files';
    const createRes = await this.fetchWithAuth(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId]
      })
    });

    if (!createRes.ok) {
      throw new Error(`Erro ao criar subpasta no Drive: ${createRes.statusText}`);
    }
    const folder = await createRes.json();
    return folder.id;
  }

  /**
   * Lista todos os arquivos webp e de texto na pasta.
   */
  async listFilesInFolder(folderId) {
    const q = `'${folderId}' in parents and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,modifiedTime,thumbnailLink,webContentLink)&pageSize=1000`;
    
    const res = await this.fetchWithAuth(url);
    if (!res.ok) {
      throw new Error(`Erro ao listar arquivos do Drive: ${res.statusText}`);
    }
    const data = await res.json();
    return data.files || [];
  }

  /**
   * Baixa arquivo do drive como texto
   */
  async downloadTextFile(fileId) {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const res = await this.fetchWithAuth(url);
    if (!res.ok) {
      throw new Error(`Erro ao ler conteúdo do arquivo: ${res.statusText}`);
    }
    return await res.text();
  }

  /**
   * Baixa arquivo binário (como imagens) como Blob
   */
  async downloadBinaryFile(fileId) {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const res = await this.fetchWithAuth(url);
    if (!res.ok) {
      throw new Error(`Erro ao carregar miniatura do Google Drive: ${res.statusText}`);
    }
    return await res.blob();
  }

  /**
   * Cria ou atualiza um arquivo de texto no Google Drive
   */
  async saveTextFile(fileName, content, parentFolderId, fileId) {
    if (fileId) {
      const updateUrl = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
      const res = await this.fetchWithAuth(updateUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: content
      });
      if (!res.ok) {
        throw new Error(`Erro ao atualizar arquivo no Drive: ${res.statusText}`);
      }
      return fileId;
    } else {
      if (!parentFolderId) {
        throw new Error("parentFolderId é obrigatório para criar novos arquivos.");
      }

      // 1. Criar metadados
      const createMetaUrl = 'https://www.googleapis.com/drive/v3/files';
      const metaRes = await this.fetchWithAuth(createMetaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fileName,
          parents: [parentFolderId],
          mimeType: 'text/plain'
        })
      });

      if (!metaRes.ok) {
        throw new Error(`Erro ao registrar metadados do arquivo: ${metaRes.statusText}`);
      }
      const newFile = await metaRes.json();
      return await this.saveTextFile(fileName, content, undefined, newFile.id);
    }
  }

  /**
   * Envia uma imagem para a pasta do Drive
   */
  async uploadImage(fileName, blob, parentFolderId) {
    // 1. Criar metadados
    const createMetaUrl = 'https://www.googleapis.com/drive/v3/files';
    const metaRes = await this.fetchWithAuth(createMetaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: fileName,
        parents: [parentFolderId],
        mimeType: 'image/webp'
      })
    });

    if (!metaRes.ok) {
      throw new Error(`Erro ao registrar metadados da imagem: ${metaRes.statusText}`);
    }
    const newFile = await metaRes.json();
    const newFileId = newFile.id;

    // 2. Upload de mídia
    const uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${newFileId}?uploadType=media`;
    const uploadRes = await this.fetchWithAuth(uploadUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'image/webp' },
      body: blob
    });

    if (!uploadRes.ok) {
      throw new Error(`Erro ao enviar bytes da imagem: ${uploadRes.statusText}`);
    }

    return {
      id: newFileId,
      name: fileName,
      mimeType: 'image/webp'
    };
  }
}

export const driveClient = new DriveApiClient();


// --- TEMPLATES AND CONFIGURATION ASSETS ---
export const DEFAULT_LIST_CONTENT = `Provedor: Exemplo
Novo Jogo`;

export const PROVIDER_GRADIENTS = {
  'pragmatic play': 'from-[#0a84ff]/30 via-transparent to-black/80',
  'pg soft': 'from-amber-500/30 via-transparent to-black/80',
  'sem provedor': 'from-purple-500/30 via-transparent to-black/80',
  'default': 'from-zinc-700/30 via-transparent to-black/80'
};

export const PROVIDER_BORDER_GLOWS = {
  'pragmatic play': 'rgba(10, 132, 255, 0.35)',
  'pg soft': 'rgba(245, 158, 11, 0.35)',
  'sem provedor': 'rgba(168, 85, 247, 0.35)',
  'default': 'rgba(255, 255, 255, 0.15)'
};

export const PROVIDER_BADGE_STYLE = {
  'pragmatic play': 'bg-[#0a84ff]/10 text-[#0a84ff] border-[#0a84ff]/20',
  'pg soft': 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  'sem provedor': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  'default': 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
};

export const LIVE_KEYWORDS = [
  "baccarat", "bac bo", "blackjack", "roulette", "roleta", "sic bac", 
  "trunfo", "time", "dream catcher", "poker", "patti", "mega fire blaze", 
  "andar bahar", "bet on", "live", "heads up hold", "wheel", "ice fishing", 
  "marble race", "war", "super color game"
];


// --- CORE APPLICATION CONTROLLER CLASS ---
class ThumbSyncApp {
  constructor() {
    this.state = {
      activeTab: 'list_manager',
      gdriveConnected: false,
      googleUser: null,
      listContent: '',
      driveFiles: [],
      listFileId: '',
      thumbsFolderId: '',
      tagsFileId: '',
      catalogItems: [],
      driveProviders: [],
      
      // UI Helpers
      isLoading: false,
      logs: [],
      isSavingTag: false,
      filterProvider: 'todos',
      filterStatus: 'todos',
      filterTag: 'todos',
      searchQuery: '',
      customTags: {},
      
      // Modal state
      selectedCatalogItem: null,
      isAddingGame: false,
      addingGameToProvider: '',
      selectedListKeys: new Set(),
      catalogPage: 1,
    };

    this.config = {
      clientId: '284266654862-bt52sui73h7jbd4tc44u99n0aaiev6og.apps.googleusercontent.com',
      folderName: 'Thumbs',
      listFileName: 'lista.txt',
      tagsFileName: 'tags.json',
    };

    this.imageCache = new Map(); // fileId -> objectURL
    this.observers = [];

    this.addLog("Inicializando módulo ThumbSync...");
    this.loadStateFromStorage();
    this.initGISAutomatic();
    
    // Fallback listeners para expiração de token
    window.addEventListener('gdrive_unauthorized', () => {
      this.addLog("Sessão Google desautenticada ou expirada.");
      this.state.gdriveConnected = false;
      this.syncLocalCatalog();
      this.render();
    });
  }

  loadStateFromStorage() {
    const defaultClientId = '284266654862-bt52sui73h7jbd4tc44u99n0aaiev6og.apps.googleusercontent.com';
    const savedClientId = localStorage.getItem('thumbsync_client_id') || defaultClientId;
    const savedFolderName = localStorage.getItem('thumbsync_folder_name') || 'Thumbs';
    const savedListFileName = localStorage.getItem('thumbsync_list_file_name') || 'lista.txt';
    const savedTagsFileName = localStorage.getItem('thumbsync_tags_file_name') || 'tags.json';
    const cachedList = localStorage.getItem('thumbsync_cached_list_content') || DEFAULT_LIST_CONTENT;

    this.config = {
      clientId: savedClientId,
      folderName: savedFolderName,
      listFileName: savedListFileName,
      tagsFileName: savedTagsFileName,
    };

    this.state.listContent = cachedList;

    const savedToken = localStorage.getItem('gdrive_access_token');
    const tokenExpiresAt = Number(localStorage.getItem('gdrive_token_expires_at') || '0');

    if (savedToken && tokenExpiresAt > Date.now()) {
      driveClient.setAccessToken(savedToken);
      this.state.gdriveConnected = true;
      this.addLog("Sessão herdada do Google Drive carregada com sucesso.");
    }

    try {
      this.state.customTags = JSON.parse(localStorage.getItem('thumbsync_custom_tags')) || {};
    } catch (e) {
      this.state.customTags = {};
    }
    this.state.filterTag = localStorage.getItem('thumbsync_filter_tag') || 'todos';

    this.syncLocalCatalog();
  }

  saveStateToStorage() {
    localStorage.setItem('thumbsync_client_id', this.config.clientId);
    localStorage.setItem('thumbsync_folder_name', this.config.folderName);
    localStorage.setItem('thumbsync_list_file_name', this.config.listFileName);
    localStorage.setItem('thumbsync_tags_file_name', this.config.tagsFileName);
    localStorage.setItem('thumbsync_cached_list_content', this.state.listContent);
    localStorage.setItem('thumbsync_custom_tags', JSON.stringify(this.state.customTags || {}));
    localStorage.setItem('thumbsync_filter_tag', this.state.filterTag || 'todos');
  }

  addLog(message) {
    // Desativado para este cliente - logs removidos
  }

  /**
   * Inicializa o script Google Client SDK automaticamente.
   */
  initGISAutomatic() {
    const checkGIS = setInterval(() => {
      if (typeof window.google !== 'undefined') {
        clearInterval(checkGIS);
        this.addLog("Google API SDK carregado com sucesso.");
        if (this.config.clientId && this.state.gdriveConnected) {
          this.reconnectSilent();
        }
      }
    }, 500);

    setTimeout(() => clearInterval(checkGIS), 10000);
  }

  async reconnectSilent() {
    try {
      const savedToken = localStorage.getItem('gdrive_access_token');
      if (savedToken) {
        driveClient.setAccessToken(savedToken);
        await this.syncOnlyList();
      }
    } catch (err) {
      this.addLog(`Reconexão automática falhou: ${err.message}`);
    }
  }

  /**
   * Abre o fluxo popup OAuth do Google.
   */
  handleGoogleLogin() {
    if (!this.config.clientId) {
      this.addLog("Erro: Client ID do Google Cloud não configurado!");
      this.setActiveTab('settings');
      this.render();
      alert("Por favor, configure o seu Client ID do Google Cloud antes de conectar.");
      return;
    }

    this.state.isLoading = true;
    this.addLog("Iniciando popup do Google Account...");
    this.render();

    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: this.config.clientId,
        scope: 'https://www.googleapis.com/auth/drive',
        callback: async (response) => {
          if (response.error) {
            this.state.isLoading = false;
            this.addLog(`Autenticação recusada: ${response.error}`);
            this.render();
            return;
          }

          this.addLog("Acesso concedido. Sincronizando dados...");
          driveClient.setAccessToken(response.access_token);
          this.state.gdriveConnected = true;

          localStorage.setItem('gdrive_access_token', response.access_token);
          localStorage.setItem('gdrive_token_expires_at', (Date.now() + response.expires_in * 1000).toString());
          this.saveStateToStorage();

          await this.syncWithGoogleDrive();
          this.state.isLoading = false;
          this.render();
        },
      });
      client.requestAccessToken();
    } catch (err) {
      this.state.isLoading = false;
      this.addLog(`Erro ao carregar modal de login: ${err.message}`);
      this.render();
    }
  }

  handleGoogleLogout() {
    this.addLog("Sessão Google Drive desconectada.");
    driveClient.setAccessToken('');
    this.state.gdriveConnected = false;
    localStorage.removeItem('gdrive_access_token');
    localStorage.removeItem('gdrive_token_expires_at');
    this.saveStateToStorage();

    this.imageCache.forEach(url => URL.revokeObjectURL(url));
    this.imageCache.clear();

    this.syncLocalCatalog();
    this.render();
  }

  /**
   * Sincroniza listas e miniaturas com o Google Drive baseado nas configurações do usuário.
   */
  async syncWithGoogleDrive() {
    if (!driveClient.isAuthenticated()) {
      this.addLog("Sincronizando dados com cache local (Usuário Desconectado).");
      this.syncLocalCatalog();
      this.render();
      return;
    }

    this.state.isLoading = true;
    this.addLog(`Sincronizando com o seu Google Drive...`);
    this.render();

    try {
      this.addLog(`Buscando pasta '${this.config.folderName}' no Drive...`);
      const folderId = await driveClient.findOrCreateFolder(this.config.folderName);
      this.state.thumbsFolderId = folderId;
      this.addLog(`Pasta '${this.config.folderName}' ativa (ID: ${folderId.substring(0, 8)}...)`);

      this.addLog("Escaneando arquivos raiz e pastas de provedores dentro da pasta...");
      const files = await driveClient.listFilesInFolder(folderId);

      const directFiles = [];
      const subfolders = [];

      files.forEach(f => {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          subfolders.push(f);
        } else {
          directFiles.push(f);
        }
      });

      this.state.driveProviders = subfolders.map(f => f.name);

      this.addLog(`Encontrados ${directFiles.length} arquivos raiz e ${subfolders.length} pastas de provedores.`);

      const allFiles = [...directFiles];

      // Busca recursivamente os arquivos (.webp) dentro de cada pasta de provedor
      await Promise.all(subfolders.map(async (subfolder) => {
        try {
          this.addLog(`Escaneando subpasta do provedor '${subfolder.name}'...`);
          const subFiles = await driveClient.listFilesInFolder(subfolder.id);
          
          // Sincronizar os resultados de forma segura para o array principal
          const processedSubFiles = subFiles.map(sf => ({
            ...sf,
            providerName: subfolder.name
          }));
          
          allFiles.push(...processedSubFiles);
          this.addLog(`Provedor '${subfolder.name}': ${processedSubFiles.length} miniaturas carregadas.`);
        } catch (subErr) {
          this.addLog(`Erro ao ler pasta do provedor '${subfolder.name}': ${subErr.message}`);
        }
      }));

      this.state.driveFiles = allFiles;
      this.addLog(`Total: ${allFiles.length} arquivos indexados do Google Drive.`);

      // Sincronizar Tags Personalizadas (tags.json)
      const tagsFile = allFiles.find(f => f.name.toLowerCase() === this.config.tagsFileName.toLowerCase());
      if (tagsFile) {
        this.addLog(`Baixando metadados de tags (${this.config.tagsFileName})...`);
        this.state.tagsFileId = tagsFile.id;
        try {
          const tagsText = await driveClient.downloadTextFile(tagsFile.id);
          this.state.customTags = JSON.parse(tagsText);
        } catch (e) {
          this.addLog("Aviso: Falha ao processar arquivo de tags. Usando cache local.");
        }
      }

      const listFile = allFiles.find(f => f.name.toLowerCase() === this.config.listFileName.toLowerCase());
      if (listFile) {
        this.addLog(`Baixando catálogo contido no arquivo '${this.config.listFileName}'...`);
        this.state.listFileId = listFile.id;
        const listText = await driveClient.downloadTextFile(listFile.id);
        this.state.listContent = listText;
        this.addLog(`Arquivo '${this.config.listFileName}' lido com sucesso (${listText.split('\n').length} linhas).`);
      } else {
        this.addLog(`Aviso: Arquivo '${this.config.listFileName}' não localizado na pasta raiz. Gerando modelo básico...`);
        const newFileId = await driveClient.saveTextFile(this.config.listFileName, DEFAULT_LIST_CONTENT, folderId);
        this.state.listFileId = newFileId;
        this.state.listContent = DEFAULT_LIST_CONTENT;
        this.addLog(`Arquivo padrão '${this.config.listFileName}' criado.`);
      }

      this.saveStateToStorage();
      this.syncLocalCatalog();
      this.addLog("Sincronização com o Google Drive concluída.");
    } catch (e) {
      this.addLog(`Erro ao sincronizar: ${e.message}`);
      this.syncLocalCatalog();
    } finally {
      this.state.isLoading = false;
      this.render();
    }
  }

  /**
   * Sincroniza apenas o arquivo lista.txt com o Google Drive de forma rápida e independente.
   */
  async syncOnlyList() {
    if (!driveClient.isAuthenticated()) {
      this.addLog("Sincronizando apenas lista.txt com cache local...");
      const cachedList = localStorage.getItem('thumbsync_cached_list_content') || DEFAULT_LIST_CONTENT;
      this.state.listContent = cachedList;
      this.syncLocalCatalog();
      this.addLog("Lista.txt reatualizada do cache local.");
      this.render();
      return;
    }

    this.state.isLoading = true;
    this.addLog(`Sincronizando apenas '${this.config.listFileName}' com o Google Drive...`);
    this.render();

    try {
      this.addLog(`Buscando pasta '${this.config.folderName}' no Drive...`);
      const folderId = await driveClient.findOrCreateFolder(this.config.folderName);
      this.state.thumbsFolderId = folderId;

      this.addLog("Buscando lista.txt dentro da pasta...");
      const files = await driveClient.listFilesInFolder(folderId);

      const listFile = files.find(f => f.name.toLowerCase() === this.config.listFileName.toLowerCase());
      if (listFile) {
        this.addLog(`Baixando catálogo do arquivo '${this.config.listFileName}'...`);
        this.state.listFileId = listFile.id;
        const listText = await driveClient.downloadTextFile(listFile.id);
        this.state.listContent = listText;
        this.addLog(`Arquivo '${this.config.listFileName}' sincronizado com sucesso (${listText.split('\n').length} linhas).`);
      } else {
        this.addLog(`Aviso: Arquivo '${this.config.listFileName}' não localizado na pasta raiz. Gerando modelo básico...`);
        const newFileId = await driveClient.saveTextFile(this.config.listFileName, DEFAULT_LIST_CONTENT, folderId);
        this.state.listFileId = newFileId;
        this.state.listContent = DEFAULT_LIST_CONTENT;
        this.addLog(`Arquivo padrão '${this.config.listFileName}' criado.`);
      }

      // Sincronizar apenas tags também
      const tagsFile = files.find(f => f.name.toLowerCase() === this.config.tagsFileName.toLowerCase());
      if (tagsFile) {
        this.state.tagsFileId = tagsFile.id;
        try {
          const tagsText = await driveClient.downloadTextFile(tagsFile.id);
          this.state.customTags = JSON.parse(tagsText);
        } catch (e) {
          console.error("Erro ao baixar tags isoladamente", e);
        }
      }

      this.saveStateToStorage();
      this.syncLocalCatalog();
      this.addLog("Sincronização de lista concluída.");
    } catch (e) {
      this.addLog(`Erro ao sincronizar somente a lista: ${e.message}`);
      alert(`Falha ao sincronizar somente a lista: ${e.message}`);
    } finally {
      this.state.isLoading = false;
      this.render();
    }
  }

  /**
   * Reconstrói catálogo unificando o arquivo lista.txt com as artes encontradas no Drive
   */
  syncLocalCatalog() {
    const listGames = [];
    const lines = this.state.listContent.split(/\r?\n/);
    
    let currentProvider = "Sem provedor";
    for (const line of lines) {
      const clean = line.replace(/^\uFEFF/, '').replace(/^\s*(?:[-*•]\s+|\d+\s*[\).\]-]\s*)/, '').trim();
      if (!clean || clean.startsWith('#') || clean.includes('?')) continue;

      const providerMatch = clean.match(/^provedor\s*:\s*(.+)$/i);
      if (providerMatch) {
         currentProvider = providerMatch[1].trim();
         continue;
      }
      
      if (/^provedor\s*:/i.test(clean)) continue;

      listGames.push({
        displayName: clean,
        normalizedName: this.normalizeName(clean),
        providerName: currentProvider
      });
    }

    const driveFiles = this.state.driveFiles;
    const itemsMap = new Map();

    listGames.forEach(game => {
      const key = `${this.normalizeName(game.providerName)}::${game.normalizedName}`;
      itemsMap.set(key, {
        id: key,
        displayName: game.displayName,
        normalizedName: game.normalizedName,
        providerName: game.providerName,
        isListed: true,
        hasWebp: false
      });
    });

    driveFiles.forEach(file => {
      if (file.mimeType !== 'image/webp') return;

      const baseName = file.name.replace(/\.webp$/i, '');
      const normName = this.normalizeName(baseName);
      
      let fileProvider = "Sem provedor";
      if (file.providerName) {
        fileProvider = file.providerName;
      } else {
        const matchGame = listGames.find(g => g.normalizedName === normName);
        if (matchGame) {
          fileProvider = matchGame.providerName;
        }
      }

      const key = `${this.normalizeName(fileProvider)}::${normName}`;
      const existing = itemsMap.get(key);
      if (existing) {
        existing.hasWebp = true;
        existing.driveFileId = file.id;
        existing.fileSize = file.size;
        existing.modifiedTime = file.modifiedTime;
      } else {
        itemsMap.set(key, {
          id: key,
          displayName: baseName,
          normalizedName: normName,
          providerName: fileProvider,
          isListed: false,
          hasWebp: true,
          driveFileId: file.id,
          fileSize: file.size,
          modifiedTime: file.modifiedTime
        });
      }
    });

    this.state.catalogItems = Array.from(itemsMap.values());
  }

  normalizeName(val) {
    return String(val)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\.webp$/i, '')
      .replace(/:/g, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  getGameTag(item) {
    if (this.state.customTags && this.state.customTags[item.id]) {
      return this.state.customTags[item.id];
    }
    const norm = this.normalizeName(item.displayName);
    const isLive = LIVE_KEYWORDS.some(kw => norm.includes(kw));
    return isLive ? "ao vivo" : "slot";
  }

  async updateGameTag(itemId, newTag) {
    if (!this.state.customTags) {
      this.state.customTags = {};
    }

    const oldTag = this.state.customTags[itemId];
    if (oldTag === newTag) return;

    this.state.customTags[itemId] = newTag;
    this.saveStateToStorage();
    
    this.state.isSavingTag = true;
    this.renderActiveTab();
    
    const item = this.state.catalogItems.find(i => i.id === itemId);
    if (item) {
      this.renderPreviewModal(item);
      
      if (driveClient.isAuthenticated()) {
        try {
          this.addLog(`Sincronizando nova tag de '${item.displayName}' com o Drive...`);
          const content = JSON.stringify(this.state.customTags, null, 2);
          const fileId = await driveClient.saveTextFile(this.config.tagsFileName, content, this.state.thumbsFolderId, this.state.tagsFileId);
          this.state.tagsFileId = fileId;
          this.addLog(`Tag salva globalmente.`);
        } catch (err) {
          this.addLog(`Erro ao salvar tag no Drive: ${err.message}`);
          alert("A tag foi salva localmente, mas houve um erro ao sincronizar com o Google Drive.");
        } finally {
          this.state.isSavingTag = false;
          this.renderActiveTab();
          this.renderPreviewModal(item);
        }
      } else {
        this.state.isSavingTag = false;
      }
    }
  }

  async setActiveTab(tab) {
    const prevTab = this.state.activeTab;
    this.state.activeTab = tab;
    this.render();

    if (tab === 'catalog') this.state.catalogPage = 1;
    if (tab === 'catalog' && prevTab !== 'catalog') {
      if (!this.state.useMock && driveClient.isAuthenticated()) {
        await this.syncWithGoogleDrive();
      }
    }
  }

  /**
   * Carrega visualmente a imagem webp do jogo.
   * Se offline (Mock), tenta puxar o arquivo real no diretório `/mock_data/source/...` com fallback p/ SVG processual.
   */
  async loadThumbnailSrc(item, imgEl) {
    if (this.imageCache.has(item.driveFileId)) {
      imgEl.src = this.imageCache.get(item.driveFileId);
      imgEl.classList.remove('opacity-0');
      return;
    }

    try {
      const blob = await driveClient.downloadBinaryFile(item.driveFileId);
      const url = URL.createObjectURL(blob);
      this.imageCache.set(item.driveFileId, url);
      imgEl.src = url;
      imgEl.classList.remove('opacity-0');
    } catch (e) {
      imgEl.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjMzMzIi8+PC9zdmc+';
    }
  }

  /**
   * Força download da imagem
   */
  async handleDownloadFile(item) {
    if (!item.driveFileId) {
      alert("Esta miniatura não possui imagem (.webp) no Google Drive para download.");
      return;
    }

    this.addLog(`Baixando miniatura do Google Drive: ${item.displayName}.webp...`);
    try {
      const blob = await driveClient.downloadBinaryFile(item.driveFileId);
      this.triggerBlobDownload(blob, `${item.displayName}.webp`);
      this.addLog(`Download concluído: ${item.displayName}.webp`);
    } catch (e) {
      alert(`Falha no download: ${e.message}`);
    }
  }

  triggerBlobDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 150);
  }

  /**
   * Grava modificações no lista.txt (seja no Drive ou no cache local)
   */
  async saveUpdatedList(newContent) {
    this.state.isLoading = true;
    this.render();

    try {
      this.state.listContent = newContent;
      this.saveStateToStorage();

      if (driveClient.isAuthenticated() && this.state.listFileId) {
        this.addLog(`Escrevendo alterações no arquivo lista.txt do Google Drive...`);
        await driveClient.saveTextFile(this.config.listFileName, newContent, undefined, this.state.listFileId);
        this.addLog(`lista.txt atualizada e gravada com sucesso na sua conta.`);
      } else {
        this.addLog(`lista.txt gravada localmente com sucesso.`);
      }

      this.syncLocalCatalog();
    } catch (err) {
      this.addLog(`Erro ao salvar lista de jogos: ${err.message}`);
      alert("Falha ao salvar as alterações. Verifique sua conexão e tente novamente.");
    } finally {
      this.state.isLoading = false;
      this.render();
    }
  }

  handleAddGamesToList(providerName, gameNames) {
    const validGames = gameNames.map(g => g.trim()).filter(Boolean);
    if (validGames.length === 0) return;

    this.addLog(`Adicionando ${validGames.length} jogos ao provedor '${providerName}'...`);
    
    const lines = this.state.listContent.split(/\r?\n/);
    const targetHeaderRegex = new RegExp(`^provedor\\s*:\\s*${providerName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*$`, 'i');
    
    let injected = false;
    const updatedLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      updatedLines.push(line);

      if (targetHeaderRegex.test(line.trim())) {
         validGames.forEach(gameName => {
           updatedLines.push(gameName);
         });
         injected = true;
      }
    }

    if (!injected) {
      if (updatedLines.length > 0 && updatedLines[updatedLines.length - 1].trim() !== '') {
        updatedLines.push('');
      }
      updatedLines.push(`Provedor: ${providerName}`);
      validGames.forEach(gameName => {
        updatedLines.push(gameName);
      });
    }

    this.saveUpdatedList(updatedLines.join('\n'));
  }

  handleExcludeGameFromList(item) {
    const isConfirmed = confirm(`Excluir o jogo "${item.displayName}" do catálogo do provedor "${item.providerName}"?\nEsta alteração modificará o arquivo list.txt.`);
    if (!isConfirmed) return;

    this.addLog(`Removendo '${item.displayName}' do provedor '${item.providerName}'...`);
    
    const lines = this.state.listContent.split(/\r?\n/);
    const sections = [];
    let currentSection = null;
    const headerLines = [];

    for (const line of lines) {
      const cleanLine = line.replace(/^\uFEFF/, '').replace(/^\s*(?:[-*•]\s+|\d+\s*[\).\]-]\s*)/, '').trim();
      
      const providerMatch = cleanLine.match(/^provedor\s*:\s*(.+)$/i);
      if (providerMatch) {
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          providerLine: line,
          providerNameNormalized: this.normalizeName(providerMatch[1].trim()),
          games: []
        };
        continue;
      }
      
      if (currentSection) {
        if (cleanLine && !cleanLine.startsWith('#') && !cleanLine.includes('?')) {
          currentSection.games.push({
            originalLine: line,
            cleanGameName: cleanLine,
            normalizedGameName: this.normalizeName(cleanLine),
            isBlankOrComment: false
          });
        } else {
          currentSection.games.push({
            originalLine: line,
            cleanGameName: cleanLine,
            normalizedGameName: cleanLine ? this.normalizeName(cleanLine) : '',
            isBlankOrComment: true
          });
        }
      } else {
        headerLines.push(line);
      }
    }
    if (currentSection) {
      sections.push(currentSection);
    }

    let deleted = false;
    const targetProviderNormalized = this.normalizeName(item.providerName);
    
    for (const sec of sections) {
      if (sec.providerNameNormalized === targetProviderNormalized) {
        const idx = sec.games.findIndex(g => !g.isBlankOrComment && g.normalizedGameName === item.normalizedName);
        if (idx !== -1) {
          sec.games.splice(idx, 1);
          deleted = true;
          this.addLog(`Jogo descartado da lista.`);
          break;
        }
      }
    }

    const filteredSections = sections.filter(sec => {
      const genuineGames = sec.games.filter(g => !g.isBlankOrComment);
      if (genuineGames.length === 0) {
        this.addLog(`Provedor '${item.providerName}' não possui mais jogos na lista. Seção removida.`);
        return false;
      }
      return true;
    });

    const finalLines = [...headerLines];
    filteredSections.forEach((sec, sIdx) => {
      if (finalLines.length > 0 && finalLines[finalLines.length - 1].trim() !== '') {
        finalLines.push('');
      }
      finalLines.push(sec.providerLine);
      sec.games.forEach(g => {
        finalLines.push(g.originalLine);
      });
    });

    const cleanedFileContent = finalLines.join('\n').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
    this.saveUpdatedList(cleanedFileContent);
  }

  /**
   * Remove da lista todos os jogos que já possuem arquivo .webp correspondente no Drive.
   */
  handleClearFinishedGames() {
    const isConfirmed = confirm(`Deseja remover da lista todos os jogos que já possuem miniaturas (.webp) no Drive?\nEsta ação atualizará o arquivo ${this.config.listFileName}.`);
    if (!isConfirmed) return;

    this.addLog("Iniciando limpeza de jogos concluídos...");
    
    const lines = this.state.listContent.split(/\r?\n/);
    const sections = [];
    let currentSection = null;
    const headerLines = [];

    for (const line of lines) {
      const cleanLine = line.replace(/^\uFEFF/, '').replace(/^\s*(?:[-*•]\s+|\d+\s*[\).\]-]\s*)/, '').trim();
      
      const providerMatch = cleanLine.match(/^provedor\s*:\s*(.+)$/i);
      if (providerMatch) {
        if (currentSection) sections.push(currentSection);
        currentSection = {
          providerLine: line,
          providerNameNormalized: this.normalizeName(providerMatch[1].trim()),
          games: []
        };
        continue;
      }
      
      if (currentSection) {
        const isGame = cleanLine && !cleanLine.startsWith('#') && !cleanLine.includes('?');
        currentSection.games.push({
          originalLine: line,
          normalizedGameName: isGame ? this.normalizeName(cleanLine) : '',
          isBlankOrComment: !isGame
        });
      } else {
        headerLines.push(line);
      }
    }
    if (currentSection) sections.push(currentSection);

    let removedCount = 0;
    sections.forEach(sec => {
      sec.games = sec.games.filter(g => {
        if (g.isBlankOrComment) return true;
        
        const key = `${sec.providerNameNormalized}::${g.normalizedGameName}`;
        const item = this.state.catalogItems.find(ci => ci.id === key);
        
        if (item && item.hasWebp) {
          removedCount++;
          return false;
        }
        return true;
      });
    });

    if (removedCount === 0) {
      alert("Nenhum jogo concluído para limpar.");
      return;
    }

    const filteredSections = sections.filter(sec => sec.games.some(g => !g.isBlankOrComment));

    const finalLines = [...headerLines];
    filteredSections.forEach(sec => {
      if (finalLines.length > 0 && finalLines[finalLines.length - 1].trim() !== '') finalLines.push('');
      finalLines.push(sec.providerLine);
      sec.games.forEach(g => finalLines.push(g.originalLine));
    });

    const cleanedFileContent = finalLines.join('\n').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
    this.saveUpdatedList(cleanedFileContent);
  }

  /**
   * Remove múltiplos jogos selecionados da lista.txt.
   */
  handleDeleteSelectedGames() {
    const selectedCount = this.state.selectedListKeys.size;
    if (selectedCount === 0) return;

    const isConfirmed = confirm(`Excluir os ${selectedCount} jogos selecionados da lista de provedores?\nEsta alteração modificará o arquivo ${this.config.listFileName}.`);
    if (!isConfirmed) return;

    this.addLog(`Removendo ${selectedCount} jogos selecionados...`);
    
    const lines = this.state.listContent.split(/\r?\n/);
    const sections = [];
    let currentSection = null;
    const headerLines = [];

    for (const line of lines) {
      const cleanLine = line.replace(/^\uFEFF/, '').replace(/^\s*(?:[-*•]\s+|\d+\s*[\).\]-]\s*)/, '').trim();
      
      const providerMatch = cleanLine.match(/^provedor\s*:\s*(.+)$/i);
      if (providerMatch) {
        if (currentSection) sections.push(currentSection);
        currentSection = {
          providerLine: line,
          providerNameNormalized: this.normalizeName(providerMatch[1].trim()),
          games: []
        };
        continue;
      }
      
      if (currentSection) {
        const isGame = cleanLine && !cleanLine.startsWith('#') && !cleanLine.includes('?');
        currentSection.games.push({
          originalLine: line,
          normalizedGameName: isGame ? this.normalizeName(cleanLine) : '',
          isBlankOrComment: !isGame
        });
      } else {
        headerLines.push(line);
      }
    }
    if (currentSection) sections.push(currentSection);

    sections.forEach(sec => {
      sec.games = sec.games.filter(g => {
        if (g.isBlankOrComment) return true;
        const key = `${sec.providerNameNormalized}::${g.normalizedGameName}`;
        return !this.state.selectedListKeys.has(key);
      });
    });

    const filteredSections = sections.filter(sec => sec.games.some(g => !g.isBlankOrComment));

    const finalLines = [...headerLines];
    filteredSections.forEach(sec => {
      if (finalLines.length > 0 && finalLines[finalLines.length - 1].trim() !== '') finalLines.push('');
      finalLines.push(sec.providerLine);
      sec.games.forEach(g => finalLines.push(g.originalLine));
    });

    const cleanedFileContent = finalLines.join('\n').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
    this.state.selectedListKeys.clear();
    this.saveUpdatedList(cleanedFileContent);
  }

  // --- HTML DRAW PIPELINE ---
  render() {
    const root = document.getElementById('root');
    if (!root) return;

    const listedItems = this.state.catalogItems.filter(i => i.isListed);
    const completedGames = listedItems.filter(i => i.hasWebp).length;
    const totalListedCount = listedItems.length;
    const pendingGamesCount = totalListedCount - completedGames;

    root.innerHTML = `
      <div id="app-container" class="flex h-screen w-screen overflow-hidden text-[#f4f4f5] select-none font-sans bg-[#0c0c0e]">
        
        <!-- SIDEBAR -->
        <aside class="hidden lg:flex w-64 max-w-64 border-r border-white/[0.06] bg-[#0f0f13] flex-col justify-between shrink-0 h-full p-5 relative z-10">
          <div class="space-y-6">
            
            <!-- Brand Logo -->
            <div class="flex items-center gap-3.5 px-2 py-1.5 border-b border-white/[0.05]">
              <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#3b82f6] to-[#10b981] p-0.5 flex items-center justify-center shadow-[0_4px_16px_rgba(59,130,246,0.25)]">
                <svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h3 class="text-sm font-black tracking-wide leading-none text-white font-sans">ThumbSync</h3>
                <span class="text-[9px] text-[#10b981] font-bold uppercase tracking-wider mt-1 block">Download & Demandas</span>
              </div>
            </div>

            <!-- Gdrive Connection Widget -->
            <div class="p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.05] relative space-y-2">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full ${this.state.gdriveConnected ? 'bg-[#10b981] shadow-[0_0_8px_#10b981]' : 'bg-[#f59e0b] shadow-[0_0_8px_#f59e0b]'} shrink-0"></span>
                <span class="text-[11px] font-bold text-white tracking-tight">
                  ${this.state.gdriveConnected ? 'G-Drive Conectado' : 'Desconectado'}
                </span>
              </div>
              <p class="text-[9px] text-zinc-500 font-medium leading-tight">
                ${this.state.gdriveConnected ? 'Salva direto na sua conta do Google Drive.' : 'Conecte sua conta para gerenciar miniaturas.'}
              </p>
            </div>

            <!-- Side Nav Tabs -->
            <nav class="space-y-1">
              ${this.renderNavItem('catalog', 'Miniaturas', `
                <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              `, `
                <span class="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-white font-bold">${this.state.catalogItems.filter(i=>i.hasWebp).length}</span>
              `)}
              ${this.renderNavItem('list_manager', 'Lista de Jogos', `
                <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              `)}
              ${this.renderNavItem('settings', 'Configurações', `
                <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0" />
                </svg>
              `)}
            </nav>
          </div>

          <!-- Bottom account control -->
          <div class="border-t border-white/[0.05] pt-4 flex flex-col gap-2 relative z-10 w-full select-none">
            ${this.state.gdriveConnected ? `
              <div class="flex items-center gap-3 bg-white/[0.015] border border-white/[0.04] p-2.5 rounded-2xl w-full">
                <div class="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center font-bold text-xs text-white uppercase shadow-sm select-none">G</div>
                <div class="min-w-0 flex-1">
                  <p class="text-[11px] font-bold text-white truncate leading-none">Drive Ativo</p>
                  <span class="text-[9px] text-zinc-500 font-semibold truncate mt-1 block">Integração de Contas</span>
                </div>
              </div>
              <button id="btn-logout" class="flex items-center justify-center gap-2 text-xs font-bold py-2 px-3 text-center rounded-xl w-full text-red-400 hover:bg-red-500/10 transition-colors border border-red-500/15 cursor-pointer">
                Desconectar Google
              </button>
            ` : `
              <button id="btn-login" class="flex items-center justify-center gap-2 text-xs font-black bg-white text-black hover:bg-neutral-100 py-2.5 px-4 rounded-xl shadow-md w-full transition-all cursor-pointer">
                Conectar Google Drive
              </button>
            `}
          </div>
        </aside>

        <!-- MAIN AREA -->
        <main class="flex-1 min-w-0 flex flex-col h-full bg-[#0a0a0c] relative">
          
          <!-- MOBILE HEADER ACTION BAR -->
          <header class="h-16 shrink-0 border-b border-white/[0.05] bg-[#0f0f13] flex items-center justify-between px-4 sm:px-6 select-none relative z-10 w-full">
            <div class="flex items-center gap-2">
              <span class="hidden sm:inline text-[10px] sm:text-xs text-zinc-500 font-bold uppercase tracking-wider relative">Status</span>
              <span class="px-2.5 py-0.5 rounded-full text-[8px] font-extrabold ${this.state.gdriveConnected ? 'bg-[#10b981]/10 text-[#10b981] border border-[#10b981]/15' : 'bg-[#f59e0b]/10 text-[#f59e0b] border border-[#10b981]/15'} flex items-center gap-1.5 shadow-sm">
                <span class="w-1.5 h-1.5 rounded-full ${this.state.gdriveConnected ? 'bg-[#10b981]' : 'bg-[#f59e0b]'}"></span>
                <span class="hidden sm:inline">${this.state.gdriveConnected ? "GOOGLE DRIVE CONECTADO" : "NÃO CONECTADO"}</span>
                <span class="inline sm:hidden">${this.state.gdriveConnected ? "CONECTADO" : "OFFLINE"}</span>
              </span>
            </div>

            <!-- Apple-style Center Title for Mobile -->
            <div class="lg:hidden flex items-center gap-1.5">
              <span class="text-xs font-black tracking-tight text-white font-sans">ThumbSync</span>
            </div>

            <div class="flex items-center gap-3">
              <button id="btn-sync-gdrive" class="flex items-center justify-center w-8 h-8 sm:w-auto sm:h-auto sm:px-3.5 sm:py-1.5 cursor-pointer bg-white/[0.03] text-white hover:bg-white/[0.06] border border-white/[0.08] rounded-xl text-[10px] sm:text-xs font-bold transition-all active:scale-95 shrink-0" title="Sincronizar Google Drive">
                ${this.state.isLoading ? `
                  <svg id="sync-icon" class="w-3.5 h-3.5 animate-spin text-white shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <g transform="translate(12,12)">
                      <line x1="0" y1="-7" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="1" />
                      <line x1="0" y1="-7" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.875" transform="rotate(45)" />
                      <line x1="0" y1="-7" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.75" transform="rotate(90)" />
                      <line x1="0" y1="-7" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.625" transform="rotate(135)" />
                      <line x1="0" y1="-7" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.5" transform="rotate(180)" />
                      <line x1="0" y1="-7" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.375" transform="rotate(225)" />
                      <line x1="0" y1="-7" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.25" transform="rotate(270)" />
                      <line x1="0" y1="-7" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.125" transform="rotate(315)" />
                    </g>
                  </svg>
                ` : `
                  <svg id="sync-icon" class="w-3.5 h-3.5 shrink-0 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                `}
                <span class="hidden sm:inline ml-1.5">Sincronizar</span>
              </button>
            </div>
          </header>

          <!-- TAB CONTENT DISPLAY FRAME -->
          <div class="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 pb-20 md:pb-8 custom-scrollbar relative z-0 h-full w-full">
            <div id="tab-content" class="h-full w-full"></div>
          </div>
        </main>

        <!-- MOBILE TAB BAR -->
        <nav class="lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-[#0c0c0f]/90 backdrop-blur-md border-t border-white/[0.06] flex items-center justify-around z-30">
          ${this.renderMobileNavItem('catalog', 'Miniaturas', `
            <svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          `)}
          ${this.renderMobileNavItem('list_manager', 'Mural', `
            <svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          `)}
          ${this.renderMobileNavItem('settings', 'Ajustes', `
            <svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            </svg>
          `)}
        </nav>
      </div>

      <!-- Backdrop spinner overlay -->
      <div id="gdrive-loader" class="fixed inset-0 z-50 bg-black/40 backdrop-blur-md flex items-center justify-center pointer-events-auto transition-all duration-300 hidden select-none">
        <div class="bg-[#1c1c1e]/85 backdrop-blur-xl border border-white/[0.08] rounded-3xl p-6 w-60 flex flex-col items-center justify-center text-center shadow-[0_32px_64px_-12px_rgba(0,0,0,0.6)] gap-4">
          <svg class="w-9 h-9 animate-spin text-zinc-100" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <g transform="translate(12,12)">
              <line x1="0" y1="-8" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="1" />
              <line x1="0" y1="-8" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.91" transform="rotate(30)" />
              <line x1="0" y1="-8" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.83" transform="rotate(60)" />
              <line x1="0" y1="-8" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.75" transform="rotate(90)" />
              <line x1="0" y1="-8" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.66" transform="rotate(120)" />
              <line x1="0" y1="-8" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.58" transform="rotate(150)" />
              <line x1="0" y1="-8" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.5" transform="rotate(180)" />
              <line x1="0" y1="-8" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.41" transform="rotate(210)" />
              <line x1="0" y1="-8" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.33" transform="rotate(240)" />
              <line x1="0" y1="-8" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.25" transform="rotate(270)" />
              <line x1="0" y1="-8" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.16" transform="rotate(300)" />
              <line x1="0" y1="-8" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.08" transform="rotate(330)" />
            </g>
          </svg>
          <div>
            <p class="text-[13px] font-semibold text-white tracking-tight">Sincronizando Google Drive</p>
            <p class="text-[10px] text-zinc-400 mt-1">Organizando catálogo e lista.txt...</p>
          </div>
        </div>
      </div>

      <!-- ============================================================ -->
      <!-- FLOATING ASSISTANT WIDGET                                   -->
      <!-- ============================================================ -->

      <!-- Bubble Trigger Button -->
      <button id="assistant-bubble" aria-label="Dicas e avisos do desenvolvedor" class="fixed z-50 bottom-20 right-4 lg:bottom-6 lg:right-6 w-12 h-12 rounded-full flex items-center justify-center shadow-[0_8px_32px_rgba(59,130,246,0.45)] transition-all duration-300 active:scale-95 hover:scale-105 focus:outline-none" style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); border: 1px solid rgba(255,255,255,0.15);">
        <!-- Pulsing green dot — shown only on first visit -->
        ${!localStorage.getItem('thumbsync_assistant_opened') ? `
          <span class="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-[#0c0c0e]"></span>
          </span>
        ` : ''}
        <!-- Icon: sparkle / help -->
        <svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      </button>

      <!-- Assistant Popover Panel -->
      <div id="assistant-panel" class="fixed z-50 bottom-[5.5rem] right-4 lg:bottom-20 lg:right-6 w-[calc(100vw-2rem)] max-w-sm pointer-events-none opacity-0 scale-95 origin-bottom-right transition-all duration-300">
        <div class="rounded-3xl shadow-[0_32px_80px_rgba(0,0,0,0.7)] overflow-hidden" style="background: rgba(22,22,28,0.92); backdrop-filter: blur(24px) saturate(1.8); -webkit-backdrop-filter: blur(24px) saturate(1.8); border: 1px solid rgba(255,255,255,0.08);">

          <!-- Header -->
          <div class="flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/[0.06]">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-2xl flex items-center justify-center shadow-sm" style="background: linear-gradient(135deg, #2563eb, #1d4ed8);">
                <svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div>
                <p class="text-[13px] font-black text-white leading-none tracking-tight">Assistente</p>
                <p class="text-[9px] text-zinc-500 font-bold uppercase tracking-wider mt-0.5">ThumbSync · Dev Notes</p>
              </div>
            </div>
            <button id="assistant-close" class="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-white/10 text-zinc-500 hover:text-white cursor-pointer" style="border: 1px solid rgba(255,255,255,0.07);">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <!-- Body -->
          <div class="p-5 space-y-4 max-h-[65vh] overflow-y-auto custom-scrollbar">

            <!-- === Developer Security Notice === -->
            <div class="rounded-2xl p-4 space-y-2" style="background: rgba(234,179,8,0.08); border: 1px solid rgba(234,179,8,0.2);">
              <div class="flex items-center gap-2">
                <svg class="w-4 h-4 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
                <span class="text-[10px] font-black text-amber-400 uppercase tracking-wider">Aviso de Segurança</span>
              </div>
              <p class="text-[11px] text-amber-200/80 leading-relaxed font-medium">
                Sempre utilize a <strong class="text-amber-300 font-black">mesma conta Google</strong> ao acessar o site. Apenas aquela conta possui permissão para se conectar, como medida de segurança.
              </p>
            </div>

            <!-- === Tips Section === -->
            <div class="space-y-1">
              <p class="text-[9px] font-black text-zinc-600 uppercase tracking-widest px-1 pb-1">Dicas de uso</p>

              <!-- Tip 1 -->
              <div class="flex gap-3 p-3.5 rounded-2xl transition-colors" style="background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.05);">
                <div class="w-6 h-6 rounded-xl shrink-0 flex items-center justify-center mt-0.5" style="background: rgba(59,130,246,0.15); border: 1px solid rgba(59,130,246,0.2);">
                  <svg class="w-3.5 h-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                </div>
                <p class="text-[11px] text-zinc-300 leading-relaxed">
                  Se a lista parecer desatualizada, use o botão <strong class="text-white font-bold">Sincronizar</strong> no topo do site — não o botão "Sincronizar Lista" da aba Mural.
                </p>
              </div>

              <!-- Tip 2 -->
              <div class="flex gap-3 p-3.5 rounded-2xl transition-colors" style="background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.05);">
                <div class="w-6 h-6 rounded-xl shrink-0 flex items-center justify-center mt-0.5" style="background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.18);">
                  <svg class="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                  </svg>
                </div>
                <p class="text-[11px] text-zinc-300 leading-relaxed">
                  Se nem isso funcionar, <strong class="text-white font-bold">desconecte</strong> sua conta do Google e <strong class="text-white font-bold">reconecte</strong>.
                </p>
              </div>

              <!-- Tip 3 -->
              <div class="flex gap-3 p-3.5 rounded-2xl transition-colors" style="background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.05);">
                <div class="w-6 h-6 rounded-xl shrink-0 flex items-center justify-center mt-0.5" style="background: rgba(168,85,247,0.12); border: 1px solid rgba(168,85,247,0.18);">
                  <svg class="w-3.5 h-3.5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                  </svg>
                </div>
                <p class="text-[11px] text-zinc-300 leading-relaxed">
                  Não encontrou um jogo em <strong class="text-white font-bold">Miniaturas</strong>? Verifique se o <strong class="text-white font-bold">provedor</strong> e a <strong class="text-white font-bold">categoria (tag)</strong> estão corretos nos filtros, ou se o nome não está com erro de digitação.
                </p>
              </div>
            </div>

          </div>

          <!-- Footer -->
          <div class="px-5 py-3.5 border-t border-white/[0.04] flex items-center justify-center">
            <p class="text-[9px] text-zinc-700 font-bold uppercase tracking-widest">ThumbSync · Assistente do Desenvolvedor</p>
          </div>

        </div>
      </div>

      <!-- Image Preview Modal -->
      <div id="preview-modal" class="fixed inset-0 z-40 bg-black/80 backdrop-blur-md flex items-center justify-center pointer-events-none opacity-0 transition-all duration-300">
        <div class="w-[92%] max-w-sm bg-[#121215] border border-white/[0.08] p-5 sm:p-6 rounded-3xl shadow-[0_32px_80px_rgba(0,0,0,0.8)] scale-95 transition-transform duration-300 flex flex-col relative max-h-[85vh]">
          <button id="modal-close" class="absolute top-4 right-4 w-7 h-7 rounded-full bg-white/[0.05] hover:bg-white/[0.1] flex items-center justify-center cursor-pointer border border-white/5 z-10 transition-colors">
            <svg class="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          <div id="modal-content" class="flex flex-col h-full overflow-y-auto"></div>
        </div>
      </div>
    `;

    this.renderActiveTab();
    this.bindGlobalEvents();

    // Start the proactive assistant messages only once per page load
    if (!this._assistantStarted) {
      this._assistantStarted = true;
      this.startAssistantMessages();
    }
  }

  renderNavItem(tab, label, iconHtml, badgeHtml = '') {
    const isActive = this.state.activeTab === tab;
    return `
      <button data-tab="${tab}" class="flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold w-full transition-all cursor-pointer ${isActive ? 'bg-blue-600 text-white shadow-[0_8px_24px_rgba(37,99,235,0.3)] scale-[1.01]' : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]' }">
        ${iconHtml}
        <span>${label}</span>
        ${badgeHtml}
      </button>
    `;
  }

  renderMobileNavItem(tab, label, iconHtml) {
    const isActive = this.state.activeTab === tab;
    return `
      <button data-mobile-tab-btn data-tab="${tab}" class="flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-all text-center ${isActive ? 'text-blue-500' : 'text-zinc-500' }">
        <div class="px-3 py-1 rounded-full ${isActive ? 'bg-blue-500/10 text-blue-500' : 'text-zinc-400'}">
          ${iconHtml}
        </div>
        <span class="text-[9px] font-bold tracking-tight mt-0.5">${label}</span>
      </button>
    `;
  }

  renderActiveTab() {
    const contentFrame = document.getElementById('tab-content');
    if (!contentFrame) return;

    const loader = document.getElementById('gdrive-loader');
    if (loader) {
      if (this.state.isLoading) {
        loader.classList.remove('hidden');
        loader.classList.add('flex');
      } else {
        loader.classList.add('hidden');
        loader.classList.remove('flex');
      }
    }

    if (this.state.activeTab === 'catalog') {
      this.renderCatalog(contentFrame);
    } else if (this.state.activeTab === 'list_manager') {
      this.renderListManager(contentFrame);
    } else if (this.state.activeTab === 'settings') {
      this.renderSettings(contentFrame);
    }

    this.bindTabEvents();
  }

  /**
   * TELA CATALOGO / MINIATURAS
   */
  renderCatalog(container) {
    // Aplicar Filtros e Pesquisa
    let items = [...this.state.catalogItems];

    if (this.state.filterProvider !== 'todos') {
      items = items.filter(i => this.normalizeName(i.providerName) === this.normalizeName(this.state.filterProvider));
    }

    if (this.state.filterStatus !== 'todos') {
      if (this.state.filterStatus === 'com_arte') {
        items = items.filter(i => i.hasWebp);
      } else if (this.state.filterStatus === 'sem_arte') {
        items = items.filter(i => !i.hasWebp);
      } else if (this.state.filterStatus === 'listados') {
        items = items.filter(i => i.isListed);
      } else if (this.state.filterStatus === 'nao_listados') {
        items = items.filter(i => !i.isListed);
      }
    }

    if (this.state.filterTag !== 'todos') {
      if (this.state.filterTag === 'ao_vivo') {
        items = items.filter(i => this.getGameTag(i) === 'ao vivo');
      } else if (this.state.filterTag === 'slot') {
        items = items.filter(i => this.getGameTag(i) === 'slot');
      }
    }

    if (this.state.searchQuery.trim() !== '') {
      const q = this.normalizeName(this.state.searchQuery);
      items = items.filter(i => this.normalizeName(i.displayName).includes(q) || this.normalizeName(i.providerName).includes(q));
    }

    // Paginação: Limitar itens renderizados para performance
    const pageSize = 40;
    const totalItemsCount = items.length;
    const itemsToShow = items.slice(0, this.state.catalogPage * pageSize);

    // Estrutura Base (Skeleton) do Catálogo - renderizada apenas se necessário para evitar perda de foco no Input
    let resultsArea = container.querySelector('#catalog-results-area');
    
    if (!resultsArea) {
      const uniqueProviders = Array.from(new Set(this.state.catalogItems.map(i => i.providerName))).filter(Boolean).sort((a, b) => a.localeCompare(b));
      
      container.innerHTML = `
        <div class="space-y-6 text-left select-none relative">
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-white/[0.05]">
            <div>
              <h1 class="text-2xl font-black text-white tracking-tight">Miniaturas</h1>
              <p class="text-zinc-500 text-xs mt-0.5">Veja e gerencie as fotos .webp do seu catálogo geral no Google Drive.</p>
            </div>
          </div>

          <!-- Filtros -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white/[0.01] border border-white/[0.04] p-4 rounded-2xl">
            <div class="space-y-1">
              <label class="text-[10px] text-zinc-500 font-extrabold uppercase tracking-wider block">Procurar</label>
              <input type="text" id="catalouge-search" value="${this.state.searchQuery}" placeholder="Ex: Sweet Bonanza..." class="w-full bg-[#131317] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white outline-none focus:border-blue-500">
            </div>
            <div class="space-y-1">
              <label class="text-[10px] text-zinc-500 font-extrabold uppercase tracking-wider block">Filtrar por Provedor</label>
              <select id="catalouge-provider-filter" class="w-full bg-[#131317] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white outline-none">
                <option value="todos" class="bg-zinc-900 text-white" ${this.state.filterProvider === 'todos' ? 'selected' : ''}>Todos os Provedores</option>
                ${uniqueProviders.map(p => `
                  <option value="${p}" class="bg-zinc-900 text-white" ${this.state.filterProvider === p ? 'selected' : ''}>${p}</option>
                `).join('')}
              </select>
            </div>
            <div class="space-y-1">
              <label class="text-[10px] text-zinc-500 font-extrabold uppercase tracking-wider block">Categoria (Tag)</label>
              <select id="catalouge-tag-filter" class="w-full bg-[#131317] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white outline-none">
                <option value="todos" class="bg-zinc-900 text-white" ${this.state.filterTag === 'todos' ? 'selected' : ''}>Todas as Categorias</option>
                <option value="ao_vivo" class="bg-zinc-900 text-white" ${this.state.filterTag === 'ao_vivo' ? 'selected' : ''}>Ao Vivo</option>
                <option value="slot" class="bg-zinc-900 text-white" ${this.state.filterTag === 'slot' ? 'selected' : ''}>Slot</option>
              </select>
            </div>
          </div>

          <div id="catalog-results-area"></div>
        </div>
      `;
      resultsArea = container.querySelector('#catalog-results-area');
    }

    // Renderização Dinâmica apenas da Grade de Itens
    resultsArea.innerHTML = `
      ${items.length === 0 ? `
        <div class="py-20 text-center italic text-zinc-650 text-xs select-none">Nenhuma miniatura encontrada para os filtros selecionados.</div>
      ` : `
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
          ${itemsToShow.map(item => {
            const gradient = PROVIDER_GRADIENTS[item.providerName.toLowerCase()] || PROVIDER_GRADIENTS['default'];
            const hasWebp = item.hasWebp;
            const tag = this.getGameTag(item);
            const tagHtml = tag === "ao vivo" ? `
              <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[8px] font-extrabold uppercase tracking-wider bg-red-500/20 text-[#ff453a] border border-[#ff453a]/30 shadow-[0_2px_8px_rgba(255,69,58,0.15)] select-none">
                <span class="w-1 h-1 rounded-full bg-[#ff453a] animate-pulse"></span>
                Ao Vivo
              </span>
            ` : `
              <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[8px] font-extrabold uppercase tracking-wider bg-blue-500/20 text-[#0a84ff] border border-[#0a84ff]/30 select-none">
                <span class="w-1 h-1 rounded-full bg-[#0a84ff]"></span>
                Slot
              </span>
            `;

            return `
              <div data-catalog-key="${item.id}" class="group relative aspect-[2/3] rounded-2xl overflow-hidden bg-zinc-950 border border-white/[0.08] hover:border-white/20 shadow-md cursor-pointer transition-all transform hover:scale-[1.02]">
                ${hasWebp ? `
                  <img id="thumb-${item.id}" 
                       data-catalog-key="${item.id}" 
                       src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" 
                       alt="${item.displayName}" 
                       class="w-full h-full object-cover opacity-0 transition-opacity duration-500">
                ` : `
                  <div class="absolute inset-0 bg-gradient-to-tr from-neutral-900 to-neutral-800 flex flex-col justify-between p-4 text-left">
                    <div class="text-[8px] font-extrabold uppercase tracking-widest text-orange-400 bg-orange-400/5 border border-orange-400/10 px-2 py-0.5 rounded-full w-fit">
                      PENDENTE
                    </div>
                    <div class="space-y-1">
                      <span class="text-[8px] text-zinc-500 font-bold uppercase tracking-widest">${item.providerName}</span>
                      <h4 class="text-xs font-black text-white leading-tight">${item.displayName}</h4>
                      <span class="text-[7px] text-zinc-650 font-bold uppercase tracking-wider block">Falta arte (.webp)</span>
                    </div>
                  </div>
                `}

                <div class="absolute top-3 right-3 z-20">
                  ${tagHtml}
                </div>

                <div class="absolute inset-0 bg-gradient-to-t ${gradient} opacity-90"></div>
                
                ${hasWebp ? `
                  <div class="absolute inset-x-0 bottom-0 p-4 text-left z-10 leading-none">
                    <span class="text-[8px] text-zinc-400 font-black uppercase tracking-widest block">${item.providerName}</span>
                    <h4 class="text-xs font-black text-white leading-normal mt-0.5">${item.displayName}</h4>
                  </div>
                ` : ''}

                <div class="absolute inset-0 bg-blue-600/20 m-1 rounded-2xl border-2 border-dashed border-blue-500 flex flex-col items-center justify-center opacity-0 group-hover:pointer-events-none transition-opacity duration-300 pointer-events-none dropzone-indicator">
                  <svg class="w-7 h-7 text-white animate-bounce mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4 4m4-4v12" /></svg>
                  <span class="text-[9px] font-bold text-white uppercase tracking-wider text-center leading-tight">Solte Webp<br>para Upload</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
        ${totalItemsCount > itemsToShow.length ? `
          <div id="catalog-sentinel" class="col-span-full py-10 flex justify-center">
            <div class="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ` : ''}
      `}
    `;

    // Registrar Drag and Drop Eventos nos cartões
    const cardElements = container.querySelectorAll('[data-catalog-key]');
    cardElements.forEach(card => {
      const key = card.getAttribute('data-catalog-key');
      const item = this.state.catalogItems.find(i => i.id === key);
      if (!item) return;

      // Eventos de Drag
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dropZone = card.querySelector('.dropzone-indicator');
        if (dropZone) dropZone.classList.add('opacity-100');
      });

      card.addEventListener('dragleave', () => {
        const dropZone = card.querySelector('.dropzone-indicator');
        if (dropZone) dropZone.classList.remove('opacity-100');
      });

      card.addEventListener('drop', async (e) => {
        e.preventDefault();
        const dropZone = card.querySelector('.dropzone-indicator');
        if (dropZone) dropZone.classList.remove('opacity-100');

        if (this.state.useMock) {
          alert("Ação não permitida no modo de demonstração off-line. Ative e conecte seu Google Drive para fazer upload real de Webps!");
          return;
        }

        const files = e.dataTransfer.files;
        if (files.length === 0) return;

        const file = files[0];
        if (!file.name.toLowerCase().endsWith('.webp')) {
          alert("Formato incompatível! Por favor, envie apenas arquivos de imagem do formato .webp.");
          return;
        }

        // Fazer Upload
        this.addLog(`Preparando upload de '${file.name}' (${Math.round(file.size/1024)} KB) p/ Drive...`);
        this.state.isLoading = true;
        this.render();

        try {
          let targetFolderId = this.state.thumbsFolderId;
          const providerName = item.providerName || "Sem provedor";

          if (providerName && providerName !== "Sem provedor") {
            this.addLog(`Resolvendo pasta do provedor '${providerName}' no Drive...`);
            targetFolderId = await driveClient.findOrCreateSubfolder(providerName, this.state.thumbsFolderId);
          }

          const fileName = `${item.displayName}.webp`;

          // Fazer upload de imagem via Drive CLIENT
          const uploadedFile = await driveClient.uploadImage(fileName, file, targetFolderId);
          this.addLog(`Miniatura '${fileName}' enviada com sucesso ao Drive (Novo ID: ${uploadedFile.id.substring(0,8)}...)`);
          
          await this.syncWithGoogleDrive();
        } catch (uploadError) {
          this.addLog(`Incorreto ao enviar imagem: ${uploadError.message}`);
          alert(`Incompatibilidade no upload: ${uploadError.message}`);
        } finally {
          this.state.isLoading = false;
          this.render();
        }
      });
    });
  }

  /**
   * TELA DE GERENCIAMENTO DE LISTA.TXT (Mural)
   */
  renderListManager(container) {
    const listGames = [];
    const lines = this.state.listContent.split(/\r?\n/);
    
    let currentProvider = "Sem provedor";
    for (const line of lines) {
      const clean = line.replace(/^\uFEFF/, '').replace(/^\s*(?:[-*•]\s+|\d+\s*[\).\]-]\s*)/, '').trim();
      if (!clean || clean.startsWith('#') || clean.includes('?')) continue;

      const providerMatch = clean.match(/^provedor\s*:\s*(.+)$/i);
      if (providerMatch) {
         currentProvider = providerMatch[1].trim();
         continue;
      }
      
      if (/^provedor\s*:/i.test(clean)) continue;

      listGames.push({
        displayName: clean,
        normalizedName: this.normalizeName(clean),
        providerName: currentProvider
      });
    }

    const groupsMap = new Map();
    listGames.forEach(g => {
      const arr = groupsMap.get(g.providerName) || [];
      arr.push(g);
      groupsMap.set(g.providerName, arr);
    });

    const groupsList = Array.from(groupsMap.entries());

    // Combinar provedores para exibir como opções no modal de adicionar jogo
    const modalProvidersSet = new Set();
    
    // 1. Dos grupos do lista.txt
    groupsList.forEach(([prov]) => {
      if (prov && prov !== "Sem provedor") {
        modalProvidersSet.add(prov);
      }
    });

    // 2. Das subpastas físicas sincronizadas do Drive
    if (this.state.driveProviders && this.state.driveProviders.length > 0) {
      this.state.driveProviders.forEach(p => {
        if (p && p !== "Sem provedor") {
          modalProvidersSet.add(p);
        }
      });
    }

    // 3. Dos arquivos que contêm provedores definidos
    if (this.state.driveFiles) {
      this.state.driveFiles.forEach(f => {
        if (f.providerName && f.providerName !== "Sem provedor") {
          modalProvidersSet.add(f.providerName);
        }
      });
    }

    if (modalProvidersSet.size === 0) {
      modalProvidersSet.add("PG Soft");
      modalProvidersSet.add("Pragmatic Play");
    }

    const modalProvidersList = Array.from(modalProvidersSet).sort((a, b) => a.localeCompare(b));

    container.innerHTML = `
      <div class="space-y-6 text-left select-none relative">
        <div class="flex flex-col sm:flex-row justify-between gap-3 sm:items-center pb-2 border-b border-white/[0.05]">
          <div>
            <h1 class="text-2xl font-black text-white tracking-tight">Gerenciador de lista.txt</h1>
            <p class="text-zinc-500 text-xs mt-0.5">Defina novos jogos e gerencie o catálogo gravado no repositório.</p>
          </div>
          <div class="flex flex-wrap sm:flex-nowrap items-center gap-2 self-start sm:self-auto shrink-0 select-none">
            <button id="btn-sync-list-only" class="flex items-center justify-center w-9 h-9 sm:w-auto sm:h-auto sm:py-2 sm:px-3.5 rounded-xl bg-emerald-600/[0.15] hover:bg-emerald-600/25 text-[#10b981] border border-emerald-500/20 shadow-sm transition-all cursor-pointer active:scale-95 shrink-0" title="Sincronizar Lista">
              ${this.state.isLoading ? `
                <svg id="sync-list-icon" class="w-3.5 h-3.5 animate-spin text-[#10b981] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <g transform="translate(12,12)">
                    <line x1="0" y1="-7" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="1" />
                    <line x1="0" y1="-7" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.875" transform="rotate(45)" />
                    <line x1="0" y1="-7" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.75" transform="rotate(90)" />
                    <line x1="0" y1="-7" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.625" transform="rotate(135)" />
                    <line x1="0" y1="-7" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.5" transform="rotate(180)" />
                    <line x1="0" y1="-7" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.375" transform="rotate(225)" />
                    <line x1="0" y1="-7" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.25" transform="rotate(270)" />
                    <line x1="0" y1="-7" x2="0" y2="-4" stroke-width="2.5" stroke-linecap="round" opacity="0.125" transform="rotate(315)" />
                  </g>
                </svg>
              ` : `
                <svg id="sync-list-icon" class="w-3.5 h-3.5 text-[#10b981] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              `}
              <span class="hidden sm:inline ml-1.5 text-xs font-bold">Sincronizar Lista</span>
            </button>
            <button id="btn-clear-finished" class="flex items-center justify-center w-9 h-9 sm:w-auto sm:h-auto sm:py-2 sm:px-3.5 rounded-xl bg-orange-600/[0.15] hover:bg-orange-600/25 text-[#f59e0b] border border-orange-500/20 shadow-sm transition-all cursor-pointer active:scale-95 shrink-0" title="Limpar Jogos Feitos">
              <svg class="w-3.5 h-3.5 text-[#f59e0b] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142a2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span class="hidden sm:inline ml-1.5 text-xs font-bold">Limpar Jogos Feitos</span>
            </button>
            <button id="btn-delete-selected" class="${this.state.selectedListKeys.size > 0 ? 'flex' : 'hidden'} items-center justify-center w-9 h-9 sm:w-auto sm:h-auto sm:py-2 sm:px-3.5 rounded-xl bg-red-600/[0.15] hover:bg-red-600/25 text-red-500 border border-red-500/20 shadow-sm transition-all cursor-pointer active:scale-95 shrink-0" title="Excluir Selecionados">
              <svg class="w-3.5 h-3.5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142a2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span class="hidden sm:inline ml-1.5 text-xs font-bold">Excluir Selecionados</span>
              <span class="bg-red-500/25 text-red-500 sm:bg-red-500/10 sm:text-red-500 text-[9px] px-1.5 py-0.5 rounded-full font-bold ml-1" id="selected-count-badge">
                <span id="selected-count">${this.state.selectedListKeys.size}</span>
              </span>
            </button>
            <button id="btn-add-provider" class="flex items-center justify-center w-9 h-9 sm:w-auto sm:h-auto sm:py-2 sm:px-3.5 rounded-xl bg-white/[0.03] text-white hover:bg-white/[0.06] border border-white/[0.06] transition-all cursor-pointer active:scale-95 shrink-0" title="Novo Provedor">
              <svg class="w-3.5 h-3.5 text-zinc-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
              <span class="hidden sm:inline ml-1.5 text-xs font-bold">Novo Provedor</span>
            </button>
            <button id="btn-add-games-main" class="flex items-center justify-center py-2 px-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white border border-blue-500/20 transition-all cursor-pointer active:scale-95 shrink-0" title="Adicionar Jogos">
              <svg class="w-3.5 h-3.5 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
              <span class="inline-block ml-1.5 text-xs font-bold">Adicionar<span class="hidden sm:inline"> Jogos</span></span>
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div class="lg:col-span-2 space-y-4">
            ${groupsList.length === 0 ? `
              <div class="py-24 text-center italic text-zinc-600 text-xs">Nenhum provedor cadastrado ainda. Crie um novo provedor acima.</div>
            ` : `
              ${groupsList.map(([providerName, games]) => `
                <div class="rounded-2xl border border-white/[0.05] bg-white/[0.01] divide-y divide-white/[0.03]">
                  <div class="flex justify-between items-center px-4 py-3 hover:bg-white/[0.02]">
                    <span class="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                      <span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                      ${providerName}
                    </span>
                    <div class="flex items-center gap-2">
                      <span class="text-[9px] bg-white/5 border border-white/10 px-2 py-0.5 rounded-full text-zinc-400 font-bold">
                        ${games.length} jogos
                      </span>
                      <button data-trigger-add-game="${providerName}" class="w-6.5 h-6.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/15 flex items-center justify-center cursor-pointer">
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
                      </button>
                    </div>
                  </div>

                  <div class="p-2 bg-[#09090c]/40 space-y-1.5">
                    ${games.map(game => {
                      const key = `${this.normalizeName(game.providerName)}::${game.normalizedName}`;
                      const catalogItem = this.state.catalogItems.find(i => i.id === key);
                      const hasWebp = catalogItem?.hasWebp || false;

                      return `
                        <div class="flex justify-between items-center py-2 px-3 text-sm rounded-lg hover:bg-white/[0.01] leading-none">
                          <div class="flex items-center gap-2.5">
                            <input type="checkbox" data-select-key="${key}" ${this.state.selectedListKeys.has(key) ? 'checked' : ''} class="game-selector w-3.5 h-3.5 rounded border-white/10 bg-white/5 checked:bg-blue-600 cursor-pointer">
                            <span class="w-1 h-1 rounded-full ${hasWebp ? 'bg-[#10b981]' : 'bg-[#f59e0b]'}"></span>
                            <span class="text-xs font-medium text-zinc-100">${game.displayName}</span>
                            <span class="text-[7.5px] font-extrabold tracking-wider px-1 py-0.2 rounded-md ${hasWebp ? 'bg-[#10b981]/10 text-[#10b981]' : 'bg-[#f59e0b]/10 text-[#f59e0b]'}">
                              ${hasWebp ? '.WEBP OK' : 'SEM IMAGEM'}
                            </span>
                          </div>
                          <button data-delete-catalog-key="${key}" class="w-7 h-7 rounded-lg bg-red-500/5 hover:bg-red-500/15 border border-red-500/10 flex items-center justify-center cursor-pointer text-red-400 transition-colors">
                            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      `;
                    }).join('')}
                  </div>
                </div>
              `).join('')}
            `}
          </div>

          <!-- Raw Live File Preview -->
          <div class="rounded-3xl bg-neutral-950 border border-white/[0.05] p-6 flex flex-col justify-between h-fit">
            <div class="space-y-3">
              <span class="text-[9px] text-blue-500 font-extrabold uppercase tracking-widest block leading-none">Visão Direta</span>
              <h3 class="text-sm font-black text-white tracking-normal mt-1 block">Bruto de lista.txt</h3>
              <p class="text-[10px] text-zinc-500 leading-normal">O formato real do arquivo txt sincronizado que o seu sistema de miniaturas local lê para carregar os nomes correspondentes.</p>
              
              <pre class="bg-[#0c0c0e] border border-white/[0.04] p-4 rounded-xl text-[10px] font-mono text-zinc-400 overflow-x-auto max-h-[300px] leading-relaxed custom-scrollbar select-text">${this.state.listContent}</pre>
            </div>
          </div>
        </div>
      </div>

      <!-- Add Game Modal -->
      ${this.state.isAddingGame ? `
        <div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center">
          <div class="w-[90%] max-w-sm bg-[#131316] border border-white/[0.08] p-6 rounded-3xl shadow-2xl flex flex-col">
            <h3 class="text-sm font-black text-white uppercase tracking-wider mb-4 leading-none font-sans">Adicionar Jogos</h3>
            
            <div class="mb-4 text-left">
              <label class="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1 block">Selecione o Provedor</label>
              <select id="modal-add-game-provider-select" class="w-full bg-[#1c1c22] border border-white/10 rounded-xl px-3 py-2 text-xs text-white">
                ${modalProvidersList.map(prov => `
                  <option value="${prov}" ${prov === this.state.addingGameToProvider ? 'selected' : ''}>${prov}</option>
                `).join('')}
              </select>
            </div>

            <div class="mb-5 text-left">
              <label class="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1 block">Nomes dos Jogos (Um por linha)</label>
              <textarea id="new-game-displayNames" placeholder="Fortune Rabbit&#10;Gates of Olympus&#10;Sweet Bonanza" class="w-full bg-[#1c1c22] border border-white/10 rounded-xl px-3 py-2 text-xs text-white min-h-[100px] leading-relaxed outline-none focus:border-blue-500"></textarea>
            </div>
            
            <div class="flex items-center gap-3">
              <button id="modal-add-game-cancel" class="flex-1 py-2 px-4 rounded-xl bg-white/5 border border-white/5 text-zinc-300 font-semibold text-xs hover:bg-white/10 cursor-pointer">Cancelar</button>
              <button id="modal-add-game-confirm" class="flex-1 py-2 px-4 rounded-xl bg-blue-600 text-white font-semibold text-xs hover:bg-blue-700 cursor-pointer">Adicionar</button>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Add Provider Modal -->
      <div id="add-provider-dialog" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center hidden">
        <div class="w-[90%] max-w-sm bg-[#131316] border border-white/[0.08] p-6 rounded-3xl shadow-2xl flex flex-col">
          <h3 class="text-sm font-black text-white uppercase tracking-wider mb-2 leading-none">Novo Provedor</h3>
          <p class="text-[10px] text-zinc-500 mb-4 leading-normal">Insira o nome do Provedor para criar uma nova seção no seu arquivo lista.txt.</p>
          
          <input type="text" id="new-provider-name" placeholder="Ex: PG Soft, Pragmatic Play" class="w-full bg-[#1c1c22] border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-blue-500 mb-5">
          
          <div class="flex items-center gap-3">
            <button id="dialog-add-provider-cancel" class="flex-1 py-2 px-4 rounded-xl bg-white/5 border border-white/5 text-zinc-300 font-semibold text-xs hover:bg-white/10 cursor-pointer">Cancelar</button>
            <button id="dialog-add-provider-confirm" class="flex-1 py-2 px-4 rounded-xl bg-blue-600 text-white font-semibold text-xs hover:bg-blue-700 cursor-pointer">Criar Seção</button>
          </div>
        </div>
      </div>
    `;
  }



  /**
   * TELA CONFIGURAÇÃO (GOOGLE CLIENT ID)
   */
  renderSettings(container) {
    container.innerHTML = `
      <div class="space-y-6 text-left select-none">
        <div class="pb-2 border-b border-white/[0.05]">
          <h1 class="text-2xl font-black text-white tracking-tight">Ajustes de Integração</h1>
          <p class="text-zinc-500 text-xs mt-0.5">Siga os passos e insira as credenciais geradas no Google Developers Console.</p>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          <div class="lg:col-span-2 space-y-6">
            <!-- Google Login Card in Settings for Mobile & Desktop -->
            <div class="rounded-3xl bg-white/[0.015] border border-white/[0.05] p-6 space-y-4">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="w-9 h-9 rounded-xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-500 shadow-sm">
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                    </svg>
                  </div>
                  <div>
                    <h3 class="text-xs font-black text-white uppercase tracking-wider">Conta do Google</h3>
                    <span class="text-[10px] text-zinc-500 font-bold uppercase tracking-wider block mt-0.5">Sincronização Nuvem</span>
                  </div>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="w-2.5 h-2.5 rounded-full ${this.state.gdriveConnected ? 'bg-[#10b981] shadow-[0_0_8px_#10b981]' : 'bg-[#f59e0b] shadow-[0_0_8px_#f59e0b]'}"></span>
                  <span class="text-xs font-bold text-zinc-400">
                    ${this.state.gdriveConnected ? 'Conectado' : 'Desconectado'}
                  </span>
                </div>
              </div>

              ${this.state.gdriveConnected ? `
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-neutral-900/60 border border-white/[0.04] p-4 rounded-xl leading-relaxed">
                  <div class="min-w-0">
                    <p class="text-xs font-bold text-white">Google Drive Sincronizando</p>
                    <p class="text-[10px] text-zinc-400 font-semibold leading-relaxed mt-0.5 max-w-md">Seu catálogo e arquivo de lista (lista.txt) estão sendo salvos com segurança em sua própria pasta na nuvem.</p>
                  </div>
                  <button class="btn-logout-action flex items-center justify-center gap-2 text-xs font-bold py-2.5 px-4 text-center rounded-xl text-red-400 hover:bg-red-500/10 transition-colors border border-red-500/15 cursor-pointer shrink-0">
                    Sair do Google Drive
                  </button>
                </div>
              ` : `
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-neutral-900/60 border border-white/[0.04] p-4 rounded-xl leading-relaxed">
                  <div class="max-w-md">
                    <p class="text-xs font-bold text-white">Nenhum Drive Conectado</p>
                    <p class="text-[10px] text-zinc-500 font-medium leading-relaxed mt-0.5">Inicie sessão para enviar suas imagens reais (.webp) e alterar o arquivo lista.txt direto na sua conta do Drive.</p>
                  </div>
                  <button class="btn-login-action flex items-center justify-center gap-2.5 text-xs font-black bg-white text-black hover:bg-neutral-100 py-2.5 px-4 rounded-xl shadow-md transition-all cursor-pointer shrink-0">
                    <svg class="w-4 h-4 shrink-0" viewBox="0 0 48 48" style="display: block;">
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                    </svg>
                    <span>Entrar com o Google</span>
                  </button>
                </div>
              `}
            </div>

            <div class="rounded-3xl bg-white/[0.01] border border-white/[0.04] p-6 space-y-5 h-fit">
              <h3 class="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                <span class="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]"></span>
                Parâmetros de Integração
              </h3>

              <div class="space-y-1.5">
                <div class="flex justify-between items-center text-xs font-semibold">
                  <label for="conf-clientId" class="text-zinc-300">Google Client ID (OAuth 2.0)</label>
                  <a href="https://console.cloud.google.com/" target="_blank" class="text-blue-500 hover:underline">Google Cloud Console</a>
                </div>
                <input type="text" id="conf-clientId" value="${this.config.clientId}" placeholder="Faltando credencial client_id.apps.googleusercontent.com" class="w-full bg-[#131317] border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-blue-500">
                
                <!-- Aviso de Cuidado / Segurança iOS Callout -->
                <div id="client-id-warning" class="flex items-start gap-2.5 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[10px] leading-normal font-sans">
                  <svg class="w-4 h-4 shrink-0 text-amber-400 mt-0.5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <span class="font-bold block text-amber-400 mb-0.5">⚠️ CUIDADO COM ALTERAÇÕES</span>
                    <span>Este ID está pré-configurado com a credencial segura e homologada da aplicação. Se você alterar ou remover este valor, as conexões com o Google Drive poderão falhar ou apresentar erros críticos de autenticação de origem.</span>
                  </div>
                </div>

                <p class="text-[9px] text-zinc-500 font-medium leading-normal">Seu Client ID do aplicativo Web. Google Auth requer que você adicione esta URL nas Origens JavaScript Autorizadas do seu ID de Cliente.</p>
              </div>

              <div class="space-y-1.5">
                <label for="conf-folder" class="text-xs font-semibold text-zinc-300">Pasta no Google Drive</label>
                <input type="text" id="conf-folder" value="${this.config.folderName}" placeholder="e.g. Thumbs" class="w-full bg-[#131317] border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-blue-500">
                <p class="text-[9px] text-zinc-500 font-medium leading-normal">As imagens .webp e o arquivo de texto serão criados/salvos diretamente nesta pasta em formato absoluto.</p>
              </div>

              <div class="space-y-1.5">
                <label for="conf-file" class="text-xs font-semibold text-zinc-300">Nome do arquivo da lista</label>
                <input type="text" id="conf-file" value="${this.config.listFileName}" placeholder="e.g. lista.txt" class="w-full bg-[#131317] border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-blue-500">
              </div>

              <div class="flex items-center gap-3 pt-2">
                <button id="btn-save-config" class="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs cursor-pointer select-none">
                  Salvar Configurações
                </button>
              </div>
            </div>
          </div>

          <!-- Tutorial de GDrive ID -->
          <div class="rounded-3xl bg-[#09090b] border border-white/[0.05] p-6 flex flex-col justify-between">
            <div class="space-y-4">
              <span class="text-[9px] text-emerald-400 font-extrabold uppercase tracking-widest block leading-none">Passo a Passo</span>
              <h3 class="text-sm font-black text-white tracking-normal block leading-tight">Como configurar o Google Drive</h3>

              <div class="space-y-3.5 text-xs text-zinc-400 leading-normal max-h-[350px] overflow-y-auto pr-1">
                <div class="flex gap-2.5">
                  <span class="w-4.5 h-4.5 rounded-full bg-zinc-900 border border-white/5 shrink-0 flex items-center justify-center font-bold text-[9px] text-white">1</span>
                  <p class="text-[10px]">Crie um projeto no <strong>Google Cloud Console</strong>.</p>
                </div>
                <div class="flex gap-2.5">
                  <span class="w-4.5 h-4.5 rounded-full bg-zinc-900 border border-white/5 shrink-0 flex items-center justify-center font-bold text-[9px] text-white">2</span>
                  <p class="text-[10px]">Ative a API do <strong>Google Drive API</strong> na biblioteca.</p>
                </div>
                <div class="flex gap-2.5">
                  <span class="w-4.5 h-4.5 rounded-full bg-zinc-900 border border-white/5 shrink-0 flex items-center justify-center font-bold text-[9px] text-white">3</span>
                  <p class="text-[10px]">Na <strong>Tela de Consentimento OAuth</strong>, configure como Externo e adicione o escopo <code>.../auth/drive</code>.</p>
                </div>
                <div class="flex gap-2.5">
                  <span class="w-4.5 h-4.5 rounded-full bg-zinc-900 border border-white/5 shrink-0 flex items-center justify-center font-bold text-[9px] text-white">4</span>
                  <p class="text-[10px]">No menu <strong>Credenciais</strong>, crie um <strong>ID do cliente OAuth</strong> para "Aplicativo da Web". Em "Origens JavaScript autorizadas", insira o endereço exato que você vê no navegador (ex: <code>${window.location.origin}</code>) e salve.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderPreviewModal(item) {
    const modal = document.getElementById('preview-modal');
    const content = document.getElementById('modal-content');
    if (!modal || !content) return;

    modal.classList.remove('pointer-events-none', 'opacity-0');
    const child = modal.firstElementChild;
    if (child) child.classList.remove('scale-95');

    const fileSizeStr = item.fileSize ? `${Math.round(Number(item.fileSize) / 1024)} KB` : 'Indeterminado';
    const modifiedStr = item.modifiedTime ? new Date(item.modifiedTime).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', hour: '2-digit', minute:'2-digit' }) : 'Simulado / Local';

    const pBadgeStyle = PROVIDER_BADGE_STYLE[item.providerName.toLowerCase()] || PROVIDER_BADGE_STYLE['default'];
    const currentTag = this.getGameTag(item);

    content.innerHTML = `
      <div class="flex flex-col gap-5 pt-4 text-left relative h-full">
        <div class="relative w-full aspect-[2/3] rounded-2xl overflow-hidden bg-neutral-950 border border-white/5 shadow-inner">
          <img id="modal-img-preview" src="" alt="${item.displayName}" class="w-full h-full object-cover">
          <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent"></div>
        </div>

        <div class="space-y-1 leading-none select-none">
          <span class="text-[9px] font-black uppercase tracking-widest ${pBadgeStyle} px-2.5 py-0.5 rounded block w-fit h-fit">${item.providerName}</span>
          <h2 class="text-base font-black text-white leading-normal mt-1 block">${item.displayName}</h2>
        </div>

        <div class="divide-y divide-white/[0.05] border-t border-b border-white/[0.05] py-1.5 text-[11px] text-zinc-400 select-none">
          <div class="flex justify-between py-1.5">
            <span>Listado em lista.txt:</span>
            <span class="text-white font-bold">${item.isListed ? 'Sim, Ativo' : 'Não, avulso'}</span>
          </div>
          <div class="flex justify-between py-1.5">
            <span>Tamanho do Arquivo:</span>
            <span class="text-white font-bold font-mono">${fileSizeStr}</span>
          </div>
          <div class="flex justify-between py-1.5">
            <span>Sincronizado:</span>
            <span class="text-zinc-300 font-bold font-mono">${modifiedStr}</span>
          </div>
        </div>

        <!-- Categoria do Jogo com controles de tag personalizados (iOS / Mac 2026 Style) -->
        <div class="space-y-1.5 select-none">
          <label class="text-[10px] text-zinc-500 font-extrabold uppercase tracking-wider block">Categoria do Jogo (Tag)</label>
          <div class="flex gap-2 p-1 bg-white/[0.03] border border-white/[0.05] rounded-xl">
            ${this.state.isSavingTag ? `
              <div class="flex-1 py-1.5 flex items-center justify-center gap-2 text-[10px] font-bold text-zinc-500 animate-pulse">
                <svg class="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" /></svg>
                SALVANDO...
              </div>
            ` : `
            <button id="tag-btn-ao-vivo" data-tag-value="ao vivo" class="flex-1 py-1.5 px-3 rounded-lg text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${currentTag === 'ao vivo' ? 'bg-[#ff453a]/20 text-[#ff453a] border border-[#ff453a]/30 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}">
              <span class="w-1.5 h-1.5 rounded-full bg-[#ff453a] ${currentTag === 'ao vivo' ? 'animate-pulse' : ''}"></span>
              Ao Vivo
            </button>
            <button id="tag-btn-slot" data-tag-value="slot" class="flex-1 py-1.5 px-3 rounded-lg text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${currentTag === 'slot' ? 'bg-[#0a84ff]/20 text-[#0a84ff] border border-[#0a84ff]/30 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}">
              <span class="w-1.5 h-1.5 rounded-full bg-[#0a84ff]"></span>
              Slot
            </button>
            `}
          </div>
        </div>

        <div class="flex flex-col gap-2 select-none mt-auto pb-2">
          <button id="modal-action-download" class="w-full py-2 px-4 rounded-xl bg-blue-600 text-white font-bold text-xs hover:bg-blue-700 flex items-center justify-center gap-1.5 cursor-pointer">
            <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            <span>Baixar Miniatura (.webp)</span>
          </button>
        </div>
      </div>
    `;

    const previewImg = document.getElementById('modal-img-preview');
    if (previewImg) {
      this.loadThumbnailSrc(item, previewImg);
    }

    const btnDownload = document.getElementById('modal-action-download');
    if (btnDownload) {
      btnDownload.addEventListener('click', () => {
        this.handleDownloadFile(item);
      });
    }

    const tagLiveBtn = document.getElementById('tag-btn-ao-vivo');
    const tagSlotBtn = document.getElementById('tag-btn-slot');
    
    if (tagLiveBtn) {
      tagLiveBtn.addEventListener('click', () => {
        this.updateGameTag(item.id, 'ao vivo');
      });
    }
    if (tagSlotBtn) {
      tagSlotBtn.addEventListener('click', () => {
        this.updateGameTag(item.id, 'slot');
      });
    }
  }

  closePreviewModal() {
    const modal = document.getElementById('preview-modal');
    if (!modal) return;
    modal.classList.add('pointer-events-none', 'opacity-0');
    const child = modal.firstElementChild;
    if (child) child.classList.add('scale-95');
  }

  // ----------------------------------------------------------------
  // PROACTIVE CHAT BUBBLE — messages that auto-appear from the bot
  // ----------------------------------------------------------------

  startAssistantMessages() {
    // Create the floating chat bubble element once, attached to body
    // so it survives full re-renders of root.innerHTML.
    if (!document.getElementById('assistant-chat-bubble')) {
      const el = document.createElement('div');
      el.id = 'assistant-chat-bubble';
      el.setAttribute('role', 'status');
      el.className = 'fixed z-[60] bottom-[8.75rem] right-4 lg:bottom-[5.25rem] lg:right-6 w-[calc(100vw-5rem)] max-w-[272px] pointer-events-none opacity-0 translate-y-3 transition-all duration-500 ease-out select-none';
      el.innerHTML = `
        <div class="relative rounded-2xl rounded-br-sm shadow-[0_24px_64px_rgba(0,0,0,0.75)]" style="background:rgba(22,22,28,0.97);backdrop-filter:blur(24px) saturate(1.8);-webkit-backdrop-filter:blur(24px) saturate(1.8);border:1px solid rgba(255,255,255,0.1);">
          <button id="chat-bubble-close" tabindex="0" aria-label="Fechar dica" class="absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center cursor-pointer transition-colors hover:bg-white/15" style="background:rgba(255,255,255,0.07);">
            <svg class="w-2.5 h-2.5" style="color:#71717a" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          <div class="p-4 pr-9 flex gap-3 items-start">
            <div id="chat-bubble-icon" class="w-7 h-7 rounded-xl shrink-0 flex items-center justify-center mt-0.5"></div>
            <div>
              <p class="text-[9px] font-black uppercase tracking-widest mb-1" style="color:#52525b;">Assistente ThumbSync</p>
              <p id="chat-bubble-text" class="text-[11.5px] leading-relaxed font-medium" style="color:#d4d4d8;"></p>
            </div>
          </div>
        </div>
        <div class="absolute -bottom-[5px] right-[1.375rem] w-2.5 h-2.5 rotate-45" style="background:rgba(22,22,28,0.97);border-right:1px solid rgba(255,255,255,0.1);border-bottom:1px solid rgba(255,255,255,0.1);"></div>
      `;
      document.body.appendChild(el);

      const closeBtn = document.getElementById('chat-bubble-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._chatSkipRemaining = true;
          this.hideChatBubble();
        });
      }
    }

    const MESSAGES = [
      {
        bgStyle: 'background:rgba(234,179,8,0.15);border:1px solid rgba(234,179,8,0.3);',
        iconHtml: `<svg class="w-3.5 h-3.5" style="color:#fbbf24" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>`,
        text: 'Lembre-se: sempre utilize a <strong style="color:#fcd34d;font-weight:900;">mesma conta Google</strong> ao acessar o site, como medida de segurança.',
        duration: 10000
      },
      {
        bgStyle: 'background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);',
        iconHtml: `<svg class="w-3.5 h-3.5" style="color:#60a5fa" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>`,
        text: 'Lista desatualizada? Use o botão <strong style="color:#fff;font-weight:900;">Sincronizar</strong> no topo — não o "Sincronizar Lista" da aba Mural.',
        duration: 9000
      },
      {
        bgStyle: 'background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.25);',
        iconHtml: `<svg class="w-3.5 h-3.5" style="color:#34d399" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" /></svg>`,
        text: 'Sincronização travou? <strong style="color:#fff;font-weight:900;">Desconecte</strong> sua conta do Google e <strong style="color:#fff;font-weight:900;">reconecte</strong>.',
        duration: 9000
      },
      {
        bgStyle: 'background:rgba(168,85,247,0.12);border:1px solid rgba(168,85,247,0.25);',
        iconHtml: `<svg class="w-3.5 h-3.5" style="color:#c084fc" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>`,
        text: 'Não achou um jogo? Confira o <strong style="color:#fff;font-weight:900;">provedor</strong> e a <strong style="color:#fff;font-weight:900;">categoria</strong> nos filtros de Miniaturas.',
        duration: 9000
      },
    ];

    let index = 0;
    this._chatSkipRemaining = false;

    const showNext = () => {
      if (index >= MESSAGES.length || this._chatSkipRemaining) return;

      const panel = document.getElementById('assistant-panel');
      const panelIsOpen = panel && !panel.classList.contains('opacity-0');
      const msg = MESSAGES[index];
      index++;

      if (!panelIsOpen) {
        this.showChatBubble(msg);
      }

      const displayTime = panelIsOpen ? 0 : msg.duration;
      this._chatHideTimer = setTimeout(() => {
        this.hideChatBubble(() => {
          if (index < MESSAGES.length && !this._chatSkipRemaining) {
            this._chatNextTimer = setTimeout(showNext, 2800);
          }
        });
      }, displayTime);
    };

    // First message appears after 4 seconds
    this._chatNextTimer = setTimeout(showNext, 4000);
  }

  showChatBubble(msg) {
    const bubble = document.getElementById('assistant-chat-bubble');
    const iconEl  = document.getElementById('chat-bubble-icon');
    const textEl  = document.getElementById('chat-bubble-text');
    if (!bubble || !iconEl || !textEl) return;

    iconEl.setAttribute('style', msg.bgStyle);
    iconEl.innerHTML = msg.iconHtml;
    textEl.innerHTML = msg.text;

    // Trigger reflow so the transition animates from initial state
    void bubble.offsetWidth;
    bubble.classList.remove('opacity-0', 'translate-y-3', 'pointer-events-none');
    bubble.classList.add('opacity-100', 'translate-y-0', 'pointer-events-auto');
  }

  hideChatBubble(callback) {
    const bubble = document.getElementById('assistant-chat-bubble');
    if (!bubble) { if (callback) callback(); return; }

    bubble.classList.add('opacity-0', 'translate-y-3', 'pointer-events-none');
    bubble.classList.remove('opacity-100', 'translate-y-0', 'pointer-events-auto');
    if (callback) setTimeout(callback, 520);
  }

  // ----------------------------------------------------------------

  toggleAssistant(forceClose = false) {
    const panel = document.getElementById('assistant-panel');
    if (!panel) return;

    const isOpen = !panel.classList.contains('opacity-0');

    if (forceClose || isOpen) {
      panel.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
    } else {
      panel.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');

      // Mark as opened — remove the pulsing notification dot permanently
      if (!localStorage.getItem('thumbsync_assistant_opened')) {
        localStorage.setItem('thumbsync_assistant_opened', 'true');
        const dot = document.querySelector('#assistant-bubble span.animate-ping')?.closest('span.flex');
        if (dot) dot.remove();
      }
    }
  }

  bindGlobalEvents() {
    const navButtons = document.querySelectorAll('aside nav button, [data-mobile-tab-btn]');
    navButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.getAttribute('data-tab');
        if (tab) {
          this.setActiveTab(tab);
        }
      });
    });

    const btnSync = document.getElementById('btn-sync-gdrive');
    if (btnSync) {
      btnSync.addEventListener('click', () => {
        this.syncWithGoogleDrive();
      });
    }

    const btnLogin = document.getElementById('btn-login');
    if (btnLogin) {
      btnLogin.addEventListener('click', () => {
         this.handleGoogleLogin();
      });
    }

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', () => {
         this.handleGoogleLogout();
      });
    }

    const modal = document.getElementById('preview-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closePreviewModal();
        }
      });
    }

    const btnCloseModal = document.getElementById('modal-close');
    if (btnCloseModal) {
      btnCloseModal.addEventListener('click', () => {
        this.closePreviewModal();
      });
    }
    // ---- ASSISTANT WIDGET EVENTS ----
    const assistantBubble = document.getElementById('assistant-bubble');
    const assistantClose = document.getElementById('assistant-close');

    if (assistantBubble) {
      assistantBubble.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleAssistant();
      });
    }

    if (assistantClose) {
      assistantClose.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleAssistant(true);
      });
    }

    // Close panel when clicking outside of it
    document.addEventListener('click', (e) => {
      const panel = document.getElementById('assistant-panel');
      const bubble = document.getElementById('assistant-bubble');
      if (
        panel &&
        !panel.classList.contains('opacity-0') &&
        !panel.contains(e.target) &&
        bubble && !bubble.contains(e.target)
      ) {
        this.toggleAssistant(true);
      }
    }, { capture: false });
  }

  bindTabEvents() {
    // EVENTS DE CATALOGO - Otimizado com proteção de foco e debounce
    if (this.state.activeTab === 'catalog') {
      const searchInput = document.getElementById('catalouge-search');
      const providerSelect = document.getElementById('catalouge-provider-filter');
      const tagSelect = document.getElementById('catalouge-tag-filter');

      this.observers.forEach(obs => obs.disconnect());
      this.observers = [];

      if (searchInput && !searchInput.dataset.bound) {
        searchInput.dataset.bound = "true";
        searchInput.addEventListener('input', (e) => {
          clearTimeout(this.debounceTimer);
          this.state.searchQuery = e.currentTarget.value;
          this.state.catalogPage = 1;
          this.debounceTimer = setTimeout(() => this.renderActiveTab(), 300);
        });
      }

      if (providerSelect && !providerSelect.dataset.bound) {
        providerSelect.dataset.bound = "true";
        providerSelect.addEventListener('change', (e) => {
          this.state.filterProvider = e.currentTarget.value;
          this.state.catalogPage = 1;
          this.renderActiveTab();
        });
      }

      if (tagSelect && !tagSelect.dataset.bound) {
        tagSelect.dataset.bound = "true";
        tagSelect.addEventListener('change', (e) => {
          this.state.filterTag = e.currentTarget.value;
          this.state.catalogPage = 1;
          this.saveStateToStorage();
          this.renderActiveTab();
        });
      }

       const cardElements = document.querySelectorAll('[data-catalog-key]');
       cardElements.forEach(card => {
         card.addEventListener('click', (e) => {
           if (e.target.closest('.dropzone-indicator')) return; // ignore dropzone zone clicks
           const key = e.currentTarget.getAttribute('data-catalog-key');
           const item = this.state.catalogItems.find(i => i.id === key);
           if (item) {
             this.state.selectedCatalogItem = item;
             this.renderPreviewModal(item);
           }
         });
       });

       // 1. Observer para Lazy Loading de imagens
       const imgObserver = new IntersectionObserver((entries) => {
         entries.forEach(entry => {
           if (entry.isIntersecting) {
             const img = entry.target;
             const key = img.getAttribute('data-catalog-key');
             const item = this.state.catalogItems.find(i => i.id === key);
             if (item) {
               this.loadThumbnailSrc(item, img);
             }
             imgObserver.unobserve(img);
           }
         });
       }, { rootMargin: '100px' });
       
       document.querySelectorAll('img[data-catalog-key]').forEach(img => imgObserver.observe(img));
       this.observers.push(imgObserver);

       // 2. Observer para Infinite Scroll (Sentinela)
       const sentinel = document.getElementById('catalog-sentinel');
       if (sentinel) {
         const scrollObserver = new IntersectionObserver((entries) => {
           if (entries[0].isIntersecting) {
             // Simular pequeno delay para suavizar a entrada de novos itens se necessário
             // mas aqui incrementamos e renderizamos imediatamente.
             this.state.catalogPage++;
             this.renderActiveTab();
           }
         }, { threshold: 0.1 });
         
         scrollObserver.observe(sentinel);
         this.observers.push(scrollObserver);
       }
    }

    // EVENTS DE LISTA.TXT
    if (this.state.activeTab === 'list_manager') {
       const btnSyncListOnly = document.getElementById('btn-sync-list-only');
       if (btnSyncListOnly) {
         btnSyncListOnly.addEventListener('click', () => {
           this.syncOnlyList();
         });
       }

       const btnClearFinished = document.getElementById('btn-clear-finished');
       if (btnClearFinished) {
         btnClearFinished.addEventListener('click', () => {
           this.handleClearFinishedGames();
         });
       }

       const bulkDeleteBtn = document.getElementById('btn-delete-selected');
       if (bulkDeleteBtn) {
         bulkDeleteBtn.addEventListener('click', () => {
           this.handleDeleteSelectedGames();
         });
       }

       const selectors = document.querySelectorAll('.game-selector');
       selectors.forEach(cb => {
         cb.addEventListener('change', (e) => {
           const key = e.target.getAttribute('data-select-key');
           if (e.target.checked) {
             this.state.selectedListKeys.add(key);
           } else {
             this.state.selectedListKeys.delete(key);
           }
           
           const countEl = document.getElementById('selected-count');
           if (countEl) countEl.innerText = this.state.selectedListKeys.size;
           
           if (bulkDeleteBtn) {
             if (this.state.selectedListKeys.size > 0) {
               bulkDeleteBtn.classList.remove('hidden');
               bulkDeleteBtn.classList.add('flex');
             } else {
               bulkDeleteBtn.classList.add('hidden');
               bulkDeleteBtn.classList.remove('flex');
             }
           }
         });
       });

       const btnAddProvider = document.getElementById('btn-add-provider');
       const providerDialog = document.getElementById('add-provider-dialog');
       if (btnAddProvider && providerDialog) {
         btnAddProvider.addEventListener('click', () => {
           providerDialog.classList.remove('hidden');
         });
       }

       const btnCancelProvider = document.getElementById('dialog-add-provider-cancel');
       if (btnCancelProvider && providerDialog) {
         btnCancelProvider.addEventListener('click', () => {
           providerDialog.classList.add('hidden');
         });
       }

       const btnCreateProvider = document.getElementById('dialog-add-provider-confirm');
       if (btnCreateProvider && providerDialog) {
         btnCreateProvider.addEventListener('click', () => {
           const input = document.getElementById('new-provider-name');
           if (input && input.value.trim() !== '') {
              const name = input.value.trim();
              
              const lines = this.state.listContent.split(/\r?\n/);
              if (lines.length > 0 && lines[lines.length-1].trim() !== '') {
                lines.push('');
              }
              lines.push(`Provedor: ${name}`);
              this.saveUpdatedList(lines.join('\n'));
              providerDialog.classList.add('hidden');
              input.value = '';
           }
         });
       }

       const btnAddGamesMain = document.getElementById('btn-add-games-main');
       if (btnAddGamesMain) {
         btnAddGamesMain.addEventListener('click', () => {
           this.state.isAddingGame = true;
           this.state.addingGameToProvider = '';
           this.renderActiveTab();
         });
       }

       const addGameTriggers = document.querySelectorAll('[data-trigger-add-game]');
       addGameTriggers.forEach(btn => {
         btn.addEventListener('click', (e) => {
           const provider = e.currentTarget.getAttribute('data-trigger-add-game') || '';
           this.state.isAddingGame = true;
           this.state.addingGameToProvider = provider;
           this.renderActiveTab();
         });
       });

       const btnAddGameCancel = document.getElementById('modal-add-game-cancel');
       if (btnAddGameCancel) {
         btnAddGameCancel.addEventListener('click', () => {
           this.state.isAddingGame = false;
           this.renderActiveTab();
         });
       }

       const btnAddGameConfirm = document.getElementById('modal-add-game-confirm');
       if (btnAddGameConfirm) {
         btnAddGameConfirm.addEventListener('click', () => {
           const providerSelect = document.getElementById('modal-add-game-provider-select');
           const textarea = document.getElementById('new-game-displayNames');
           
           const selectedProvider = providerSelect ? providerSelect.value : this.state.addingGameToProvider;
           const textValue = textarea ? textarea.value.trim() : '';

           if (textValue !== '' && selectedProvider) {
              const gameLines = textValue.split('\n').map(l => l.trim()).filter(Boolean);
              if (gameLines.length > 0) {
                this.handleAddGamesToList(selectedProvider, gameLines);
              }
              this.state.isAddingGame = false;
              this.renderActiveTab();
           }
         });
       }

       const deleteTriggers = document.querySelectorAll('[data-delete-catalog-key]');
       deleteTriggers.forEach(btn => {
         btn.addEventListener('click', (e) => {
           const key = e.currentTarget.getAttribute('data-delete-catalog-key');
           const catalogItem = this.state.catalogItems.find(i => i.id === key);
           if (catalogItem) {
             this.handleExcludeGameFromList(catalogItem);
           }
         });
       });
    }

    // EVENTS DE CONFIGURAÇÕES
    if (this.state.activeTab === 'settings') {
      const btnLogins = document.querySelectorAll('.btn-login-action');
      btnLogins.forEach(btn => {
         btn.addEventListener('click', () => {
           this.handleGoogleLogin();
         });
      });

      const btnLogouts = document.querySelectorAll('.btn-logout-action');
      btnLogouts.forEach(btn => {
         btn.addEventListener('click', () => {
           this.handleGoogleLogout();
         });
      });

      const btnSaveConfig = document.getElementById('btn-save-config');
      if (btnSaveConfig) {
        btnSaveConfig.addEventListener('click', () => {
          const clientIdInput = document.getElementById('conf-clientId');
          const folderInput = document.getElementById('conf-folder');
          const fileInput = document.getElementById('conf-file');

          if (clientIdInput && folderInput && fileInput) {
            const defaultClientId = '284266654862-bt52sui73h7jbd4tc44u99n0aaiev6og.apps.googleusercontent.com';
            const newClientId = clientIdInput.value.trim();

            if (newClientId !== defaultClientId && newClientId !== '') {
              const proceed = confirm("⚠️ ATENÇÃO & CUIDADO:\nVocê está alterando o Google Client ID padrão homologado para esta aplicação.\n\nFazer isso pode comprometer a autenticação e interromper totalmente o sincronismo automático de imagens com o Google Drive.\n\nDeseja realmente prosseguir com a alteração do Client ID?");
              if (!proceed) {
                clientIdInput.value = defaultClientId;
                return;
              }
            }

            this.config.clientId = newClientId;
            this.config.folderName = folderInput.value.trim() || 'Thumbs';
            this.config.listFileName = fileInput.value.trim() || 'lista.txt';
            
            this.saveStateToStorage();
            this.addLog("Configurações atualizadas localmente.");
            
            this.initGISAutomatic();
            
            alert("Ajustes salvos com sucesso! Verifique a conexão com o Google Drive para testar.");
            this.render();
          }
        });
      }
    }
  }
}

// Inicializar aplicativo no carregamento da página
window.addEventListener('load', () => {
  new ThumbSyncApp().render();
});
