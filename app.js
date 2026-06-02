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


// --- MOCK DATABASE AND CONFIGURATION ASSETS ---
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

export const MOCK_DRIVE_FILES = [
  { id: 'mock-gates-of-olympus', name: 'Gates of Olympus.webp', mimeType: 'image/webp', size: '124090', modifiedTime: '2026-05-31T14:20:00Z', providerName: 'Pragmatic Play' },
  { id: 'mock-sweet-bonanza', name: 'Sweet Bonanza.webp', mimeType: 'image/webp', size: '135921', modifiedTime: '2026-05-30T10:15:20Z', providerName: 'Pragmatic Play' },
  { id: 'mock-sugar-rush', name: 'Sugar Rush.webp', mimeType: 'image/webp', size: '95420', modifiedTime: '2026-05-28T16:05:10Z', providerName: 'Pragmatic Play' },
  { id: 'mock-starlight-princess', name: 'Starlight Princess.webp', mimeType: 'image/webp', size: '112500', modifiedTime: '2026-05-29T11:45:00Z', providerName: 'Pragmatic Play' },
  { id: 'mock-fortune-tiger', name: 'Fortune Tiger.webp', mimeType: 'image/webp', size: '89124', modifiedTime: '2026-05-27T08:30:19Z', providerName: 'PG Soft' },
  { id: 'mock-fortune-ox', name: 'Fortune Ox.webp', mimeType: 'image/webp', size: '79421', modifiedTime: '2026-05-26T09:12:00Z', providerName: 'PG Soft' },
  { id: 'mock-fortune-rabbit', name: 'Fortune Rabbit.webp', mimeType: 'image/webp', size: '82400', modifiedTime: '2026-05-25T13:40:40Z', providerName: 'PG Soft' },
  { id: 'mock-spaceman', name: 'Spaceman.webp', mimeType: 'image/webp', size: '105120', modifiedTime: '2026-05-24T15:20:11Z', providerName: 'Sem provedor' },
  { id: 'mock-aviator', name: 'Aviator.webp', mimeType: 'image/webp', size: '72590', modifiedTime: '2026-05-23T12:05:00Z', providerName: 'Sem provedor' }
];

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


// --- CORE APPLICATION CONTROLLER CLASS ---
class ThumbSyncApp {
  constructor() {
    this.state = {
      activeTab: 'list_manager',
      useMock: true,
      gdriveConnected: false,
      googleUser: null,
      listContent: '',
      driveFiles: [],
      listFileId: '',
      thumbsFolderId: '',
      catalogItems: [],
      
      // UI Helpers
      isLoading: false,
      logs: [],
      filterProvider: 'todos',
      filterStatus: 'todos',
      searchQuery: '',
      
      // Modal state
      selectedCatalogItem: null,
      isAddingGame: false,
      addingGameToProvider: '',
    };

    this.config = {
      clientId: '',
      folderName: 'Thumbs',
      listFileName: 'lista.txt',
      useMock: true
    };

    this.imageCache = new Map(); // fileId -> objectURL

    this.addLog("Inicializando módulo ThumbSync...");
    this.loadStateFromStorage();
    this.initGISAutomatic();
    
    // Fallback listeners para expiração de token
    window.addEventListener('gdrive_unauthorized', () => {
      this.addLog("Sessão Google desautenticada ou expirada.");
      this.state.gdriveConnected = false;
      this.state.useMock = true;
      this.syncLocalCatalog();
      this.render();
    });
  }

  loadStateFromStorage() {
    const savedClientId = localStorage.getItem('thumbsync_client_id') || '';
    const savedFolderName = localStorage.getItem('thumbsync_folder_name') || 'Thumbs';
    const savedListFileName = localStorage.getItem('thumbsync_list_file_name') || 'lista.txt';
    const savedUseMock = localStorage.getItem('thumbsync_use_mock') !== 'false';
    const cachedList = localStorage.getItem('thumbsync_cached_list_content') || INITIAL_MOCK_LIST_CONTENT;

    this.config = {
      clientId: savedClientId,
      folderName: savedFolderName,
      listFileName: savedListFileName,
      useMock: savedUseMock
    };

    this.state.useMock = savedUseMock;
    this.state.listContent = cachedList;

    const savedToken = localStorage.getItem('gdrive_access_token');
    const tokenExpiresAt = Number(localStorage.getItem('gdrive_token_expires_at') || '0');

    if (savedToken && tokenExpiresAt > Date.now()) {
      driveClient.setAccessToken(savedToken);
      this.state.gdriveConnected = true;
      this.state.useMock = false;
      this.addLog("Sessão herdada do Google Drive carregada com sucesso.");
    } else {
      this.addLog("Iniciando no modo de demonstração off-line.");
    }

    this.syncLocalCatalog();
  }

