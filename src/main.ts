import './index.css';
import { GameItem, ProviderGroup, DriveFile, CatalogItem, AppConfig } from './types';
import { driveClient } from './driveClient';
import {
  INITIAL_MOCK_LIST_CONTENT,
  MOCK_DRIVE_FILES,
  PROVIDER_GRADIENTS,
  PROVIDER_BORDER_GLOWS,
  PROVIDER_BADGE_STYLE
} from './mockData';

class ThumbSyncApp {
  // Application State
  private state = {
    activeTab: 'list_manager',
    useMock: true,
    gdriveConnected: false,
    googleUser: null as any,
    listContent: '',
    driveFiles: [] as DriveFile[],
    listFileId: '',
    thumbsFolderId: '',
    catalogItems: [] as CatalogItem[],
    
    // UI Helpers
    isLoading: false,
    logs: [] as string[],
    filterProvider: 'todos',
    filterStatus: 'todos',
    searchQuery: '',
    
    // Modal state
    selectedCatalogItem: null as CatalogItem | null,
    isAddingGame: false,
    addingGameToProvider: '',
  };

  private config: AppConfig = {
    clientId: '',
    folderName: 'Thumbs',
    listFileName: 'lista.txt',
    useMock: true
  };

  private imageCache = new Map<string, string>(); // fileId -> objectURL

  constructor() {
    this.addLog("Inicializando módulo ThumbSync...");
    this.loadStateFromStorage();
    this.initGISAutomatic();
    
    // Fallback listeners for authorization failures
    window.addEventListener('gdrive_unauthorized', () => {
      this.addLog("Sessão Google desautenticada ou expirada.");
      this.state.gdriveConnected = false;
      this.state.useMock = true;
      this.syncLocalCatalog();
      this.render();
    });
  }