  saveStateToStorage() {
    localStorage.setItem('thumbsync_client_id', this.config.clientId);
    localStorage.setItem('thumbsync_folder_name', this.config.folderName);
    localStorage.setItem('thumbsync_list_file_name', this.config.listFileName);
    localStorage.setItem('thumbsync_use_mock', this.config.useMock ? 'true' : 'false');
    localStorage.setItem('thumbsync_cached_list_content', this.state.listContent);
  }

  addLog(message) {
    const time = new Date().toLocaleTimeString('pt-BR');
    this.state.logs.unshift(`[${time}] ${message}`);
    if (this.state.logs.length > 200) {
      this.state.logs.pop();
    }
    const logEl = document.getElementById('log-scroller');
    if (logEl) {
      this.renderLogs();
    }
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
        await this.syncWithGoogleDrive();
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
          this.state.useMock = false;
          this.config.useMock = false;

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
    this.state.useMock = true;
    this.config.useMock = true;
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
    if (this.state.useMock || !driveClient.isAuthenticated()) {
      this.addLog("Sincronizando no modo off-line com cache local.");
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

      this.addLog("Escaneando arquivos dentro da pasta...");
      const files = await driveClient.listFilesInFolder(folderId);
      this.state.driveFiles = files;
      this.addLog(`${files.length} arquivos localizados.`);

      const listFile = files.find(f => f.name.toLowerCase() === this.config.listFileName.toLowerCase());
      if (listFile) {
        this.addLog(`Baixando catálogo contido no arquivo '${this.config.listFileName}'...`);
        this.state.listFileId = listFile.id;
        const listText = await driveClient.downloadTextFile(listFile.id);
        this.state.listContent = listText;
        this.addLog(`Arquivo '${this.config.listFileName}' lido com sucesso (${listText.split('\n').length} linhas).`);
      } else {
        this.addLog(`Aviso: Arquivo '${this.config.listFileName}' não localizado. Gerando modelo básico...`);
        const newFileId = await driveClient.saveTextFile(this.config.listFileName, INITIAL_MOCK_LIST_CONTENT, folderId);
        this.state.listFileId = newFileId;
        this.state.listContent = INITIAL_MOCK_LIST_CONTENT;
        this.addLog(`Arquivo padrão '${this.config.listFileName}' criado.`);
      }

      this.saveStateToStorage();
      this.syncLocalCatalog();
      this.addLog("Sincronização com o Google Drive concluída.");
    } catch (e) {
      this.addLog(`Erro ao sincronizar: ${e.message}`);
      this.state.useMock = true;
      this.syncLocalCatalog();
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

    const driveFiles = this.state.useMock ? MOCK_DRIVE_FILES : this.state.driveFiles;
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
      if (this.state.useMock && file.providerName) {
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

  setActiveTab(tab) {
    this.state.activeTab = tab;
    this.render();
  }

  /**
   * Carrega visualmente a imagem webp do jogo.
   * Se offline (Mock), tenta puxar o arquivo real no diretório `/mock_data/source/...` com fallback p/ SVG processual.
   */
  async loadThumbnailSrc(item, imgEl) {
    if (this.state.useMock) {
      let providerPath = "";
      if (item.providerName && item.providerName !== "Sem provedor") {
        providerPath = item.providerName + "/";
      }
      
      const localUrl = `./mock_data/source/${providerPath}${item.displayName}.webp`;
      imgEl.src = localUrl;
      
      imgEl.onerror = () => {
        imgEl.onerror = null;
        imgEl.src = 'data:image/svg+xml;base64,' + btoa(`
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" width="100%" height="100%">
            <defs>
              <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#181820" />
                <stop offset="100%" stop-color="#1f2937" />
              </linearGradient>
            </defs>
            <rect width="200" height="300" fill="url(#g)" />
            <circle cx="100" cy="120" r="30" fill="#3b82f6" fill-opacity="0.1" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="3 3" />
            <text x="50%" y="45%" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="900" font-size="12" fill="#9ca3af" opacity="0.9">
              ${item.displayName}
            </text>
            <text x="50%" y="55%" text-anchor="middle" font-family="system-ui, sans-serif" font-size="8" fill="#4b5563" opacity="0.8">
              MOCK PREVIEW
            </text>
          </svg>
        `);
      };
      return;
    }

    if (this.imageCache.has(item.driveFileId)) {
      imgEl.src = this.imageCache.get(item.driveFileId);
      return;
    }

    try {
      const blob = await driveClient.downloadBinaryFile(item.driveFileId);
      const url = URL.createObjectURL(blob);
      this.imageCache.set(item.driveFileId, url);
      imgEl.src = url;
    } catch (e) {
      imgEl.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjMzMzIi8+PC9zdmc+';
    }
  }

  /**
   * Força download da imagem
   */
  async handleDownloadFile(item) {
    if (this.state.useMock) {
      this.addLog(`Download simulado para: ${item.displayName}.webp`);
      
      let providerPath = "";
      if (item.providerName && item.providerName !== "Sem provedor") {
        providerPath = item.providerName + "/";
      }
      const localUrl = `./mock_data/source/${providerPath}${item.displayName}.webp`;

      try {
        const response = await fetch(localUrl);
        if (!response.ok) throw new Error();
        const blob = await response.blob();
        this.triggerBlobDownload(blob, `${item.displayName}.webp`);
      } catch (e) {
        const payload = "RIFF_mock_webp_data_by_thumbsync_offline";
        const blob = new Blob([payload], { type: 'image/webp' });
        this.triggerBlobDownload(blob, `${item.displayName}.webp`);
      }
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
    a.click();
    URL.revokeObjectURL(url);
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

      if (!this.state.useMock && driveClient.isAuthenticated() && this.state.listFileId) {
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
    const updatedLines = [];

    let insideTargetProvider = false;
    let deleted = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const cleanLine = line.replace(/^\uFEFF/, '').replace(/^\s*(?:[-*•]\s+|\d+\s*[\).\]-]\s*)/, '').trim();
      
      const providerMatch = cleanLine.match(/^provedor\s*:\s*(.+)$/i);
      if (providerMatch) {
        insideTargetProvider = (this.normalizeName(providerMatch[1].trim()) === this.normalizeName(item.providerName));
        updatedLines.push(line);
        continue;
      }

      if (insideTargetProvider && this.normalizeName(cleanLine) === item.normalizedName && !deleted) {
         deleted = true;
         this.addLog(`Jogo descartado da lista.`);
         continue;
      }

      updatedLines.push(line);
    }

    this.saveUpdatedList(updatedLines.join('\n'));
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
                <span class="text-[9px] text-[#10b981] font-bold uppercase tracking-wider mt-1 block">Sorteador & Sync</span>
              </div>
            </div>

            <!-- Gdrive Connection Widget -->
            <div class="p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.05] relative space-y-2">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full ${this.state.gdriveConnected ? 'bg-[#10b981] shadow-[0_0_8px_#10b981]' : 'bg-[#f59e0b] shadow-[0_0_8px_#f59e0b]'} shrink-0"></span>
                <span class="text-[11px] font-bold text-white tracking-tight">
                  ${this.state.gdriveConnected ? 'G-Drive Conectado' : 'Modo Off-line'}
                </span>
              </div>
              <p class="text-[9px] text-zinc-500 font-medium leading-tight">
                ${this.state.gdriveConnected ? 'Salva direto na sua conta do Google Drive.' : 'Mostrando miniaturas demo locais.'}
              </p>
            </div>

            <!-- Side Nav Tabs -->
            <nav class="space-y-1">
              ${this.renderNavItem('catalog', 'Miniaturas', `
                <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span class="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-white font-bold">${this.state.catalogItems.filter(i=>i.hasWebp).length}</span>
              `)}
              ${this.renderNavItem('list_manager', 'Lista de Jogos', `
                <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              `)}
              ${this.renderNavItem('logs', 'Painel de Logs', `
                <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
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
              <span class="text-[10px] sm:text-xs text-zinc-500 font-bold uppercase tracking-wider relative">Status</span>
              <span class="px-2 py-0.5 rounded-full text-[8px] font-extrabold ${this.state.useMock ? 'bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/15' : 'bg-[#10b981]/10 text-[#10b981] border border-[#10b981]/15'}">
                ${this.state.useMock ? "OFF-LINE DEMO" : "GOOGLE DRIVE CONECTADO"}
              </span>
            </div>

            <!-- Apple-style Center Title for Mobile -->
            <div class="lg:hidden flex items-center gap-1.5">
              <span class="text-xs font-black tracking-tight text-white font-sans">ThumbSync</span>
            </div>

            <div class="flex items-center gap-3">
              <button id="btn-sync-gdrive" class="flex items-center justify-center gap-1.5 cursor-pointer bg-white/[0.03] text-white hover:bg-white/[0.06] border border-white/[0.08] px-3 py-1.5 rounded-xl text-[10px] sm:text-xs font-semibold transition-all">
                <svg id="sync-icon" class="w-3.5 h-3.5 shrink-0 ${this.state.isLoading ? 'animate-spin' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 6.13M12 8V12l3 3" />
                </svg>
                <span>Sincronizar</span>
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
      <div id="gdrive-loader" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center pointer-events-auto transition-opacity duration-300 hidden select-none">
        <div class="flex flex-col items-center justify-center gap-4 text-center p-6">
          <svg class="w-10 h-10 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 6.13M12 8v4l3 3" />
          </svg>
          <div>
            <p class="text-xs font-bold text-white">Sincronizando Google Drive...</p>
            <p class="text-[9px] text-zinc-500 font-semibold uppercase tracking-wider mt-1 block">Organizando catalogo e lista.txt</p>
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
  }

  renderNavItem(tab, label, iconHtml) {
    const isActive = this.state.activeTab === tab;
    return `
      <button data-tab="${tab}" class="flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold w-full transition-all cursor-pointer ${isActive ? 'bg-blue-600 text-white shadow-[0_8px_24px_rgba(37,99,235,0.3)] scale-[1.01]' : 'text-zinc-405 hover:text-white hover:bg-white/[0.04]' }">
        ${iconHtml}
        <span>${label}</span>
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
    } else if (this.state.activeTab === 'logs') {
      this.renderLogsTab(contentFrame);
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

    if (this.state.searchQuery.trim() !== '') {
      const q = this.normalizeName(this.state.searchQuery);
      items = items.filter(i => this.normalizeName(i.displayName).includes(q) || this.normalizeName(i.providerName).includes(q));
    }

    const uniqueProviders = Array.from(new Set(this.state.catalogItems.map(i => i.providerName))).filter(Boolean);

    container.innerHTML = `
      <div class="space-y-6 text-left select-none relative">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-white/[0.05]">
          <div>
            <h1 class="text-2xl font-black text-white tracking-tight">Miniaturas</h1>
            <p class="text-zinc-500 text-xs mt-0.5">Veja e gerencie as fotos .webp do seu catálogo geral no Google Drive.</p>
          </div>
        </div>

        <!-- Filtros -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white/[0.01] border border-white/[0.04] p-4 rounded-2xl select-none">
          <div class="space-y-1">
            <label class="text-[10px] text-zinc-500 font-extrabold uppercase tracking-wider block">Procurar</label>
            <input type="text" id="catalouge-search" value="${this.state.searchQuery}" placeholder="Ex: Sweet Bonanza..." class="w-full bg-[#131317] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white outline-none focus:border-blue-500">
          </div>
          <div class="space-y-1">
            <label class="text-[10px] text-zinc-500 font-extrabold uppercase tracking-wider block">Filtrar por Provedor</label>
            <select id="catalouge-provider-filter" class="w-full bg-[#131317] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white outline-none select-none">
              <option value="todos" ${this.state.filterProvider === 'todos' ? 'selected' : ''}>Todos os Provedores</option>
              ${uniqueProviders.map(p => `
                <option value="${p}" ${this.state.filterProvider === p ? 'selected' : ''}>${p}</option>
              `).join('')}
            </select>
          </div>
          <div class="space-y-1">
            <label class="text-[10px] text-zinc-500 font-extrabold uppercase tracking-wider block">Situação de Miniatura</label>
            <select id="catalouge-status-filter" class="w-full bg-[#131317] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white outline-none select-none">
              <option value="todos" ${this.state.filterStatus === 'todos' ? 'selected' : ''}>Todas as Situações</option>
              <option value="com_arte" ${this.state.filterStatus === 'com_arte' ? 'selected' : ''}>Com Imagem (.webp)</option>
              <option value="sem_arte" ${this.state.filterStatus === 'sem_arte' ? 'selected' : ''}>Imagens Faltando</option>
              <option value="listados" ${this.state.filterStatus === 'listados' ? 'selected' : ''}>Ativos na listagem</option>
              <option value="nao_listados" ${this.state.filterStatus === 'nao_listados' ? 'selected' : ''}>Arquivos avulsos no drive</option>
            </select>
          </div>
        </div>

        <!-- Catalogo em Grid -->
        ${items.length === 0 ? `
          <div class="py-20 text-center italic text-zinc-650 text-xs select-none">Nenhuma miniatura encontrada para os filtros selecionados.</div>
        ` : `
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
            ${items.map(item => {
              const gradient = PROVIDER_GRADIENTS[item.providerName.toLowerCase()] || PROVIDER_GRADIENTS['default'];
              const hasWebp = item.hasWebp;

              return `
                <div data-catalog-key="${item.id}" class="group relative aspect-[2/3] rounded-2xl overflow-hidden bg-zinc-950 border border-white/[0.08] hover:border-white/20 shadow-md cursor-pointer transition-all transform hover:scale-[1.02]">
                  ${hasWebp ? `
                    <img id="thumb-${item.id}" src="" alt="${item.displayName}" class="w-full h-full object-cover">
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

                  <div class="absolute inset-0 bg-gradient-to-t ${gradient} opacity-90"></div>
                  
                  ${hasWebp ? `
                    <div class="absolute inset-x-0 bottom-0 p-4 text-left z-10 leading-none">
                      <span class="text-[8px] text-zinc-400 font-black uppercase tracking-widest block">${item.providerName}</span>
                      <h4 class="text-xs font-black text-white leading-normal mt-0.5">${item.displayName}</h4>
                    </div>
                  ` : ''}

                  <!-- Visual Drag and Drop Upload Drop-Zone indicators -->
                  <div class="absolute inset-0 bg-blue-600/20 m-1 rounded-2xl border-2 border-dashed border-blue-500 flex flex-col items-center justify-center opacity-0 group-hover:pointer-events-none transition-opacity duration-300 pointer-events-none dropzone-indicator">
                    <svg class="w-7 h-7 text-white animate-bounce mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4 4m4-4v12" /></svg>
                    <span class="text-[9px] font-bold text-white uppercase tracking-wider text-center leading-tight">Solte Webp<br>para Upload</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;

    // Carregar via lazy load das imagens
    items.forEach(item => {
      if (item.hasWebp) {
        const imgEl = document.getElementById(`thumb-${item.id}`);
        if (imgEl) {
          this.loadThumbnailSrc(item, imgEl);
        }
      }
    });

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
          const targetFolderId = this.state.thumbsFolderId;
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

    container.innerHTML = `
      <div class="space-y-6 text-left select-none relative">
        <div class="flex flex-col sm:flex-row justify-between gap-3 sm:items-center pb-2 border-b border-white/[0.05]">
          <div>
            <h1 class="text-2xl font-black text-white tracking-tight">Gerenciador de lista.txt</h1>
            <p class="text-zinc-500 text-xs mt-0.5">Defina novos jogos e gerencie o catálogo gravado no repositório.</p>
          </div>
          <div class="flex items-center gap-2 self-start sm:self-auto shrink-0 select-none">
            <button id="btn-add-provider" class="flex items-center gap-1.5 text-xs font-bold py-2 px-3.5 rounded-xl bg-white/[0.03] text-white hover:bg-white/[0.06] border border-white/[0.06] transition-all cursor-pointer">
              <svg class="w-3.5 h-3.5 text-zinc-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
              <span>Novo Provedor</span>
            </button>
            <button id="btn-add-games-main" class="flex items-center gap-1.5 text-xs font-bold py-2 px-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white border border-blue-500/20 transition-all cursor-pointer">
              <svg class="w-3.5 h-3.5 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
              <span>Adicionar Jogos</span>
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
                ${groupsList.map(([prov]) => `
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
   * TELA LOGS
   */
  renderLogsTab(container) {
    container.innerHTML = `
      <div class="space-y-6 text-left select-none flex flex-col h-[75vh]">
        <div class="pb-2 border-b border-white/[0.05]">
          <h1 class="text-2xl font-black text-white tracking-tight">Logs do Aplicativo</h1>
          <p class="text-zinc-500 text-xs mt-0.5">Veja em tempo real a comunicação da api e as transações ocorrendo.</p>
        </div>

        <div class="flex-1 min-h-0 bg-[#09090b] border border-white/[0.06] rounded-3xl p-5 flex flex-col relative overflow-hidden">
          <div class="flex items-center gap-2 mb-4 shrink-0">
            <span class="w-2.5 h-2.5 rounded-full bg-red-500"></span>
            <span class="w-2.5 h-2.5 rounded-full bg-yellow-500"></span>
            <span class="w-2.5 h-2.5 rounded-full bg-green-500"></span>
            <span class="text-[10px] text-zinc-600 font-mono ml-2 font-bold uppercase tracking-wider">Console de Transações</span>
          </div>

          <div id="log-scroller" class="flex-1 overflow-y-auto font-mono text-[10px] text-zinc-400 leading-relaxed pr-2 custom-scrollbar select-text">
          </div>
        </div>
      </div>
    `;
    this.renderLogs();
  }

  renderLogs() {
    const scroller = document.getElementById('log-scroller');
    if (!scroller) return;

    scroller.innerHTML = this.state.logs.map(log => {
      let colorClass = 'text-zinc-400';
      if (log.includes('Erro') || log.includes('falhou')) {
         colorClass = 'text-red-400 font-bold';
      } else if (log.includes('sucesso') || log.includes('concluída') || log.includes('Ativo')) {
         colorClass = 'text-emerald-400';
      } else if (log.includes('Aviso')) {
         colorClass = 'text-yellow-400 font-semibold';
      } else if (log.includes('Iniciando') || log.includes('Buscando')) {
         colorClass = 'text-blue-400';
      }
      return `<div class="${colorClass} mb-1">${log}</div>`;
    }).join('');
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
          <div class="lg:col-span-2 rounded-3xl bg-white/[0.01] border border-white/[0.04] p-6 space-y-5 h-fit">
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
  }

  closePreviewModal() {
    const modal = document.getElementById('preview-modal');
    if (!modal) return;
    modal.classList.add('pointer-events-none', 'opacity-0');
    const child = modal.firstElementChild;
    if (child) child.classList.add('scale-95');
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
  }

  bindTabEvents() {
    // EVENTS DE CATALOGO
    if (this.state.activeTab === 'catalog') {
       const searchInput = document.getElementById('catalouge-search');
       if (searchInput) {
         searchInput.addEventListener('input', (e) => {
           this.state.searchQuery = e.currentTarget.value;
           clearTimeout(this.debounceTimer);
           this.debounceTimer = setTimeout(() => {
             this.renderActiveTab();
           }, 300);
         });
       }

       const providerSelect = document.getElementById('catalouge-provider-filter');
       if (providerSelect) {
         providerSelect.addEventListener('change', (e) => {
            this.state.filterProvider = e.currentTarget.value;
            this.renderActiveTab();
         });
       }

       const statusSelect = document.getElementById('catalouge-status-filter');
       if (statusSelect) {
         statusSelect.addEventListener('change', (e) => {
            this.state.filterStatus = e.currentTarget.value;
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
    }

    // EVENTS DE LISTA.TXT
    if (this.state.activeTab === 'list_manager') {
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
      const btnSaveConfig = document.getElementById('btn-save-config');
      if (btnSaveConfig) {
        btnSaveConfig.addEventListener('click', () => {
          const clientIdInput = document.getElementById('conf-clientId');
          const folderInput = document.getElementById('conf-folder');
          const fileInput = document.getElementById('conf-file');

          if (clientIdInput && folderInput && fileInput) {
            this.config.clientId = clientIdInput.value.trim();
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