  private loadStateFromStorage() {
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

  private saveStateToStorage() {
    localStorage.setItem('thumbsync_client_id', this.config.clientId);
    localStorage.setItem('thumbsync_folder_name', this.config.folderName);
    localStorage.setItem('thumbsync_list_file_name', this.config.listFileName);
    localStorage.setItem('thumbsync_use_mock', this.config.useMock ? 'true' : 'false');
    localStorage.setItem('thumbsync_cached_list_content', this.state.listContent);
  }

  private addLog(message: string) {
    const time = new Date().toLocaleTimeString('pt-BR');
    this.state.logs.unshift(`[${time}] ${message}`);
    // Cap logs size
    if (this.state.logs.length > 200) {
      this.state.logs.pop();
    }
    const logEl = document.getElementById('log-scroller');
    if (logEl) {
      this.renderLogs();
    }
  }

  /**
   * Initialize Google Identity Services automatically from loaded script.
   */
  private initGISAutomatic() {
    // Check if GIS is loaded periodically in case of race condition
    const checkGIS = setInterval(() => {
      if (typeof (window as any).google !== 'undefined') {
        clearInterval(checkGIS);
        this.addLog("Google API SDK carregado com sucesso.");
        if (this.config.clientId && this.state.gdriveConnected) {
          this.reconnectSilent();
        }
      }
    }, 500);

    // Timeout check after 10s to avoid hanging if offline completely
    setTimeout(() => clearInterval(checkGIS), 10000);
  }

  private async reconnectSilent() {
    try {
      const savedToken = localStorage.getItem('gdrive_access_token');
      if (savedToken) {
        driveClient.setAccessToken(savedToken);
        await this.syncWithGoogleDrive();
      }
    } catch (err: any) {
      this.addLog(`Reconexão automática falhou: ${err.message}`);
    }
  }

  /**
   * Start OAuth Auth flow via GISpopup client
   */
  public handleGoogleLogin() {
    if (!this.config.clientId) {
      this.addLog("Erro: Client ID do Google Cloud não configurado!");
      this.setActiveTab('settings');
      this.render();
      alert("Por favor, configure o seu Client ID do Google Cloud antes de conectar.");
      return;
    }

    this.state.isLoading = true;
    this.addLog("Iniciando fluxo de login popup do Google Account...");
    this.render();

    try {
      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: this.config.clientId,
        scope: 'https://www.googleapis.com/auth/drive',
        callback: async (response: any) => {
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
    } catch (err: any) {
      this.state.isLoading = false;
      this.addLog(`Erro ao carregar modal de login: ${err.message}`);
      this.render();
    }
  }

  public handleGoogleLogout() {
    this.addLog("Sessão Google Drive desconectada.");
    driveClient.setAccessToken('');
    this.state.gdriveConnected = false;
    this.state.useMock = true;
    this.config.useMock = true;
    localStorage.removeItem('gdrive_access_token');
    localStorage.removeItem('gdrive_token_expires_at');
    this.saveStateToStorage();

    // Clear caches
    this.imageCache.forEach(url => URL.revokeObjectURL(url));
    this.imageCache.clear();

    this.syncLocalCatalog();
    this.render();
  }

  /**
   * Core logic to fetch lists and metadata from Google Drive
   */
  public async syncWithGoogleDrive() {
    if (this.state.useMock || !driveClient.isAuthenticated()) {
      this.addLog("Sincronizando no modo offline.");
      this.syncLocalCatalog();
      this.render();
      return;
    }

    this.state.isLoading = true;
    this.addLog(`Sincronizando com o Google Drive...`);
    this.render();

    try {
      // 1. Resolve folder Thumbs
      this.addLog(`Buscando pasta '${this.config.folderName}'...`);
      const folderId = await driveClient.findOrCreateFolder(this.config.folderName);
      this.state.thumbsFolderId = folderId;
      this.addLog(`Pasta '${this.config.folderName}' localizada (ID: ${folderId.substring(0,6)}...)`);

      // 2. Fetch all files inside the folder
      this.addLog("Escaneando arquivos raiz e pastas de provedores dentro da pasta...");
      const files = await driveClient.listFilesInFolder(folderId);

      const directFiles: DriveFile[] = [];
      const subfolders: DriveFile[] = [];

      files.forEach(f => {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          subfolders.push(f);
        } else {
          directFiles.push(f);
        }
      });

      this.addLog(`Encontrados ${directFiles.length} arquivos raiz e ${subfolders.length} pastas de provedores.`);

      const allFiles = [...directFiles];

      // Busca recursivamente os arquivos (.webp) dentro de cada pasta de provedor
      for (const subfolder of subfolders) {
        this.addLog(`Escaneando subpasta do provedor '${subfolder.name}'...`);
        try {
          const subFiles = await driveClient.listFilesInFolder(subfolder.id);
          subFiles.forEach(sf => {
            sf.providerName = subfolder.name; // Associa a imagem ao provedor (nome da pasta)
            allFiles.push(sf);
          });
          this.addLog(`Provedor '${subfolder.name}': ${subFiles.length} miniaturas carregadas.`);
        } catch (subErr: any) {
          this.addLog(`Aviso: erro ao ler pasta do provedor '${subfolder.name}': ${subErr.message}`);
        }
      }

      this.state.driveFiles = allFiles;
      this.addLog(`Total: ${allFiles.length} arquivos indexados do Google Drive.`);

      // 3. Look for file list.txt
      const listFile = allFiles.find(f => f.name.toLowerCase() === this.config.listFileName.toLowerCase());
      if (listFile) {
        this.addLog(`Lendo lista de jogos contida em '${this.config.listFileName}'...`);
        this.state.listFileId = listFile.id;
        const listText = await driveClient.downloadTextFile(listFile.id);
        this.state.listContent = listText;
        this.addLog(`Lista '${this.config.listFileName}' carregada com sucesso (${listText.split('\n').length} linhas).`);
      } else {
        this.addLog(`Aviso: Arquivo '${this.config.listFileName}' não encontrado na pasta raiz. Criando modelo padrão...`);
        const newFileId = await driveClient.saveTextFile(this.config.listFileName, INITIAL_MOCK_LIST_CONTENT, folderId);
        this.state.listFileId = newFileId;
        this.state.listContent = INITIAL_MOCK_LIST_CONTENT;
        this.addLog(`Arquivo '${this.config.listFileName}' criado com sucesso.`);
      }

      this.saveStateToStorage();
      this.syncLocalCatalog();
      this.addLog("Sincronização com o Drive concluída com sucesso.");
    } catch (e: any) {
      this.addLog(`Erro ao sincronizar com Google Drive: ${e.message}`);
      this.state.useMock = true;
      this.syncLocalCatalog();
    } finally {
      this.state.isLoading = false;
      this.render();
    }
  }

  /**
   * Refreshes local catalog, matches games list with actual images on drive
   */
  private syncLocalCatalog() {
    const listGames: GameItem[] = [];
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
    const itemsMap = new Map<string, CatalogItem>();

    // Index all listed games as Catalog Items
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

    // Populate webp properties by checking available drive files
    driveFiles.forEach(file => {
      if (file.mimeType !== 'image/webp') return;

      const baseName = file.name.replace(/\.webp$/i, '');
      const normName = this.normalizeName(baseName);
      
      // Auto-detect provider by subfolders or parent segments if available
      let fileProvider = "Sem provedor";
      if (file.providerName) {
        fileProvider = file.providerName;
      } else {
        // Simple heuristic: check if any listed game matches this name, then inherit its provider name!
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
        // Unlisted WebP
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

  private normalizeName(val: string): string {
    return val
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\.webp$/i, '')
      .replace(/:/g, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * Tab switcher
   */
  public setActiveTab(tab: string) {
    this.state.activeTab = tab;
    this.render();
  }

  /**
   * Helper to fetch WebP image cleanly. Generates an ObjectURL that secures access keys
   */
  public async loadThumbnailSrc(fileId: string, imgEl: HTMLImageElement) {
    if (this.state.useMock) {
      // In mock mode, simply output canvas template or random mock shape
      imgEl.src = 'data:image/svg+xml;base64,' + btoa(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" width="100%" height="100%">
          <defs>
            <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#152033" />
              <stop offset="100%" stop-color="#0a84ff" stop-opacity="0.2" />
            </linearGradient>
          </defs>
          <rect width="200" height="300" fill="url(#g)" />
          <text x="50%" y="45%" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="900" font-size="16" fill="#fff" opacity="0.95">
            MOCK WEBP
          </text>
          <text x="50%" y="55%" text-anchor="middle" font-family="system-ui, sans-serif" font-size="10" fill="#a0aec0" opacity="0.8">
            Visualizador Ativo
          </text>
        </svg>
      `);
      return;
    }

    if (this.imageCache.has(fileId)) {
      imgEl.src = this.imageCache.get(fileId)!;
      return;
    }

    try {
      const blob = await driveClient.downloadBinaryFile(fileId);
      const url = URL.createObjectURL(blob);
      this.imageCache.set(fileId, url);
      imgEl.src = url;
    } catch (e) {
      imgEl.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjMzMzIi8+PC9zdmc+';
    }
  }

  /**
   * Triggers native download of selected file
   */
  public async handleDownloadFile(item: CatalogItem) {
    if (this.state.useMock || !item.driveFileId) {
      // Offline simulated download
      this.addLog(`Download simulado para: ${item.displayName}.webp`);
      const payload = "RIFF_mock_webp_data_by_thumbsync_offline";
      const blob = new Blob([payload], { type: 'image/webp' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${item.displayName}.webp`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    this.addLog(`Baixando miniatura do Drive: ${item.displayName}.webp...`);
    try {
      const blob = await driveClient.downloadBinaryFile(item.driveFileId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${item.displayName}.webp`;
      a.click();
      URL.revokeObjectURL(url);
      this.addLog(`Download concluído: ${item.displayName}.webp`);
    } catch (e: any) {
      alert(`Falha no download: ${e.message}`);
    }
  }

  /**
   * Write updated lista.txt structure to mock storage or drive file
   */
  private async saveUpdatedList(newContent: string) {
    this.state.isLoading = true;
    this.render();

    try {
      this.state.listContent = newContent;
      this.saveStateToStorage();

      if (!this.state.useMock && driveClient.isAuthenticated() && this.state.listFileId) {
        this.addLog(`Atualizando lista.txt no Google Drive...`);
        await driveClient.saveTextFile(this.config.listFileName, newContent, undefined, this.state.listFileId);
        this.addLog(`lista.txt atualizada com sucesso no Google Drive.`);
      } else {
        this.addLog(`lista.txt atualizada localmente com sucesso.`);
      }

      this.syncLocalCatalog();
    } catch (err: any) {
      this.addLog(`Erro ao salvar lista de jogos: ${err.message}`);
      alert("Falha ao salvar as alterações. Tente reconectar o seu Google Drive.");
    } finally {
      this.state.isLoading = false;
      this.render();
    }
  }

  /**
   * Action trigger: Add game to lista.txt at selected provider
   */
  public handleAddGameToList(providerName: string, gameName: string) {
    if (!gameName.trim()) return;

    this.addLog(`Adicionando '${gameName}' ao provedor '${providerName}'...`);
    
    const lines = this.state.listContent.split(/\r?\n/);
    const targetHeaderRegex = new RegExp(`^provedor\\s*:\\s*${providerName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*$`, 'i');
    
    let injected = false;
    const updatedLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      updatedLines.push(line);

      if (targetHeaderRegex.test(line.trim())) {
         // Insert right after the header line
         updatedLines.push(gameName.trim());
         injected = true;
      }
    }

    if (!injected) {
      // If provider was not found, append a new provider section at the bottom
      if (updatedLines.length > 0 && updatedLines[updatedLines.length - 1].trim() !== '') {
        updatedLines.push('');
      }
      updatedLines.push(`Provedor: ${providerName}`);
      updatedLines.push(gameName.trim());
    }

    this.saveUpdatedList(updatedLines.join('\n'));
  }

  /**
   * Action trigger: Add multiple games to lista.txt at selected provider
   */
  public handleAddGamesToList(providerName: string, gameNames: string[]) {
    const validGames = gameNames.map(g => g.trim()).filter(Boolean);
    if (validGames.length === 0) return;

    this.addLog(`Adicionando ${validGames.length} jogos ao provedor '${providerName}'...`);
    
    const lines = this.state.listContent.split(/\r?\n/);
    const targetHeaderRegex = new RegExp(`^provedor\\s*:\\s*${providerName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*$`, 'i');
    
    let injected = false;
    const updatedLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      updatedLines.push(line);

      if (targetHeaderRegex.test(line.trim())) {
         // Insert right after the header line (all games)
         validGames.forEach(gameName => {
           updatedLines.push(gameName);
         });
         injected = true;
      }
    }

    if (!injected) {
      // If provider was not found, append a new provider section at the bottom
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

  /**
   * Action trigger: Exclude/Remove game from list
   */
  public handleExcludeGameFromList(item: CatalogItem) {
    const isConfirmed = confirm(`Excluir o jogo "${item.displayName}" do catálogo do provedor "${item.providerName}"?\nEsta alteração modificará o arquivo list.txt.`);
    if (!isConfirmed) return;

    this.addLog(`Removendo '${item.displayName}' do provedor '${item.providerName}'...`);
    const lines = this.state.listContent.split(/\r?\n/);
    const updatedLines: string[] = [];

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
         this.addLog(`Linha correspondente removida.`);
         continue; // skip pushing this line!
      }

      updatedLines.push(line);
    }

    this.saveUpdatedList(updatedLines.join('\n'));
  }

  /**
   * HTML RENDERING PIPELINE (Pure Vanilla DOM Render Engine)
   */
  public render() {
    const root = document.getElementById('root');
    if (!root) return;

    // Compile active list segments
    const listedItems = this.state.catalogItems.filter(i => i.isListed);
    const completedGames = listedItems.filter(i => i.hasWebp).length;
    const totalListedCount = listedItems.length;
    const pendingGamesCount = totalListedCount - completedGames;
    const healthPercent = totalListedCount > 0 ? Math.round((completedGames / totalListedCount) * 100) : 100;

    root.innerHTML = `
      <div class="flex h-screen w-screen overflow-hidden text-[#f4f4f5] select-none font-sans bg-[#09090b]">
        <!-- MacOS-style glass Sidebar - Hide on mobile (below lg) -->
        <aside class="hidden lg:flex w-64 max-w-64 border-r border-white/[0.06] bg-[#0d0d10]/70 backdrop-blur-2xl flex-col justify-between shrink-0 h-full p-4 select-none relative z-10 transition-all duration-300">
          <div class="space-y-6">
            <!-- Brand header -->
            <div class="flex items-center gap-3.5 px-3 py-2 border-b border-white/[0.05]">
              <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#0a84ff] to-[#30d158] p-0.5 flex items-center justify-center shadow-[0_4px_16px_rgba(10,132,255,0.25)]">
                <svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div>
                <h3 class="text-sm font-black tracking-wide leading-none text-white font-sans">ThumbSync</h3>
                <span class="text-[9px] text-[#30d158] font-bold uppercase tracking-wider mt-1 block">Client Comp.</span>
              </div>
            </div>

            <!-- Gdrive Mini Status -->
            <div class="p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.05] relative space-y-2 select-none overflow-hidden h-20 flex flex-col justify-center">
              <div class="absolute -right-2 -bottom-2 w-12 h-12 rounded-full ${this.state.gdriveConnected ? 'bg-[#30d158]/5' : 'bg-[#ff9f0a]/5'} blur-xl"></div>
              <div class="flex items-center gap-2 relative z-10">
                <span class="w-2.5 h-2.5 rounded-full ${this.state.gdriveConnected ? 'bg-[#30d158] shadow-[0_0_8px_#30d158]' : 'bg-[#ff9f0a] shadow-[0_0_8px_#ff9f0a] animate-pulse'} shrink-0"></span>
                <span class="text-[11px] font-bold text-white tracking-tight">
                  ${this.state.gdriveConnected ? 'G-Drive Ativo' : 'Modo Off-line'}
                </span>
              </div>
              <p class="text-[9px] text-zinc-500 font-semibold tracking-wide relative z-10 leading-tight">
                ${this.state.gdriveConnected ? 'Sincronização bidirecional' : 'Carregado com cache local'}
              </p>
            </div>

            <!-- Navigation Links -->
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
              ${this.renderNavItem('logs', 'Terminal Console', `
                <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              `)}
              ${this.renderNavItem('settings', 'Configurações', `
                <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0x" />
                </svg>
              `)}
            </nav>
          </div>

          <!-- Bottom account control -->
          <div class="border-t border-white/[0.05] pt-4 flex flex-col gap-2 relative z-10 w-full select-none">
            ${this.state.gdriveConnected ? `
              <div class="flex items-center gap-3 bg-white/[0.015] border border-white/[0.04] p-2.5 rounded-2xl w-full">
                <div class="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center font-bold text-xs text-white uppercase shadow-sm select-none">
                  Drive
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-bold text-white truncate leading-none">Usuário Conectado</p>
                  <span class="text-[9px] text-zinc-500 font-semibold tracking-wide truncate mt-1 block">Google Cloud OAuth</span>
                </div>
              </div>
              <button id="btn-logout" class="flex items-center justify-center gap-2 text-xs font-bold py-2.5 px-4 text-center rounded-xl w-full text-[#ff453a] hover:bg-[#ff453a]/10 transition-colors border border-[#ff453a]/15 cursor-pointer">
                Sair do Drive
              </button>
            ` : `
              <p class="text-[9px] text-zinc-500 font-semibold text-center leading-normal mb-1">
                Conecte seu Google Drive para sincronizar ao vivo!
              </p>
              <button id="btn-login" class="flex items-center justify-center gap-2 text-xs font-black bg-white text-black hover:bg-neutral-100 py-3 px-4 rounded-xl shadow-md w-full transition-all cursor-pointer select-none">
                <svg class="w-4 h-4 shrink-0" viewBox="0 0 48 48" style="display: block;">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                </svg>
                <span>Conectar Google</span>
              </button>
            `}
          </div>
        </aside>

        <!-- Main Workspace Area -->
        <main class="flex-1 min-w-0 flex flex-col h-full bg-[#09090b] relative">
          <!-- MacOS standard header bar - CSS adjust padding for mobile -->
          <header class="h-16 shrink-0 border-b border-white/[0.05] bg-[#0d0d10]/30 backdrop-blur-md flex items-center justify-between px-4 md:px-8 select-none relative z-10 w-full">
            <div class="flex items-center gap-2">
              <span class="text-[10px] sm:text-xs text-zinc-500 font-bold uppercase tracking-wider relative">Canal</span>
              <span class="px-2 py-0.5 rounded-full text-[8.5px] font-extrabold ${this.state.useMock ? 'bg-[#ff9f0a]/10 text-[#ff9f0a] border border-[#ff9f0a]/15' : 'bg-[#30d158]/10 text-[#30d158] border border-[#30d158]/15'}">
                ${this.state.useMock ? "OFFLINE" : "NUVEM INTEGRADA"}
              </span>
            </div>

            <!-- Apple-style Center Title for Mobile -->
            <div class="lg:hidden flex items-center gap-1.5">
              <span class="text-xs font-black tracking-tight text-white font-sans">ThumbSync</span>
            </div>

            <div class="flex items-center gap-3">
              <button id="btn-sync-gdrive" class="flex items-center justify-center gap-1.5 cursor-pointer bg-white/[0.03] text-white hover:bg-white/[0.06] border border-white/[0.08] hover:border-white/[0.12] px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-[11px] sm:text-xs font-semibold select-none transition-all duration-200">
                <svg id="sync-icon" class="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 ${this.state.isLoading ? 'animate-spin' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 6.13M12 8V12l3 3" />
                </svg>
                <span>Verificar<span class="hidden sm:inline"> Conexão</span></span>
              </button>
            </div>
          </header>

          <!-- Tab Content Display Frame (Safe pb-20 on mobile to prevent bottom menu overlay cutoff) -->
          <div class="flex-1 overflow-y-auto p-4 md:p-8 pb-20 md:pb-8 custom-scrollbar relative z-0 h-full w-full">
            <div id="tab-content" class="h-full w-full"></div>
          </div>
        </main>

        <!-- IOS 2026 Style Bottom Nav Tab Bar - Only visible on Mobile screens -->
        <nav class="lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-[#0a0a0d]/90 backdrop-blur-3xl border-t border-white/[0.06] flex items-center justify-around z-30 px-2 pb-safe shadow-[0_-8px_32px_rgba(0,0,0,0.5)]">
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
      <div id="gdrive-loader" class="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center pointer-events-auto transition-opacity duration-300 hidden select-none">
        <div class="flex flex-col items-center justify-center gap-4 text-center p-6">
          <svg class="w-10 h-10 animate-spin text-[#0a84ff]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 6.13M12 8v4l3 3" />
          </svg>
          <div>
            <p class="text-sm font-bold text-white">Sincronizando Google Drive...</p>
            <p class="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mt-1 block">Ajustando arquivos e lista.txt</p>
          </div>
        </div>
      </div>

      <!-- Image Preview Modal -->
      <div id="preview-modal" class="fixed inset-0 z-40 bg-black/80 backdrop-blur-xl flex items-center justify-center pointer-events-none opacity-0 transition-all duration-300 select-none">
        <div class="w-[92%] max-w-md bg-[#131317]/90 border border-white/[0.08] p-5 sm:p-6 rounded-3xl shadow-[0_32px_80px_rgba(0,0,0,0.8)] scale-95 transition-transform duration-300 flex flex-col select-none relative max-h-[90vh]">
          <button id="modal-close" class="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/[0.05] hover:bg-white/[0.1] flex items-center justify-center cursor-pointer transition-colors border border-white/5 z-10">
            <svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          
          <div id="modal-content" class="flex flex-col h-full overflow-y-auto"></div>
        </div>
      </div>
    `;

    this.renderActiveTab();
    this.bindGlobalEvents();
  }

  private renderNavItem(tab: string, label: string, iconHtml: string): string {
    const isActive = this.state.activeTab === tab;
    return `
      <button data-tab="${tab}" class="flex items-center gap-3.5 px-3.5 py-3 rounded-xl text-xs font-semibold w-full transition-all duration-200 cursor-pointer select-none ${isActive ? 'bg-[#0a84ff] text-white shadow-[0_8px_24px_rgba(10,132,255,0.3)] scale-[1.02]' : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]' }">
        ${iconHtml}
        <span>${label}</span>
      </button>
    `;
  }

  private renderMobileNavItem(tab: string, label: string, iconHtml: string): string {
    const isActive = this.state.activeTab === tab;
    return `
      <button data-mobile-tab-btn data-tab="${tab}" class="flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-all duration-200 text-center ${isActive ? 'text-[#0a84ff]' : 'text-zinc-500 hover:text-zinc-300' }">
        <div class="px-2.5 py-1 rounded-full ${isActive ? 'bg-[#0a84ff]/10 text-[#0a84ff]' : 'text-zinc-400'} transition-all duration-200">
          ${iconHtml}
        </div>
        <span class="text-[9px] font-bold tracking-tight mt-0.5">${label}</span>
      </button>
    `;
  }

  private renderActiveTab() {
    const contentFrame = document.getElementById('tab-content');
    if (!contentFrame) return;

    // Toggle central background loader
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

    if (this.state.activeTab === 'dashboard') {
      this.renderDashboard(contentFrame);
    } else if (this.state.activeTab === 'catalog') {
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
   * VIEW: DASHBOARD
   */
  private renderDashboard(container: HTMLElement) {
    const listedItems = this.state.catalogItems.filter(i => i.isListed);
    const completedGames = listedItems.filter(i => i.hasWebp).length;
    const totalListedCount = listedItems.length;
    const pendingGamesCount = totalListedCount - completedGames;
    const healthPercent = totalListedCount > 0 ? Math.round((completedGames / totalListedCount) * 100) : 100;

    // Calculate SVG Circle offsets
    const radius = 84;
    const circumference = 2 * Math.PI * radius; // ~527.7
    const strokeDashoffset = circumference - (circumference * healthPercent) / 100;

    const unlistedWebps = this.state.catalogItems.filter(i => !i.isListed && i.hasWebp).length;

    container.innerHTML = `
      <div class="space-y-8 select-none">
        
        <!-- Welcome Title -->
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-5">
          <div class="space-y-1">
            <h1 class="text-3xl font-black tracking-tight leading-tight bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
              Centro de Controle
            </h1>
            <p class="text-zinc-500 text-xs font-bold uppercase tracking-widest leading-none">
              Sincronização estendida de miniaturas de jogos
            </p>
          </div>
        </div>

        <!-- Offline Banner Heuristic -->
        ${this.state.useMock ? `
          <div class="bg-[#ff9f0a]/10 border border-[#ff9f0a]/20 rounded-3xl p-5 flex gap-4 select-none animate-pulse">
            <svg class="w-5 h-5 text-[#ff9f0a] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div class="space-y-1 text-left">
              <h4 class="text-xs font-extrabold text-white">Visualização de Demonstração (Off-line)</h4>
              <p class="text-[11px] text-zinc-400 font-medium leading-relaxed max-w-2xl">
                O site está operando com dados mockados offline. Configure suas credenciais do Google Cloud na guia <strong>Configurações</strong> e faça login para carregar os arquivos e listas do seu próprio Google Drive em tempo real.
              </p>
            </div>
          </div>
        ` : `
          <div class="bg-[#30d158]/5 border border-[#30d158]/15 rounded-3xl p-5 flex gap-4 select-none">
            <svg class="w-5 h-5 text-[#30d158] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <div class="space-y-1 text-left">
              <h4 class="text-xs font-extrabold text-[#30d158]">Sincronização Ativa ao G-Drive</h4>
              <p class="text-[11px] text-zinc-400 font-medium leading-relaxed max-w-2xl">
                Toda alteração de jogo na lista será enviada imediatamente ao arquivo <code>lista.txt</code> na pasta de destino no seu Drive. Miniaturas WebP de alta fidelidade são carregadas sob demanda.
              </p>
            </div>
          </div>
        `}

        <!-- Stats deck Grid -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 select-none">
          <!-- Statcard 1 -->
          <div class="p-5 rounded-2xl bg-white/[0.015] border border-white/[0.05] flex items-center gap-4 hover:translate-y-[-2px] transition-transform duration-300">
            <div class="w-11 h-11 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/15 shrink-0">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            </div>
            <div>
              <p class="text-[10px] text-zinc-500 font-bold uppercase tracking-widest leading-tight">Miniaturas WebP</p>
              <h2 class="text-xl font-extrabold text-white mt-1 leading-none">${this.state.catalogItems.filter(i=>i.hasWebp).length}</h2>
            </div>
          </div>

          <!-- Statcard 2 -->
          <div class="p-5 rounded-2xl bg-white/[0.015] border border-white/[0.05] flex items-center gap-4 hover:translate-y-[-2px] transition-transform duration-300">
            <div class="w-11 h-11 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-400 border border-orange-500/15 shrink-0">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <div>
              <p class="text-[10px] text-zinc-500 font-bold uppercase tracking-widest leading-tight">Pendentes</p>
              <h2 class="text-xl font-extrabold text-white mt-1 leading-none">${pendingGamesCount}</h2>
            </div>
          </div>

          <!-- Statcard 3 -->
          <div class="p-5 rounded-2xl bg-white/[0.015] border border-white/[0.05] flex items-center gap-4 hover:translate-y-[-2px] transition-transform duration-300">
            <div class="w-11 h-11 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 border border-emerald-500/15 shrink-0">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <div>
              <p class="text-[10px] text-zinc-500 font-bold uppercase tracking-widest leading-tight">Listados & OK</p>
              <h2 class="text-xl font-extrabold text-white mt-1 leading-none">${completedGames}</h2>
            </div>
          </div>

          <!-- Statcard 4 -->
          <div class="p-5 rounded-2xl bg-white/[0.015] border border-white/[0.05] flex items-center gap-4 hover:translate-y-[-2px] transition-transform duration-300">
            <div class="w-11 h-11 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400 border border-purple-500/15 shrink-0">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            </div>
            <div>
              <p class="text-[10px] text-zinc-500 font-bold uppercase tracking-widest leading-tight">Total Cadastrado</p>
              <h2 class="text-xl font-extrabold text-white mt-1 leading-none">${totalListedCount}</h2>
            </div>
          </div>
        </div>

        <!-- Middle section: Circular health gauge & Pending Priority Drawer -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          <!-- Circular Score Card -->
          <div class="rounded-3xl bg-white/[0.015] border border-white/[0.05] p-6 lg:p-8 flex flex-col justify-between select-none relative overflow-hidden">
            <div class="absolute top-0 right-0 w-32 h-32 bg-[#0a84ff]/5 blur-3xl rounded-full translate-x-1/3 -translate-y-1/3"></div>
            
            <h3 class="text-sm font-black text-white tracking-normal mb-1 relative z-10 flex items-center gap-2">
              <span class="w-1.5 h-1.5 rounded-full bg-[#0a84ff] shadow-[0_0_8px_#0a84ff]"></span>
              Saúde do Catálogo
            </h3>
            
            <!-- Dynamic SVG Ring -->
            <div class="relative py-6 flex items-center justify-center select-none z-10">
              <svg class="w-48 h-48 transform -rotate-90 overflow-visible" viewBox="0 0 192 192">
                <circle cx="96" cy="96" r="84" fill="transparent" stroke="rgba(255, 255, 255, 0.03)" stroke-width="12"></circle>
                <!-- Completed gradient display path -->
                <circle cx="96" cy="96" r="84" fill="transparent" stroke="#0a84ff" stroke-width="12"
                        stroke-dasharray="${circumference}" stroke-dashoffset="${strokeDashoffset}" stroke-linecap="round"
                        class="transition-all duration-1000 ease-in-out drop-shadow-[0_0_12px_rgba(10,132,255,0.4)]"></circle>
              </svg>
              <div class="absolute inset-0 flex flex-col items-center justify-center select-none">
                <span class="text-3xl font-black text-[#0a84ff] tracking-tight mb-0.5">${healthPercent}%</span>
                <span class="text-[9px] text-[#30d158] font-bold uppercase tracking-widest">MINIATURAS REAIS</span>
              </div>
            </div>

            <div class="flex justify-between border-t border-white/[0.05] pt-4 select-none relative z-10">
              <div class="text-center">
                <span class="text-[9px] text-zinc-500 font-bold uppercase tracking-wider block">Completo</span>
                <span class="text-sm font-extrabold text-white mt-1 block">${completedGames} / ${totalListedCount}</span>
              </div>
              <div class="text-center border-l border-white/[0.05] pl-6">
                <span class="text-[9px] text-zinc-500 font-bold uppercase tracking-wider block">Apenas WebPs (Sem Lista)</span>
                <span class="text-sm font-extrabold text-white mt-1 block">${unlistedWebps}</span>
              </div>
            </div>
          </div>

          <!-- Next Queue Drawer -->
          <div class="lg:col-span-2 rounded-3xl bg-white/[0.015] border border-white/[0.05] p-6 lg:p-8 flex flex-col relative overflow-hidden select-none">
            <h3 class="text-sm font-black text-white tracking-normal flex items-center justify-between">
              <span class="flex items-center gap-2">
                <span class="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"></span>
                Prioridades Pendentes de Design
              </span>
              <span class="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Pendente (${pendingGamesCount})</span>
            </h3>

            <!-- Horizontal grid of missing webps -->
            <div class="flex-1 mt-6">
              ${pendingGamesCount === 0 ? `
                <div class="h-full flex flex-col items-center justify-center text-center py-12 gap-3 leading-relaxed">
                  <div class="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 text-emerald-400">
                    <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <p class="text-xs font-bold text-white">Acervo perfeito!</p>
                  <p class="text-[10px] text-zinc-500 max-w-[240px] font-semibold tracking-wide">Todas as suas miniaturas listadas já existem no Google Drive.</p>
                </div>
              ` : `
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                  ${listedItems.filter(i => !i.hasWebp).slice(0, 4).map(game => `
                    <div class="p-4 rounded-2xl bg-white/[0.02] border border-white/[0.04] flex flex-col justify-between h-34 text-left shadow-sm select-none hover:bg-white/[0.04] transition-all relative">
                      <div class="absolute top-2 right-2 w-4 h-4 rounded-full bg-[#ff9f0a]/15 text-[#ff9f0a] border border-[#ff9f0a]/20 flex items-center justify-center text-[8px] font-bold">!</div>
                      <div class="space-y-1">
                        <span class="text-[8px] font-extrabold uppercase tracking-wider block ${PROVIDER_BADGE_STYLE[game.providerName.toLowerCase()] || PROVIDER_BADGE_STYLE['default']}">
                          ${game.providerName}
                        </span>
                        <h4 class="text-xs font-black text-white line-clamp-2 leading-tight pr-3">${game.displayName}</h4>
                      </div>
                      <button data-trigger-add-webp="${game.id}" class="text-[10px] font-bold bg-[#ff9f0a]/10 hover:bg-[#ff9f0a]/20 text-[#ff9f0a] py-1.5 px-3 rounded-lg border border-[#ff9f0a]/15 transition-all text-center cursor-pointer">
                        Fazer Webp
                      </button>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>
          </div>
        </div>

      </div>
    `;
  }

  /**
   * VIEW: MINIATURAS (THUMBNAIL CATALOUGE)
   */
  private renderCatalog(container: HTMLElement) {
    const providers = Array.from(new Set(this.state.catalogItems.map(i => i.providerName)));

    // Filters logic
    let items = this.state.catalogItems;

    if (this.state.filterProvider !== 'todos') {
      items = items.filter(i => this.normalizeName(i.providerName) === this.normalizeName(this.state.filterProvider));
    }

    if (this.state.filterStatus === 'disponiveis') {
      items = items.filter(i => i.hasWebp);
    } else if (this.state.filterStatus === 'ausentes') {
      items = items.filter(i => !i.hasWebp);
    }

    if (this.state.searchQuery.trim() !== '') {
      const q = this.normalizeName(this.state.searchQuery);
      items = items.filter(i => i.normalizedName.includes(q) || this.normalizeName(i.providerName).includes(q));
    }

    container.innerHTML = `
      <div class="space-y-6 select-none">
        <!-- Title and Filter Rails -->
        <div class="flex flex-col gap-4">
          <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1.5">
            <h1 class="text-2xl font-black text-white tracking-tight">Miniaturas do Drive</h1>
            <span class="text-[11px] sm:text-xs text-zinc-500 font-bold uppercase tracking-wider">${items.length} itens correspondentes</span>
          </div>

          <!-- Glass search and filter bar resembling iOS Settings/Toolbar -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 bg-white/[0.015] border border-white/[0.05] p-3 rounded-2xl">
            <!-- Search field -->
            <div class="relative">
              <input type="text" id="catalouge-search" value="${this.state.searchQuery}" placeholder="Buscar jogo..." class="glass-input w-full pl-10 pr-4">
              <svg class="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>

            <!-- Provider Select dropdown -->
            <select id="catalouge-provider-filter" class="glass-input cursor-pointer">
              <option value="todos" ${this.state.filterProvider === 'todos' ? 'selected' : ''}>Todos os Provedores</option>
              ${providers.map(p => `
                <option value="${p}" ${this.state.filterProvider === p ? 'selected' : ''}>${p}</option>
              `).join('')}
            </select>

            <!-- Status Select Segment -->
            <select id="catalouge-status-filter" class="glass-input cursor-pointer">
              <option value="todos" ${this.state.filterStatus === 'todos' ? 'selected' : ''}>Todos os Status</option>
              <option value="disponiveis" ${this.state.filterStatus === 'disponiveis' ? 'selected' : ''}>Disponíveis (.webp)</option>
              <option value="ausentes" ${this.state.filterStatus === 'ausentes' ? 'selected' : ''}>Faltando WebPs</option>
            </select>
          </div>
        </div>

        <!-- Catalog Items Grid -->
        ${items.length === 0 ? `
          <div class="py-24 text-center space-y-3">
            <svg class="w-10 h-10 text-zinc-600 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <p class="text-zinc-500 text-xs font-bold uppercase tracking-wider">Nenhum resultado encontrado.</p>
          </div>
        ` : `
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
            ${items.map(item => {
              const gradient = PROVIDER_GRADIENTS[item.providerName.toLowerCase()] || PROVIDER_GRADIENTS['default'];
              const glow = PROVIDER_BORDER_GLOWS[item.providerName.toLowerCase()] || PROVIDER_BORDER_GLOWS['default'];
              
              return `
                <div data-catalog-key="${item.id}" class="group relative aspect-[2/3] rounded-3xl overflow-hidden bg-neutral-950 border border-white/[0.08] hover:border-white/20 shadow-[0_8px_32px_rgba(0,0,0,0.6)] cursor-pointer transition-all duration-300 transform hover:scale-[1.03]" style="box-shadow: 0 10px 30px -8px rgba(0,0,0,0.7), 0 0 1px 1px flex;">
                  <!-- Image element carrying high quality thumbnail -->
                  ${item.hasWebp ? `
                    <img id="thumb-${item.id}" src="" alt="${item.displayName}" class="w-full h-full object-cover select-none brightness-95 group-hover:brightness-105 transition-all duration-500">
                  ` : `
                    <!-- Beautiful Procedural abstract layout if visual absent -->
                    <div class="absolute inset-0 bg-gradient-to-tr from-neutral-900 via-[#181820] to-neutral-850 flex flex-col justify-between p-4 text-left select-none">
                      <div class="text-[8px] font-extrabold uppercase tracking-widest text-[#ff9f0a] bg-[#ff9f0a]/10 border border-[#ff9f0a]/15 px-2 py-0.5 rounded-full w-fit">
                        PENDENTE
                      </div>
                      <div class="space-y-1.5 leading-none mt-auto">
                        <span class="text-[8px] text-zinc-500 font-bold uppercase tracking-widest block">${item.providerName}</span>
                        <h4 class="text-xs font-black text-white leading-tight block">${item.displayName}</h4>
                        <span class="text-[7px] text-zinc-600 font-bold mt-2 block uppercase tracking-wider">Fazer upload no Drive</span>
                      </div>
                    </div>
                  `}

                  <!-- Foreground overlays -->
                  <div class="absolute inset-0 bg-gradient-to-t ${gradient} opacity-90 group-hover:opacity-100 transition-all pointer-events-none"></div>
                  
                  <!-- Metadata texts over full WebPs -->
                  ${item.hasWebp ? `
                    <div class="absolute inset-x-0 bottom-0 p-4 text-left space-y-1 z-10 leading-none select-none">
                      <span class="text-[8px] text-zinc-400 font-black uppercase tracking-widest block">${item.providerName}</span>
                      <h4 class="text-xs font-black text-white leading-snug line-clamp-2 block">${item.displayName}</h4>
                    </div>
                  ` : ''}

                  <!-- Visual touch click feedback layer -->
                  <div class="absolute inset-0 ring-1 ring-white/10 group-hover:ring-white/20 transition-all rounded-3xl pointer-events-none"></div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;

    // High performance lazy load of the heavy Drive thumbnails triggers AFTER drawing DOM
    items.forEach(item => {
      if (item.hasWebp && item.driveFileId) {
        const imgEl = document.getElementById(`thumb-${item.id}`) as HTMLImageElement;
        if (imgEl) {
          this.loadThumbnailSrc(item.driveFileId, imgEl);
        }
      }
    });
  }

  /**
   * VIEW: LIST MANAGER (DOCK GROUP / lista.txt EDITOR)
   */
  private renderListManager(container: HTMLElement) {
    const listGames: GameItem[] = [];
    const lines = this.state.listContent.split(/\r?\n/);
    
    // Parse current items to group them on the screen cleanly inside Vanilla UI
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

    // Group items
    const groupsMap = new Map<string, GameItem[]>();
    listGames.forEach(g => {
      const arr = groupsMap.get(g.providerName) || [];
      arr.push(g);
      groupsMap.set(g.providerName, arr);
    });

    const groupsList = Array.from(groupsMap.entries());

    container.innerHTML = `
      <div class="space-y-6 select-none relative">
        <div class="flex flex-col sm:flex-row justify-between gap-3 sm:items-center pb-2 border-b border-white/[0.05]">
          <div>
            <h1 class="text-2xl font-black text-white tracking-tight">Gerenciador de lista.txt</h1>
            <p class="text-zinc-500 text-xs mt-0.5">Adicione ou exclua jogos diretamente da lista sincronizada no Google Drive.</p>
          </div>
          <div class="flex items-center gap-2 self-start sm:self-auto shrink-0">
            <button id="btn-add-provider" class="flex items-center gap-1.5 text-xs font-bold py-2.5 px-4 rounded-xl bg-white/[0.04] text-white hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/10 transition-all select-none cursor-pointer">
              <svg class="w-3.5 h-3.5 text-zinc-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
              <span>Novo Provedor</span>
            </button>
            <button id="btn-add-games-main" class="flex items-center gap-1.5 text-xs font-bold py-2.5 px-4 rounded-xl bg-[#0a84ff]/20 text-white hover:bg-[#0a84ff]/30 border border-[#0a84ff]/35 transition-all select-none cursor-pointer">
              <svg class="w-3.5 h-3.5 text-[#0a84ff] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
              <span>Adicionar Jogos</span>
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          <!-- Collapsible lists column -->
          <div class="lg:col-span-2 space-y-4">
            ${groupsList.length === 0 ? `
              <div class="py-24 text-center italic text-zinc-600 text-xs">Nenhum provedor ou jogo listado.</div>
            ` : `
              ${groupsList.map(([providerName, games], groupIdx) => `
                <div class="rounded-2xl border border-white/[0.05] bg-white/[0.01] divide-y divide-white/[0.03]">
                  <!-- Collapsed Provider Title Block -->
                  <div class="flex justify-between items-center px-5 py-3 hover:bg-white/[0.02] transition-colors">
                    <span class="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                      <span class="w-2 h-2 rounded-full ${PROVIDER_BADGE_STYLE[providerName.toLowerCase()] ? 'bg-[#0a84ff]' : 'bg-purple-500'}"></span>
                      Provedor: ${providerName}
                    </span>
                    <div class="flex items-center gap-2">
                      <span class="text-[10px] bg-white/5 border border-white/10 px-2 py-0.5 rounded-full text-zinc-400 font-bold pr-2.5 pl-2.5 mr-1 block leading-tight">
                        ${games.length} jogos
                      </span>
                      <button data-trigger-add-game="${providerName}" class="w-7 h-7 rounded-lg bg-[#0a84ff]/10 hover:bg-[#0a84ff]/20 text-[#0a84ff] border border-[#0a84ff]/20 flex items-center justify-center cursor-pointer transition-colors">
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
                      </button>
                    </div>
                  </div>

                  <!-- Games list -->
                  <div class="p-3 bg-neutral-950/20 divide-y divide-white/[0.015]">
                    ${games.map(game => {
                      const key = `${this.normalizeName(game.providerName)}::${game.normalizedName}`;
                      const catalogItem = this.state.catalogItems.find(i => i.id === key);
                      const hasWebp = catalogItem?.hasWebp || false;

                      return `
                        <div class="flex justify-between items-center py-2 px-3 text-sm rounded-lg hover:bg-white/[0.01] transition-colors leading-none select-none">
                          <div class="flex items-center gap-2.5">
                            <span class="w-1.5 h-1.5 rounded-full ${hasWebp ? 'bg-[#30d158]' : 'bg-orange-500'}"></span>
                            <span class="text-xs font-sans text-white font-bold leading-none pr-3">${game.displayName}</span>
                            <span class="text-[8px] font-extrabold tracking-wider px-1.5 py-0.5 rounded leading-none ${hasWebp ? 'bg-[#30d158]/5 text-[#30d158] border border-[#30d158]/10' : 'bg-[#ff9f0a]/5 text-[#ff9f0a] border border-[#ff9f0a]/10'}">
                              ${hasWebp ? '.WEBP' : 'FALTANDO'}
                            </span>
                          </div>
                          <button data-delete-catalog-key="${key}" class="w-7 h-7 rounded-lg bg-red-500/5 hover:bg-red-500/15 border border-red-500/10 hover:border-red-500/25 flex items-center justify-center cursor-pointer transition-all text-red-400">
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

          <!-- Raw live console reader segment on side -->
          <div class="rounded-3xl bg-neutral-950 border border-white/[0.05] p-6 lg:p-7 flex flex-col justify-between h-fit select-none">
            <div class="space-y-4">
              <span class="text-[9px] text-[#0a84ff] font-extrabold uppercase tracking-widest block leading-none">Console Visualizer</span>
              <h3 class="text-sm font-black text-white tracking-normal mt-1 block">Live lista.txt</h3>
              <p class="text-[10px] text-zinc-500 leading-normal">Formato bruto do arquivo que está salvo no seu Google Drive. Não edite quebras de linha manuais para evitar corrupção.</p>
              
              <pre class="bg-neutral-900 border border-white/[0.04] p-4 rounded-2xl text-[10px] font-mono text-zinc-400 overflow-x-auto max-h-[350px] leading-relaxed custom-scrollbar select-text">${this.state.listContent}</pre>
            </div>
          </div>

        </div>
      </div>

      <!-- Add Game Modal -->
      ${this.state.isAddingGame ? `
        <div class="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center select-none">
          <div class="w-full max-w-sm bg-[#131317] border border-white/[0.08] p-6 rounded-3xl shadow-[0_32px_64px_rgba(0,0,0,0.6)] flex flex-col">
            <h3 class="text-sm font-black text-white uppercase tracking-wider mb-3 leading-none font-sans">Adicionar Jogos à Lista</h3>
            
            <div class="mb-4 text-left">
              <label class="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1.5 block font-sans">Selecione o Provedor</label>
              <select id="modal-add-game-provider-select" class="glass-input w-full block bg-[#1c1c24] border border-white/10 rounded-xl px-3 py-2 text-xs text-white select-none">
                ${groupsList.map(([prov]) => `
                  <option value="${prov}" ${prov === this.state.addingGameToProvider ? 'selected' : ''}>${prov}</option>
                `).join('')}
              </select>
            </div>

            <div class="mb-5 text-left">
              <label class="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1.5 block font-sans">Nomes dos Jogos (Um por linha)</label>
              <textarea id="new-game-displayNames" placeholder="Escreva os nomes dos jogos aqui...&#10;Fortune Tiger&#10;Sweet Bonanza&#10;Gates of Olympus" class="glass-input w-full block bg-[#1c1c24] border border-white/10 rounded-xl px-3 py-2 text-xs text-white min-h-[110px] leading-relaxed custom-scrollbar outline-none"></textarea>
            </div>
            
            <div class="flex items-center gap-3">
              <button id="modal-add-game-cancel" class="glass-btn-secondary flex-1 cursor-pointer">Cancelar</button>
              <button id="modal-add-game-confirm" class="glass-btn-primary flex-1 cursor-pointer">Adicionar</button>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Add Provider Modal -->
      <div id="add-provider-dialog" class="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center select-none hidden">
        <div class="w-full max-w-sm bg-[#131317] border border-white/[0.08] p-6 rounded-3xl shadow-[0_32px_64px_rgba(0,0,0,0.6)] flex flex-col">
          <h3 class="text-sm font-black text-white uppercase tracking-wider mb-2 leading-none">Criar Novo Provedor</h3>
          <p class="text-[10px] text-zinc-500 mb-5 leading-normal">Insira o nome fantasia do Provedor. Ele aparecerá no formato <code>Provedor: [Nome]</code> na lista.</p>
          
          <input type="text" id="new-provider-name" placeholder="Nome do Provedor (e.g. Spribe, Red Tiger)" class="glass-input w-full block mb-5">
          
          <div class="flex items-center gap-3">
            <button id="dialog-add-provider-cancel" class="glass-btn-secondary flex-1 cursor-pointer">Cancelar</button>
            <button id="dialog-add-provider-confirm" class="glass-btn-primary flex-1 cursor-pointer">Criar Seção</button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * VIEW: LOGS & CONSOLE (MACOS STYLE CONSOLE LOG FEED)
   *//**
   * VIEW: LOGS & CONSOLE (MACOS STYLE CONSOLE LOG FEED)
   */
  private renderLogsTab(container: HTMLElement) {
    container.innerHTML = `
      <div class="space-y-6 select-none flex flex-col h-full h-[80vh]">
        <div class="pb-2 border-b border-white/[0.05]">
          <h1 class="text-2xl font-black text-white tracking-tight">Terminal Console</h1>
          <p class="text-zinc-500 text-xs mt-0.5">Acompanhamento de transações de entrada e saída com a API REST do Google Drive.</p>
        </div>

        <div class="flex-1 min-h-0 bg-neutral-950 border border-white/[0.06] rounded-3xl p-5 flex flex-col relative overflow-hidden">
          <div class="flex items-center gap-2 mb-4">
            <span class="w-3 h-3 rounded-full bg-[#ff453a]"></span>
            <span class="w-3 h-3 rounded-full bg-[#ff9f0a]"></span>
            <span class="w-3 h-3 rounded-full bg-[#30d158]"></span>
            <span class="text-[10px] text-zinc-550 font-mono ml-3 font-semibold uppercase tracking-wider relative top-[0.5px]">Log de Conexão</span>
          </div>

          <!-- Console Body -->
          <div id="log-scroller" class="flex-1 overflow-y-auto font-mono text-[11px] text-zinc-300 leading-relaxed pr-2 custom-scrollbar select-text">
          </div>
        </div>
      </div>
    `;
    this.renderLogs();
  }

  private renderLogs() {
    const scroller = document.getElementById('log-scroller');
    if (!scroller) return;

    scroller.innerHTML = this.state.logs.map(log => {
      // Color coding keys
      let colorClass = 'text-zinc-400';
      if (log.includes('Erro') || log.includes('falhou')) {
         colorClass = 'text-red-400 font-bold';
      } else if (log.includes('sucesso') || log.includes('Acesso concedido') || log.includes('ID:')) {
         colorClass = 'text-emerald-400';
      } else if (log.includes('Aviso')) {
         colorClass = 'text-amber-400 font-medium';
      } else if (log.includes('Iniciando') || log.includes('Buscando')) {
         colorClass = 'text-blue-400';
      }

      return `<div class="${colorClass}">${log}</div>`;
    }).join('');
  }

  /**
   * VIEW: CONFIGURAÇÕES (OAUTH SETUP DECK)
   */
  private renderSettings(container: HTMLElement) {
    container.innerHTML = `
      <div class="space-y-8 select-none">
        <div class="pb-2 border-b border-white/[0.05]">
          <h1 class="text-2xl font-black text-white tracking-tight">Ajustes de Integração</h1>
          <p class="text-zinc-500 text-xs mt-0.5">Insira suas credenciais da api do Google Drive para ligar a sincronização automática.</p>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          <!-- Input card fields -->
          <div class="lg:col-span-2 rounded-3xl bg-white/[0.015] border border-white/[0.05] p-6 lg:p-8 space-y-5 h-fit select-none">
            <h3 class="text-sm font-black text-white uppercase tracking-wider mb-1 flex items-center gap-2">
              <span class="w-1.5 h-1.5 rounded-full bg-[#0a84ff] shadow-[0_0_8px_#0a84ff]"></span>
              Parâmetros de Acesso API
            </h3>

            <!-- Client ID Input -->
            <div class="space-y-1.5">
              <div class="flex justify-between items-center text-xs font-semibold">
                <label for="conf-clientId" class="text-zinc-300">Google Client ID (OAuth 2.0)</label>
                <a href="https://console.cloud.google.com/" target="_blank" class="text-[#0a84ff] hover:underline">Ir para Google Cloud Console</a>
              </div>
              <input type="text" id="conf-clientId" value="${this.config.clientId}" placeholder="Faltando credencial client_id.apps.googleusercontent.com" class="glass-input w-full block">
              <p class="text-[9px] text-zinc-650 font-medium">Forneça o Client ID gerado pelo console do desenvolvedor GCP com suporte a JavaScript Origins habilitado.</p>
            </div>

            <!-- Folder Name Input -->
            <div class="space-y-1.5">
              <label for="conf-folder" class="text-xs font-semibold text-zinc-300">Nome da pasta no Google Drive</label>
              <input type="text" id="conf-folder" value="${this.config.folderName}" placeholder="e.g. Thumbs" class="glass-input w-full block">
              <p class="text-[9px] text-zinc-650 font-medium">As miniaturas WebP e o arquivo de lista serão arquivados dentro desta pasta na raiz do seu Drive.</p>
            </div>

            <!-- List file name Input -->
            <div class="space-y-1.5">
              <label for="conf-file" class="text-xs font-semibold text-zinc-300">Nome do arquivo de lista</label>
              <input type="text" id="conf-file" value="${this.config.listFileName}" placeholder="e.g. lista.txt" class="glass-input w-full block">
            </div>

            <div class="flex items-center gap-3 pt-2">
              <button id="btn-save-config" class="glass-btn-primary flex-1 cursor-pointer">Salvar Preferências</button>
            </div>
          </div>

          <!-- Step Guide Card -->
          <div class="rounded-3xl bg-neutral-950 border border-white/[0.05] p-6 lg:p-7 select-none">
            <span class="text-[9px] text-emerald-400 font-extrabold uppercase tracking-widest block mb-4 leading-none">Tutoriais rápidos</span>
            <h3 class="text-sm font-black text-white tracking-normal block mb-4">Como obter seu Client ID</h3>

            <div class="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar text-xs text-zinc-400 relative leading-relaxed">
              <div class="flex gap-3 text-left">
                <span class="w-5 h-5 rounded-full bg-zinc-900 border border-white/5 shrink-0 flex items-center justify-center font-bold text-[10px] text-white">1</span>
                <div>
                  <h4 class="font-bold text-white text-xs">Crie um projeto do Google</h4>
                  <p class="text-[10px] leading-relaxed text-zinc-500 mt-0.5">Acesse o Google Cloud Console e crie um projeto limpo chamando "ThumbSync".</p>
                </div>
              </div>

              <div class="flex gap-3 text-left">
                <span class="w-5 h-5 rounded-full bg-zinc-900 border border-white/5 shrink-0 flex items-center justify-center font-bold text-[10px] text-white">2</span>
                <div>
                  <h4 class="font-bold text-white text-xs">Ativar Google Drive API</h4>
                  <p class="text-[10px] leading-relaxed text-zinc-500 mt-0.5 font-sans">Vá em Biblioteca, busque por "Google Drive API" e clique em Ativar para o projeto.</p>
                </div>
              </div>

              <div class="flex gap-3 text-left">
                <span class="w-5 h-5 rounded-full bg-zinc-900 border border-white/5 shrink-0 flex items-center justify-center font-bold text-[10px] text-white">3</span>
                <div>
                  <h4 class="font-bold text-white text-xs">Ajuste da Tela de Consentimento</h4>
                  <p class="text-[10px] leading-relaxed text-zinc-500 mt-0.5 leading-snug">Vá em Tela de Consentimento OAuth, defina o tipo "Externo", preencha seu e-mail e adicione o escopo do Google Drive (<code>https://www.googleapis.com/auth/drive</code>).</p>
                </div>
              </div>

              <div class="flex gap-3 text-left">
                <span class="w-5 h-5 rounded-full bg-zinc-900 border border-white/5 shrink-0 flex items-center justify-center font-bold text-[10px] text-white">4</span>
                <div>
                  <h4 class="font-bold text-white text-xs">Gere o Client ID (Tela Credenciais)</h4>
                  <p class="text-[10px] leading-relaxed text-zinc-500 mt-0.5 leading-snug">Clique em Criar Credenciais, ID do Cliente OAuth, tipo <strong>Aplicativo da Web</strong>. No campo <strong>Origens JavaScript autorizadas</strong> adicione a URL deste site (ex: <code>${window.location.origin}</code>). Salve e copie o Client ID!</p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    `;
  }

  /**
   * Renders the bottom sheet custom preview modal for a catalog item
   */
  private renderPreviewModal(item: CatalogItem) {
    const modal = document.getElementById('preview-modal');
    const content = document.getElementById('modal-content');
    if (!modal || !content) return;

    modal.classList.remove('pointer-events-none', 'opacity-0');
    
    // Animate scale matching iOS
    const child = modal.firstElementChild;
    if (child) child.classList.remove('scale-95');

    const fileSizeStr = item.fileSize ? `${Math.round(Number(item.fileSize) / 1024)} KB` : 'Indeterminado';
    const modifiedStr = item.modifiedTime ? new Date(item.modifiedTime).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', hour: '2-digit', minute:'2-digit' }) : 'Simulado';

    content.innerHTML = `
      <div class="flex flex-col gap-5 pt-4 text-left select-none relative h-full">
        <!-- Visual frame mockup -->
        <div class="relative w-full aspect-[2/3] rounded-2xl overflow-hidden bg-neutral-950 border border-white/5 shadow-inner">
          <img id="modal-img-preview" src="" alt="${item.displayName}" class="w-full h-full object-cover">
          <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent"></div>
        </div>

        <div class="space-y-1 mt-1 leading-none select-none">
          <span class="text-[10px] font-black uppercase tracking-widest ${PROVIDER_BADGE_STYLE[item.providerName.toLowerCase()] || PROVIDER_BADGE_STYLE['default']} block">${item.providerName}</span>
          <h2 class="text-lg font-black text-white leading-normal mt-1 block">${item.displayName}</h2>
        </div>

        <!-- Detail decks -->
        <div class="divide-y divide-white/[0.05] border-t border-b border-white/[0.05] py-2 text-xs text-zinc-400 select-none">
          <div class="flex justify-between py-2">
            <span>Uso da Arte:</span>
            <span class="text-white font-bold">${item.isListed ? 'Catalogo principal (lista.txt)' : 'Arquivo solto no Drive'}</span>
          </div>
          <div class="flex justify-between py-2">
            <span>Tamanho do Arquivo:</span>
            <span class="text-white font-bold">${fileSizeStr}</span>
          </div>
          <div class="flex justify-between py-2">
            <span>Sincronizado em:</span>
            <span class="text-zinc-300 font-bold font-mono">${modifiedStr}</span>
          </div>
          <div class="flex justify-between py-2">
            <span>Formato:</span>
            <span class="text-emerald-400 font-bold uppercase font-mono">WEBP de Alta Fidelidade</span>
          </div>
        </div>

        <!-- Action triggers block -->
        <div class="flex flex-col gap-2 select-none relative mt-auto pb-4">
          <button id="modal-action-download" class="glass-btn-primary cursor-pointer select-none">
            <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            <span>Baixar Miniature (.webp)</span>
          </button>
        </div>
      </div>
    `;

    // Render localized image inside the popup
    const previewImg = document.getElementById('modal-img-preview') as HTMLImageElement;
    if (previewImg) {
      if (item.hasWebp && item.driveFileId) {
        this.loadThumbnailSrc(item.driveFileId, previewImg);
      } else {
        // Mock image loader
        previewImg.src = 'data:image/svg+xml;base64,' + btoa(`
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" width="100%" height="100%">
            <defs>
              <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#152033" />
                <stop offset="100%" stop-color="#a855f7" stop-opacity="0.2" />
              </linearGradient>
            </defs>
            <rect width="200" height="300" fill="url(#g)" />
            <text x="50%" y="50%" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="900" font-size="16" fill="#fff" opacity="0.95">
              SEM IMAGEM
            </text>
          </svg>
        `);
      }
    }

    // Attach local modal trigger action
    const btnDownload = document.getElementById('modal-action-download');
    if (btnDownload) {
      btnDownload.addEventListener('click', () => {
        this.handleDownloadFile(item);
      });
    }
  }

  private closePreviewModal() {
    const modal = document.getElementById('preview-modal');
    if (!modal) return;

    modal.classList.add('pointer-events-none', 'opacity-0');
    const child = modal.firstElementChild;
    if (child) child.classList.add('scale-95');
  }

  /**
   * WIRES UP BROAD WINDOW GLOBAL ACTIONS
   */
  private bindGlobalEvents() {
    // Nav Links clicks
    const navButtons = document.querySelectorAll('aside nav button, [data-mobile-tab-btn]');
    navButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = (e.currentTarget as HTMLElement).getAttribute('data-tab');
        if (tab) {
          this.setActiveTab(tab);
        }
      });
    });

    // Verification btn click
    const btnSync = document.getElementById('btn-sync-gdrive');
    if (btnSync) {
      btnSync.addEventListener('click', () => {
        this.syncWithGoogleDrive();
      });
    }

    // Connect trigger
    const btnLogin = document.getElementById('btn-login');
    if (btnLogin) {
      btnLogin.addEventListener('click', () => {
         this.handleGoogleLogin();
      });
    }

    // Exit trigger
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', () => {
         this.handleGoogleLogout();
      });
    }

    // Modal popup outer clicks
    const modal = document.getElementById('preview-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closePreviewModal();
        }
      });
    }

    // Close btn modal popup click
    const btnCloseModal = document.getElementById('modal-close');
    if (btnCloseModal) {
      btnCloseModal.addEventListener('click', () => {
        this.closePreviewModal();
      });
    }
  }

  /**
   * WIRES TAB-SPECIFIC SUB COMPONENT LOGIC
   */
  private bindTabEvents() {
    // ------------------- VIEW: DASHBOARD -------------------
    if (this.state.activeTab === 'dashboard') {
       // Highlighting dashboard trigger elements
       const addWebpTriggers = document.querySelectorAll('[data-trigger-add-webp]');
       addWebpTriggers.forEach(btn => {
         btn.addEventListener('click', (e) => {
           const id = (e.currentTarget as HTMLElement).getAttribute('data-trigger-add-webp');
           const catalogItem = this.state.catalogItems.find(i => i.id === id);
           if (catalogItem) {
             this.setActiveTab('catalog');
             this.state.searchQuery = catalogItem.displayName;
             this.render();
           }
         });
       });
    }

    // ------------------- VIEW: CATALOGUE -------------------
    if (this.state.activeTab === 'catalog') {
       // Live inputs values change listeners
       const searchInput = document.getElementById('catalouge-search') as HTMLInputElement;
       if (searchInput) {
         searchInput.addEventListener('input', (e) => {
           this.state.searchQuery = (e.currentTarget as HTMLInputElement).value;
           let debounceTimer: NodeJS.Timeout;
           clearTimeout(debounceTimer!);
           debounceTimer = setTimeout(() => {
             this.renderActiveTab();
           }, 300);
         });
       }

       const providerSelect = document.getElementById('catalouge-provider-filter') as HTMLSelectElement;
       if (providerSelect) {
         providerSelect.addEventListener('change', (e) => {
            this.state.filterProvider = (e.currentTarget as HTMLSelectElement).value;
            this.renderActiveTab();
         });
       }

       const statusSelect = document.getElementById('catalouge-status-filter') as HTMLSelectElement;
       if (statusSelect) {
         statusSelect.addEventListener('change', (e) => {
            this.state.filterStatus = (e.currentTarget as HTMLSelectElement).value;
            this.renderActiveTab();
         });
       }

       // Cards clicks -> Preview Modals trigger
       const cardElements = document.querySelectorAll('[data-catalog-key]');
       cardElements.forEach(card => {
         card.addEventListener('click', (e) => {
           const key = (e.currentTarget as HTMLElement).getAttribute('data-catalog-key');
           const item = this.state.catalogItems.find(i => i.id === key);
           if (item) {
             this.state.selectedCatalogItem = item;
             this.renderPreviewModal(item);
           }
         });
       });
    }

    // ------------------- VIEW: LIST MANAGER -------------------
    if (this.state.activeTab === 'list_manager') {
       // Create section/provider trigger dialog
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
           const input = document.getElementById('new-provider-name') as HTMLInputElement;
           if (input && input.value.trim() !== '') {
              const name = input.value.trim();
              
              // Append provider header to listContent structure
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

       // Trigger game additions
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
           const provider = (e.currentTarget as HTMLElement).getAttribute('data-trigger-add-game') || '';
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
           const providerSelect = document.getElementById('modal-add-game-provider-select') as HTMLSelectElement;
           const textarea = document.getElementById('new-game-displayNames') as HTMLTextAreaElement;
           
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

       // Trigger deletes/exclusions from lists
       const deleteTriggers = document.querySelectorAll('[data-delete-catalog-key]');
       deleteTriggers.forEach(btn => {
         btn.addEventListener('click', (e) => {
           const key = (e.currentTarget as HTMLElement).getAttribute('data-delete-catalog-key');
           const catalogItem = this.state.catalogItems.find(i => i.id === key);
           if (catalogItem) {
             this.handleExcludeGameFromList(catalogItem);
           }
         });
       });
    }

    // ------------------- VIEW: SETTINGS -------------------
    if (this.state.activeTab === 'settings') {
      const btnSaveConfig = document.getElementById('btn-save-config');
      if (btnSaveConfig) {
        btnSaveConfig.addEventListener('click', () => {
          const clientIdInput = document.getElementById('conf-clientId') as HTMLInputElement;
          const folderInput = document.getElementById('conf-folder') as HTMLInputElement;
          const fileInput = document.getElementById('conf-file') as HTMLInputElement;

          if (clientIdInput && folderInput && fileInput) {
            this.config.clientId = clientIdInput.value.trim();
            this.config.folderName = folderInput.value.trim() || 'Thumbs';
            this.config.listFileName = fileInput.value.trim() || 'lista.txt';
            
            this.saveStateToStorage();
            this.addLog("Configurações atualizadas localmente.");
            
            // Re-initialize GIS Token Client automatically if clientId changed
            this.initGISAutomatic();
            
            alert("Ajustes salvos com sucesso! Verifique a conexão para aplicar.");
            this.render();
          }
        });
      }
    }
  }
}

// Instantiate App once page is fully painted
window.addEventListener('load', () => {
  new ThumbSyncApp().render();
});
