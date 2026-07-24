/**
 * ThumbSync Client Component - Vanilla ES Module
 * Companion do Sistema de sincronização de miniaturas de jogos voltado para o cliente
 * 100% Client-Side, compatível com GitHub Pages (sem backend Node/NPM obrigatório).
 */

import { classifyGame, loadMappings } from './gameClassifier.js';
import { firebaseService } from './firebaseService.js';


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
    if (!fileId && parentFolderId) {
      try {
        const existingFiles = await this.listFilesInFolder(parentFolderId);
        const match = existingFiles.find(f => f.name.toLowerCase() === fileName.toLowerCase());
        if (match) {
          fileId = match.id;
        }
      } catch (err) {
        console.warn(`Erro ao verificar existência de ${fileName} antes de salvar:`, err);
      }
    }

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
      hasSeenOnboarding: false,
      filterProvider: 'todos',
      filterStatus: 'todos',
      filterTag: 'todos',
      filterDate: 'recent',
      searchQuery: '',
      customTags: {},

      // Modal state
      selectedCatalogItem: null,
      isAddingGame: false,
      isImportingCSV: false,
      isEditingGameName: false,
      editingGameItem: null,
      addingGameToProvider: '',
      selectedListKeys: new Set(),
      collapsedProviderKeys: new Set(),
      catalogPage: 1,
      notifiedNotFoundGames: false,

      // History state
      historyItems: [],
      itemAddedDates: {},
      muralSubTab: 'active',
      historySearchQuery: '',
      historyFileId: null,
      datesFileId: null,
      emersonAccountsFileId: null,

      // Database status (Firebase as primary, Drive as backup/fallback)
      activeDatabase: 'Firebase'
    };

    this.config = {
      clientId: '284266654862-bt52sui73h7jbd4tc44u99n0aaiev6og.apps.googleusercontent.com',
      folderName: 'Thumbs',
      listFileName: 'lista.txt',
      tagsFileName: 'tags.json',
      historyFileName: 'historico.json',
      addedDatesFileName: 'added_dates.json',
    };

    this.imageCache = new Map(); // fileId -> objectURL
    this.observers = [];

    this.addLog("Inicializando módulo ThumbSync...");
    this.state.customLogos = {};
    fetch('./custom_logos.json')
      .then(res => {
        if (!res.ok) throw new Error("Falha ao obter custom_logos.json");
        return res.json();
      })
      .then(data => {
        this.state.customLogos = data;
        this.addLog("Branding e logos de provedores adicionais aplicados ao catálogo.");
        this.render();
      })
      .catch(err => {
        console.error("Erro carregando logos de fornecedores:", err);
      });

    this.loadStateFromStorage();
    this.loadDataFromFirebase();
    this.initGISAutomatic();

    // Fallback listeners para expiração de token
    window.addEventListener('gdrive_unauthorized', () => {
      this.addLog("Sessão Google desautenticada ou expirada.");
      this.state.gdriveConnected = false;
      this.syncLocalCatalog();
      this.render();
    });

    // Smart Sync Strategy: Sincronização inteligente sem estourar cotas da API do Google Drive
    this.startSmartSync();
  }

  /**
   * Inicializa a estratégia de Smart Sync:
   * - 3.5 segundos quando o usuário está ativamente na aba
   * - 15 segundos em segundo plano (aba inativa)
   * - Sincronização imediata ao focar ou alterar visibilidade
   */
  startSmartSync() {
    let syncInterval = null;

    const runSyncLoop = () => {
      if (syncInterval) clearInterval(syncInterval);
      const isVisible = document.visibilityState === 'visible';
      const frequency = isVisible ? 3500 : 15000;

      syncInterval = setInterval(() => {
        this.syncSilent();
      }, frequency);
    };

    runSyncLoop();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.syncSilent();
      }
      runSyncLoop();
    });

    window.addEventListener('focus', () => {
      this.syncSilent();
    });
  }

  getUserEmail() {
    return this.state.googleUser?.emailAddress || localStorage.getItem('thumbsync_user_email') || '';
  }

  async registerEmersonAccount(email) {
    if (!email) return;
    try {
      const saved = this.getEmersonAccounts();
      const lower = email.toLowerCase().trim();
      const isAdminEmail = this.getAdminAccounts().map(e => e.toLowerCase()).includes(lower);
      if (!isAdminEmail && !saved.includes(lower)) {
        saved.push(lower);
        localStorage.setItem('thumbsync_emerson_accounts', JSON.stringify(saved));
        await this.saveEmersonAccounts();
      }
    } catch (e) {
      console.error("Erro ao registrar conta de Emerson:", e);
    }
  }

  async saveEmersonAccounts() {
    const saved = this.getEmersonAccounts();
    localStorage.setItem('thumbsync_emerson_accounts', JSON.stringify(saved));

    // Sincronização Dupla: Firebase Firestore
    try {
      const fbOk = await firebaseService.saveData('emerson_accounts', { items: saved });
      if (fbOk) this.state.activeDatabase = 'Firebase';
    } catch (e) {
      console.warn("Erro ao salvar emerson_accounts.json no Firebase:", e);
    }

    if (driveClient.isAuthenticated() && this.state.thumbsFolderId) {
      try {
        const fileId = await driveClient.saveTextFile(
          'emerson_accounts.json',
          JSON.stringify(saved, null, 2),
          this.state.thumbsFolderId,
          this.state.emersonAccountsFileId
        );
        if (fileId) {
          this.state.emersonAccountsFileId = fileId;
        }
      } catch (e) {
        console.warn("Erro ao salvar emerson_accounts.json no Drive:", e);
      }
    }
  }

  getAdminAccounts() {
    try {
      return JSON.parse(localStorage.getItem('thumbsync_admin_accounts') || '[]');
    } catch (e) {
      return [];
    }
  }

  getEmersonAccounts() {
    try {
      return JSON.parse(localStorage.getItem('thumbsync_emerson_accounts') || '[]');
    } catch (e) {
      return [];
    }
  }

  getProfile() {
    const email = (this.getUserEmail()).toLowerCase().trim();
    const isAdminEmail = email && this.getAdminAccounts().map(e => e.toLowerCase()).includes(email);

    if (isAdminEmail) {
      return {
        name: 'André Luiz',
        role: 'administrador',
        isAdmin: true,
        email: email,
        badgeText: 'Administrador (André Luiz)',
        badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30 shadow-sm'
      };
    }

    if (email) {
      this.registerEmersonAccount(email);
    }

    return {
      name: 'Emerson',
      role: 'usuario',
      isAdmin: false,
      email: email,
      badgeText: 'Usuário (Emerson)',
      badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/30 shadow-sm'
    };
  }

  isAdmin() {
    return this.getProfile().isAdmin;
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
      // Agendar renovação automática do token restaurado do storage
      setTimeout(() => this.scheduleTokenRefresh(), 0);
    }

    try {
      this.state.customTags = JSON.parse(localStorage.getItem('thumbsync_custom_tags')) || {};
    } catch (e) {
      this.state.customTags = {};
    }
    this.state.historyItems = [];
    this.state.itemAddedDates = {};

    // Unificar e garantir que os dados do histórico fornecidos estejam sempre presentes
    this.ensureSeedHistoryAndDates();
    try {
      const savedUser = localStorage.getItem('thumbsync_google_user');
      if (savedUser) {
        this.state.googleUser = JSON.parse(savedUser);
      }
    } catch (e) {
      this.state.googleUser = null;
    }
    this.state.filterTag = localStorage.getItem('thumbsync_filter_tag') || 'todos';
    this.state.filterDate = localStorage.getItem('thumbsync_filter_date') || 'recent';
    this.state.hasSeenOnboarding = localStorage.getItem('thumbsync_has_seen_onboarding') === 'true';

    this.syncLocalCatalog();
  }

  saveStateToStorage() {
    localStorage.setItem('thumbsync_client_id', this.config.clientId);
    localStorage.setItem('thumbsync_folder_name', this.config.folderName);
    localStorage.setItem('thumbsync_list_file_name', this.config.listFileName);
    localStorage.setItem('thumbsync_tags_file_name', this.config.tagsFileName);
    localStorage.setItem('thumbsync_cached_list_content', this.state.listContent);
    localStorage.setItem('thumbsync_custom_tags', JSON.stringify(this.state.customTags || {}));
    this.state.filterTag = this.state.filterTag || 'todos';
    this.state.filterDate = this.state.filterDate || 'recent';
  }

  async loadDataFromFirebase() {
    try {
      const data = await firebaseService.loadAllData();
      if (data && firebaseService.getStatus().connected) {
        let loadedAny = false;
        if (data.lista && typeof data.lista.content === 'string' && data.lista.content.trim().length > 0) {
          this.state.listContent = data.lista.content;
          loadedAny = true;
        }
        if (data.tags && data.tags.data && Object.keys(data.tags.data).length > 0) {
          this.state.customTags = { ...this.state.customTags, ...data.tags.data };
          loadedAny = true;
        }
        if (data.history && Array.isArray(data.history.items) && data.history.items.length > 0) {
          this.mergeDriveHistory(data.history.items);
          loadedAny = true;
        }
        if (data.dates && data.dates.data && Object.keys(data.dates.data).length > 0) {
          this.state.itemAddedDates = { ...this.state.itemAddedDates, ...data.dates.data };
          loadedAny = true;
        }
        if (data.admin_accs && Array.isArray(data.admin_accs.items) && data.admin_accs.items.length > 0) {
          const local = this.getAdminAccounts();
          const combined = Array.from(new Set([...local, ...data.admin_accs.items].map(a => a.toLowerCase().trim()))).filter(Boolean);
          localStorage.setItem('thumbsync_admin_accounts', JSON.stringify(combined));
          loadedAny = true;
        }
        if (data.emerson && Array.isArray(data.emerson.items) && data.emerson.items.length > 0) {
          const local = this.getEmersonAccounts();
          const combined = Array.from(new Set([...local, ...data.emerson.items].map(a => a.toLowerCase().trim()))).filter(Boolean);
          localStorage.setItem('thumbsync_emerson_accounts', JSON.stringify(combined));
          loadedAny = true;
        }

        this.state.activeDatabase = 'Firebase';
        this.addLog("Dados sincronizados com o Firebase Firestore.");
        this.saveStateToStorage();
        this.syncLocalCatalog();
        this.render();
        return loadedAny;
      } else {
        this.state.activeDatabase = 'Google Drive (Fallback)';
        this.render();
        return false;
      }
    } catch (e) {
      console.warn("Aviso ao carregar dados do Firebase:", e);
      this.state.activeDatabase = 'Google Drive (Fallback)';
      this.render();
      return false;
    }
  }

  async pushAllToFirebase() {
    try {
      const p1 = firebaseService.saveData('lista', { content: this.state.listContent || '' });
      const p2 = firebaseService.saveData('tags', { data: this.state.customTags || {} });
      const p3 = firebaseService.saveData('history', { items: this.state.historyItems || [] });
      const p4 = firebaseService.saveData('dates', { data: this.state.itemAddedDates || {} });
      const p5 = firebaseService.saveData('emerson_accounts', { items: this.getEmersonAccounts() || [] });

      const results = await Promise.all([p1, p2, p3, p4, p5]);
      if (results.every(r => r === true)) {
        this.state.activeDatabase = 'Firebase';
        this.addLog("Todos os 5 arquivos foram sincronizados no Firebase Firestore.");
      } else {
        this.state.activeDatabase = 'Google Drive (Fallback)';
        this.addLog("Aviso: Falha parcial no Firebase. O Google Drive está operando como BD de fallback.");
      }
    } catch (e) {
      console.warn("Erro ao sincronizar dados com o Firebase:", e);
      this.state.activeDatabase = 'Google Drive (Fallback)';
    }
  }

  ensureSeedHistoryAndDates() {
    const seedAddedDates = {
      "playtech::premium american roulette": "2026-07-22",
      "playtech::mini roulette": "2026-07-22",
      "playtech::fire blaze adventure trail": "2026-07-22",
      "playtech::casino hold 'em (ao vivo)": "2026-07-22",
      "playtech::casino hold 'em live (ao vivo)": "2026-07-22",
      "amusnet::ancient dynasty": "2026-07-22",
      "playtech::fluffy favourites cash collect": "2026-07-22",
      "playtech::the racaroon 2": "2026-07-22",
      "playtech::the racaroon 2 jackpot": "2026-07-22",
      "pragmatic play::sleeping dragon ultra dark": "2026-07-22"
    };

    const seedHistoryItems = [
      {
        "id": "amusnet::ancient dynasty",
        "displayName": "Ancient Dynasty",
        "normalizedName": "ancient dynasty",
        "providerName": "Amusnet",
        "hasWebp": true,
        "driveFileId": "1OO6ipYo4HT8yH2mjYK2VisRxLzdzyTud",
        "fileSize": "1070222",
        "modifiedTime": "2026-07-22T17:09:03.101Z",
        "addedDate": "2026-07-22",
        "completedDate": "2026-07-22T20:28:52.588Z",
        "isHistoryItem": true
      },
      {
        "id": "playtech::fluffy favourites cash collect",
        "displayName": "Fluffy Favourites: Cash Collect",
        "normalizedName": "fluffy favourites cash collect",
        "providerName": "Playtech",
        "hasWebp": true,
        "driveFileId": "1eTes30IuCoz5Q1lo6DATrIPKEmT5metJ",
        "fileSize": "845942",
        "modifiedTime": "2026-07-22T17:12:53.774Z",
        "addedDate": "2026-07-22",
        "completedDate": "2026-07-22T20:28:52.588Z",
        "isHistoryItem": true
      },
      {
        "id": "playtech::the racaroon 2",
        "displayName": "The Racaroon 2",
        "normalizedName": "the racaroon 2",
        "providerName": "Playtech",
        "hasWebp": true,
        "driveFileId": "1uz_ROhYmKGHWK7IBUMgH6f-5BLW5q750",
        "fileSize": "1150786",
        "modifiedTime": "2026-07-22T17:11:38.104Z",
        "addedDate": "2026-07-22",
        "completedDate": "2026-07-22T20:28:52.588Z",
        "isHistoryItem": true
      },
      {
        "id": "playtech::the racaroon 2 jackpot",
        "displayName": "The Racaroon 2 Jackpot",
        "normalizedName": "the racaroon 2 jackpot",
        "providerName": "Playtech",
        "hasWebp": true,
        "driveFileId": "16FslxgzU2WbRG7VBQJGOxQXNC_9lxbH4",
        "fileSize": "787318",
        "modifiedTime": "2026-07-22T17:10:21.093Z",
        "addedDate": "2026-07-22",
        "completedDate": "2026-07-22T20:28:52.588Z",
        "isHistoryItem": true
      },
      {
        "id": "pragmatic play::sleeping dragon ultra dark",
        "displayName": "Sleeping Dragon Ultra Dark",
        "normalizedName": "sleeping dragon ultra dark",
        "providerName": "Pragmatic Play",
        "hasWebp": true,
        "driveFileId": "1Rm--o7p-f7Uv1ilkuWXqeDsOAQJtmrND",
        "fileSize": "1132728",
        "modifiedTime": "2026-07-22T17:20:03.156Z",
        "addedDate": "2026-07-22",
        "completedDate": "2026-07-22T20:28:52.588Z",
        "isHistoryItem": true
      },
      {
        "id": "playtech::casino hold 'em (ao vivo)",
        "displayName": "Casino Hold 'Em (Ao Vivo)",
        "normalizedName": "casino hold 'em (ao vivo)",
        "providerName": "Playtech",
        "hasWebp": true,
        "addedDate": "2026-07-22",
        "completedDate": "2026-07-22T20:28:52.588Z",
        "isHistoryItem": true
      },
      {
        "id": "playtech::casino hold 'em live (ao vivo)",
        "displayName": "Casino Hold 'Em Live (Ao Vivo)",
        "normalizedName": "casino hold 'em live (ao vivo)",
        "providerName": "Playtech",
        "hasWebp": true,
        "addedDate": "2026-07-22",
        "completedDate": "2026-07-22T20:28:52.588Z",
        "isHistoryItem": true
      },
      {
        "id": "playtech::fire blaze adventure trail",
        "displayName": "Fire Blaze: Adventure Trail",
        "normalizedName": "fire blaze adventure trail",
        "providerName": "Playtech",
        "hasWebp": true,
        "addedDate": "2026-07-22",
        "completedDate": "2026-07-22T20:28:52.588Z",
        "isHistoryItem": true
      },
      {
        "id": "playtech::mini roulette",
        "displayName": "Mini Roulette",
        "normalizedName": "mini roulette",
        "providerName": "Playtech",
        "hasWebp": true,
        "addedDate": "2026-07-22",
        "completedDate": "2026-07-22T20:28:52.588Z",
        "isHistoryItem": true
      },
      {
        "id": "playtech::premium american roulette",
        "displayName": "Premium American Roulette",
        "normalizedName": "premium american roulette",
        "providerName": "Playtech",
        "hasWebp": true,
        "addedDate": "2026-07-22",
        "completedDate": "2026-07-22T20:28:52.588Z",
        "isHistoryItem": true
      }
    ];

    if (!this.state.itemAddedDates) this.state.itemAddedDates = {};
    this.state.itemAddedDates = { ...seedAddedDates, ...this.state.itemAddedDates };

    if (!this.state.historyItems || this.state.historyItems.length === 0) {
      this.state.historyItems = seedHistoryItems;
    }

    if (this.state.historyItems) {
      this.state.historyItems.forEach(item => {
        if (!item.addedDate) {
          if (item.addedAt) {
            item.addedDate = item.addedAt.split('T')[0];
          } else {
            item.addedDate = this.getAddedDateForItem(item.id);
          }
        }
      });
    }
  }

  getTodayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  formatDateToBR(dateStr) {
    if (!dateStr) return '';
    if (dateStr.includes('-')) {
      const parts = dateStr.split('T')[0].split('-');
      if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
    }
    return dateStr;
  }

  getAddedDateForItem(itemId) {
    if (this.state.itemAddedDates && this.state.itemAddedDates[itemId]) {
      return this.state.itemAddedDates[itemId];
    }
    const today = this.getTodayDateString();
    if (!this.state.itemAddedDates) this.state.itemAddedDates = {};
    this.state.itemAddedDates[itemId] = today;
    this.saveAddedDates();
    return today;
  }

  recordAddedDatesForGames(providerName, gameNames) {
    const today = this.getTodayDateString();
    if (!this.state.itemAddedDates) this.state.itemAddedDates = {};
    let changed = false;
    (gameNames || []).forEach(name => {
      const normName = this.normalizeName(name);
      if (!normName) return;
      const key = `${this.normalizeName(providerName)}::${normName}`;
      if (!this.state.itemAddedDates[key]) {
        this.state.itemAddedDates[key] = today;
        changed = true;
      }
    });
    if (changed) {
      this.saveAddedDates();
    }
  }

  async saveAddedDates() {
    // Sincronização Dupla: Firebase Firestore
    try {
      const fbOk = await firebaseService.saveData('dates', { data: this.state.itemAddedDates || {} });
      if (fbOk) this.state.activeDatabase = 'Firebase';
    } catch (e) {
      console.warn("Erro ao salvar added_dates.json no Firebase:", e);
    }

    if (driveClient.isAuthenticated() && this.state.thumbsFolderId) {
      try {
        const fileId = await driveClient.saveTextFile(
          this.config.addedDatesFileName,
          JSON.stringify(this.state.itemAddedDates, null, 2),
          this.state.thumbsFolderId,
          this.state.datesFileId
        );
        if (fileId) {
          this.state.datesFileId = fileId;
        }
      } catch (e) {
        console.warn("Erro ao salvar added_dates.json no Drive:", e);
      }
    }
  }

  async saveHistory() {
    // Sincronização Dupla: Firebase Firestore
    try {
      const fbOk = await firebaseService.saveData('history', { items: this.state.historyItems || [] });
      if (fbOk) this.state.activeDatabase = 'Firebase';
    } catch (e) {
      console.warn("Erro ao salvar historico.json no Firebase:", e);
    }

    if (driveClient.isAuthenticated()) {
      try {
        if (!this.state.thumbsFolderId) {
          this.state.thumbsFolderId = await driveClient.findOrCreateFolder(this.config.folderName);
        }
        const fileId = await driveClient.saveTextFile(
          this.config.historyFileName,
          JSON.stringify(this.state.historyItems || [], null, 2),
          this.state.thumbsFolderId,
          this.state.historyFileId
        );
        if (fileId) {
          this.state.historyFileId = fileId;
        }
      } catch (e) {
        console.warn("Erro ao salvar historico.json no Drive:", e);
      }
    }
  }

  isHistoryCandidateFile(f) {
    if (!f || !f.name) return false;
    const name = f.name.toLowerCase();
    if (name === this.config.tagsFileName.toLowerCase()) return false;
    if (name === this.config.addedDatesFileName.toLowerCase()) return false;
    if (name === this.config.listFileName.toLowerCase()) return false;
    if (name === 'emerson_accounts.json') return false;
    if (name === 'custom_logos.json') return false;
    if (name === 'keyword_rules.json') return false;

    return name.includes('historico') || name.includes('history') || name.includes('untitled') || name.endsWith('.json');
  }

  mergeDriveHistory(driveHistory) {
    if (!Array.isArray(driveHistory)) return;
    const map = new Map();
    // 1. Inserir primeiro o histórico atual local
    (this.state.historyItems || []).forEach(item => {
      if (item) {
        const id = item.id || `${item.providerName || ''}::${item.displayName || ''}`.toLowerCase();
        if (id && id !== '::') {
          map.set(id, { ...item, id, isHistoryItem: true });
        }
      }
    });
    // 2. Mesclar todos os itens do Drive (incluindo historico.json e untitled.json)
    driveHistory.forEach(item => {
      if (item) {
        const id = item.id || `${item.providerName || ''}::${item.displayName || ''}`.toLowerCase();
        if (id && id !== '::') {
          map.set(id, { ...item, id, isHistoryItem: true });
        }
      }
    });
    this.state.historyItems = Array.from(map.values());
  }

  async handleImportHistoryFiles(files) {
    if (!files || files.length === 0) return;
    const initialCount = (this.state.historyItems || []).length;
    let filesProcessed = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const text = await file.text();
        let itemsToMerge = [];

        // 1. Tentar parsear como JSON
        try {
          const json = JSON.parse(text);
          if (Array.isArray(json)) {
            itemsToMerge = json;
          } else if (json && typeof json === 'object') {
            if (Array.isArray(json.history)) itemsToMerge = json.history;
            else if (Array.isArray(json.items)) itemsToMerge = json.items;
            else if (Array.isArray(json.data)) itemsToMerge = json.data;
            else if (json.displayName || json.providerName) itemsToMerge = [json];
          }
        } catch (jsonErr) {
          // 2. Se falhar o JSON, parsear como TXT (linha por linha)
          const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          lines.forEach(line => {
            if (line.startsWith('#') || line.startsWith('//')) return;

            let providerName = 'Geral';
            let displayName = line;

            const bracketMatch = line.match(/^\[(.*?)\]\s*(.*)$/);
            if (bracketMatch) {
              providerName = bracketMatch[1].trim() || 'Geral';
              displayName = bracketMatch[2].trim();
            } else if (line.includes(' - ')) {
              const parts = line.split(' - ');
              providerName = parts[0].trim();
              displayName = parts.slice(1).join(' - ').trim();
            } else if (line.includes(': ')) {
              const parts = line.split(': ');
              providerName = parts[0].trim();
              displayName = parts.slice(1).join(': ').trim();
            }

            if (displayName) {
              itemsToMerge.push({
                displayName,
                providerName,
                isHistoryItem: true
              });
            }
          });
        }

        if (itemsToMerge.length > 0) {
          this.mergeDriveHistory(itemsToMerge);
          filesProcessed++;
        }
      } catch (err) {
        console.warn(`Erro ao ler/processar arquivo ${file.name}:`, err);
      }
    }

    this.ensureSeedHistoryAndDates();
    await this.saveHistory();

    const finalCount = (this.state.historyItems || []).length;
    const addedCount = Math.max(0, finalCount - initialCount);

    alert(`🎉 Importação de Histórico Concluída!\n\n• Arquivo(s) lido(s) com sucesso: ${filesProcessed}\n• Novos jogos adicionados: ${addedCount}\n• Total no histórico agora: ${finalCount}\n\nTodas as informações foram mescladas sem criar duplicatas e já foram salvas e enviadas ao Google Drive!`);
    this.render();
  }

  async syncHistoryFromDrive() {
    if (!driveClient.isAuthenticated()) return;
    try {
      if (!this.state.thumbsFolderId) {
        this.state.thumbsFolderId = await driveClient.findOrCreateFolder(this.config.folderName);
      }
      if (this.state.thumbsFolderId) {
        const files = await driveClient.listFilesInFolder(this.state.thumbsFolderId);
        const historyCandidateFiles = files.filter(f => this.isHistoryCandidateFile(f));
        if (historyCandidateFiles.length > 0) {
          historyCandidateFiles.sort((a, b) => new Date(a.modifiedTime || 0) - new Date(b.modifiedTime || 0));
          for (const hFile of historyCandidateFiles) {
            try {
              const historyText = await driveClient.downloadTextFile(hFile.id);
              const driveHistory = JSON.parse(historyText);
              if (Array.isArray(driveHistory) && (driveHistory.length === 0 || driveHistory.some(i => i && (i.displayName || i.isHistoryItem || i.providerName)))) {
                this.mergeDriveHistory(driveHistory);
                if (hFile.name.toLowerCase() === this.config.historyFileName.toLowerCase()) {
                  this.state.historyFileId = hFile.id;
                }
              }
            } catch (e) {}
          }
          this.ensureSeedHistoryAndDates();
          await this.saveHistory();
          this.render();
        }
      }
    } catch (err) {
      console.warn("Erro ao sincronizar histórico direto do Drive:", err);
    }
  }

  async addItemsToHistory(items) {
    if (!items || items.length === 0) return;
    if (!this.state.historyItems) this.state.historyItems = [];
    const map = new Map(this.state.historyItems.map(i => [i.id, i]));
    let addedCount = 0;

    items.forEach(item => {
      const addedDate = this.getAddedDateForItem(item.id);
      const historyObj = {
        id: item.id,
        displayName: item.displayName,
        normalizedName: item.normalizedName,
        providerName: item.providerName,
        hasWebp: true,
        driveFileId: item.driveFileId || '',
        fileSize: item.fileSize || 0,
        modifiedTime: item.modifiedTime || '',
        addedDate: addedDate,
        completedDate: new Date().toISOString(),
        isHistoryItem: true
      };
      map.set(item.id, historyObj);
      addedCount++;
    });

    this.state.historyItems = Array.from(map.values());
    await this.saveHistory();
    this.addLog(`${addedCount} jogo(s) movido(s) para o Histórico de Concluídos.`);
  }

  async restoreItemFromHistory(historyItem) {
    if (!historyItem) return;
    this.addLog(`Restaurando '${historyItem.displayName}' do Histórico para o Mural de Jogos...`);

    this.state.historyItems = (this.state.historyItems || []).filter(i => i.id !== historyItem.id);
    await this.saveHistory();

    await this.fetchLatestListContent();
    await this.handleAddGamesToList(historyItem.providerName, [historyItem.displayName]);

    this.closePreviewModal();
    this.syncLocalCatalog();
    this.render();
    alert(`"${historyItem.displayName}" foi restaurado do Histórico com sucesso e voltou para o Mural de Jogos!`);
  }

  addLog(message) {
    console.log(`[ThumbSync] ${message}`);
    this.state.loadingStatusText = message;
    const statusTxtEl = document.getElementById('gdrive-status-text');
    if (statusTxtEl) {
      statusTxtEl.innerText = message;
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
   * Agenda renovação silenciosa do token antes de expirar.
   * O token OAuth do Google dura ~1h; renovamos 5 min antes do vencimento.
   */
  scheduleTokenRefresh() {
    if (this._tokenRefreshTimer) {
      clearTimeout(this._tokenRefreshTimer);
      this._tokenRefreshTimer = null;
    }

    const tokenExpiresAt = Number(localStorage.getItem('gdrive_token_expires_at') || '0');
    const msUntilExpiry = tokenExpiresAt - Date.now();

    if (msUntilExpiry <= 0) {
      // Já expirou — marcar como desconectado
      this.state.gdriveConnected = false;
      driveClient.setAccessToken('');
      localStorage.removeItem('gdrive_access_token');
      localStorage.removeItem('gdrive_token_expires_at');
      this.syncLocalCatalog();
      this.render();
      return;
    }

    // Renovar 5 minutos antes do vencimento (mínimo: agora + 10 s)
    const refreshIn = Math.max(msUntilExpiry - 5 * 60 * 1000, 10_000);

    this._tokenRefreshTimer = setTimeout(() => {
      this.addLog('Renovando token do Google silenciosamente...');
      try {
        if (typeof window.google === 'undefined' || !this.config.clientId) {
          // SDK não disponível, marcar como expirado
          window.dispatchEvent(new Event('gdrive_unauthorized'));
          return;
        }
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: this.config.clientId,
          scope: 'https://www.googleapis.com/auth/drive',
          prompt: '',          // sem popup — usa consentimento já concedido
          callback: async (response) => {
            if (response.error) {
              this.addLog(`Renovação silenciosa falhou: ${response.error}`);
              // Expirou de vez — avisar o usuário
              this.state.gdriveConnected = false;
              driveClient.setAccessToken('');
              localStorage.removeItem('gdrive_access_token');
              localStorage.removeItem('gdrive_token_expires_at');
              this.syncLocalCatalog();
              this.render();
              return;
            }
            this.addLog('Token renovado com sucesso.');
            driveClient.setAccessToken(response.access_token);
            this.state.gdriveConnected = true;
            localStorage.setItem('gdrive_access_token', response.access_token);
            localStorage.setItem('gdrive_token_expires_at', (Date.now() + response.expires_in * 1000).toString());
            this.scheduleTokenRefresh(); // agendar próxima renovação
            this.render();
          },
        });
        client.requestAccessToken();
      } catch (err) {
        this.addLog(`Erro na renovação silenciosa: ${err.message}`);
        window.dispatchEvent(new Event('gdrive_unauthorized'));
      }
    }, refreshIn);
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
          this.scheduleTokenRefresh(); // agendar renovação automática

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
    this.state.googleUser = null;
    localStorage.removeItem('gdrive_access_token');
    localStorage.removeItem('gdrive_token_expires_at');
    localStorage.removeItem('thumbsync_user_email');
    localStorage.removeItem('thumbsync_google_user');
    this.saveStateToStorage();
    if (this._tokenRefreshTimer) {
      clearTimeout(this._tokenRefreshTimer);
      this._tokenRefreshTimer = null;
    }

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

    // Tentar obter informações do perfil logado via API do Drive
    try {
      const aboutRes = await driveClient.fetchWithAuth('https://www.googleapis.com/drive/v3/about?fields=user');
      if (aboutRes.ok) {
        const aboutData = await aboutRes.json();
        if (aboutData.user) {
          this.state.googleUser = aboutData.user;
          if (aboutData.user.emailAddress) {
            localStorage.setItem('thumbsync_user_email', aboutData.user.emailAddress);
          }
          localStorage.setItem('thumbsync_google_user', JSON.stringify(aboutData.user));
          this.addLog(`Perfil reconhecido: ${aboutData.user.displayName || aboutData.user.emailAddress}`);
        }
      }
    } catch (userErr) {
      console.warn("[ThumbSync] Não foi possível verificar o perfil do usuário Google:", userErr.message);
    }

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

      // Sincronizar Histórico de Concluídos (historico.json, untitled.json e variações)
      const historyCandidateFiles = allFiles.filter(f => this.isHistoryCandidateFile(f));
      if (historyCandidateFiles.length > 0) {
        this.addLog(`Sincronizando histórico do Drive (${historyCandidateFiles.length} arquivo(s)...)`);
        historyCandidateFiles.sort((a, b) => new Date(a.modifiedTime || 0) - new Date(b.modifiedTime || 0));

        for (const hFile of historyCandidateFiles) {
          try {
            const historyText = await driveClient.downloadTextFile(hFile.id);
            const driveHistory = JSON.parse(historyText);
            if (Array.isArray(driveHistory) && (driveHistory.length === 0 || driveHistory.some(i => i && (i.displayName || i.isHistoryItem || i.providerName)))) {
              this.mergeDriveHistory(driveHistory);
              if (hFile.name.toLowerCase() === this.config.historyFileName.toLowerCase()) {
                this.state.historyFileId = hFile.id;
              }
            }
          } catch (e) {
            console.warn("Aviso ao ler arquivo de histórico do Drive:", e);
          }
        }
      }

      // Sincronizar Datas de Adição (added_dates.json)
      const datesFiles = allFiles.filter(f => f.name.toLowerCase() === this.config.addedDatesFileName.toLowerCase());
      if (datesFiles.length > 0) {
        datesFiles.sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0));
        this.state.datesFileId = datesFiles[0].id;

        for (const dFile of datesFiles) {
          try {
            const datesText = await driveClient.downloadTextFile(dFile.id);
            const driveDates = JSON.parse(datesText);
            if (typeof driveDates === 'object' && driveDates !== null) {
              this.state.itemAddedDates = { ...driveDates, ...this.state.itemAddedDates };
            }
          } catch (e) {
            console.warn("Aviso ao ler added_dates.json do Drive:", e);
          }
        }
      }

      // Garantir mesclagem do histórico base fornecido pelo usuário e salvar no Drive
      this.ensureSeedHistoryAndDates();
      await this.saveHistory();
      await this.saveAddedDates();

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

      // Sincronizar Mapeamento de Contas do Perfil Emerson (emerson_accounts.json)
      const emersonAccountsFiles = allFiles.filter(f => f.name.toLowerCase() === 'emerson_accounts.json');
      let driveEmersonAccounts = [];
      if (emersonAccountsFiles.length > 0) {
        emersonAccountsFiles.sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0));
        this.state.emersonAccountsFileId = emersonAccountsFiles[0].id;

        for (const eFile of emersonAccountsFiles) {
          try {
            const content = await driveClient.downloadTextFile(eFile.id);
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) {
              driveEmersonAccounts.push(...parsed);
            }
          } catch (e) {
            console.warn("Aviso ao ler emerson_accounts.json do Drive:", e);
          }
        }
      }

      const currentEmail = (this.getUserEmail()).toLowerCase().trim();
      if (currentEmail && !this.getAdminAccounts().map(e => e.toLowerCase()).includes(currentEmail)) {
        await this.registerEmersonAccount(currentEmail);
      }

      const localEmersonAccounts = this.getEmersonAccounts();
      const combinedAccounts = Array.from(new Set([...localEmersonAccounts, ...driveEmersonAccounts].map(a => a.toLowerCase().trim()))).filter(Boolean);
      localStorage.setItem('thumbsync_emerson_accounts', JSON.stringify(combinedAccounts));
      await this.saveEmersonAccounts();

      // Sincronizar todos os dados atualizados para o Firebase Firestore
      await this.pushAllToFirebase();

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
   * Obtém a versão mais recente do arquivo lista.txt direto do Google Drive
   * imediatamente antes de executar qualquer alteração para evitar sobreescrever
   * modificações concorrentes feitas por outros usuários (prevenindo a ressurreição de dados).
   */
  async fetchLatestListContent() {
    if (driveClient.isAuthenticated()) {
      try {
        let fileId = this.state.listFileId;
        if (!fileId && this.state.thumbsFolderId) {
          const files = await driveClient.listFilesInFolder(this.state.thumbsFolderId);
          const listFile = files.find(f => f.name.toLowerCase() === this.config.listFileName.toLowerCase());
          if (listFile) {
            fileId = listFile.id;
            this.state.listFileId = fileId;
          }
        }
        if (fileId) {
          const latestText = await driveClient.downloadTextFile(fileId);
          if (latestText !== null && latestText !== undefined) {
            this.state.listContent = latestText;
            this.saveStateToStorage();
            this.syncLocalCatalog();
          }
        }
      } catch (err) {
        console.warn("[ThumbSync] Não foi possível re-baixar a lista do Drive antes de alterar:", err.message);
      }
    }
    return this.state.listContent;
  }

  /**
   * Sincronização silenciosa em segundo plano para detectar e refletir alterações concorrentes.
   */
  async syncOnlyListSilent() {
    return this.syncSilent();
  }

  /**
   * Sincronização silenciosa em segundo plano (Drive files + lista.txt)
   * Atualiza a lista.txt e os status de miniaturas (.webp) no Drive em tempo real sem travar a interface.
   */
  async syncSilent() {
    if (!driveClient.isAuthenticated() || this.state.isLoading || this.isSyncingSilent) return;
    this.isSyncingSilent = true;

    try {
      let folderId = this.state.thumbsFolderId;
      if (!folderId) {
        folderId = await driveClient.findOrCreateFolder(this.config.folderName);
        this.state.thumbsFolderId = folderId;
      }

      if (!folderId) return;

      // 1. Listar arquivos e subpastas raiz
      const rootFiles = await driveClient.listFilesInFolder(folderId);

      // 2. Sincronizar lista.txt com verificação inteligente de modifiedTime
      let listFile = rootFiles.find(f => f.name.toLowerCase() === this.config.listFileName.toLowerCase());
      let listChanged = false;
      if (listFile) {
        this.state.listFileId = listFile.id;
        const lastMod = this.state.lastListModifiedTime;
        // Só faz download se o arquivo nunca foi baixado ou se modifiedTime mudou
        if (!this.state.listContent || !lastMod || lastMod !== listFile.modifiedTime) {
          const latestText = await driveClient.downloadTextFile(listFile.id);
          if (latestText !== null && latestText !== undefined && latestText !== this.state.listContent) {
            this.state.listContent = latestText;
            listChanged = true;
          }
          this.state.lastListModifiedTime = listFile.modifiedTime;
        }
      }

      // 3. Separar subpastas (provedores) e arquivos diretos
      const directFiles = [];
      const subfolders = [];
      rootFiles.forEach(f => {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          subfolders.push(f);
        } else {
          directFiles.push(f);
        }
      });

      this.state.driveProviders = subfolders.map(f => f.name);
      const allFiles = [...directFiles];

      // Busca em subpastas de provedores
      await Promise.all(subfolders.map(async (subfolder) => {
        try {
          const subFiles = await driveClient.listFilesInFolder(subfolder.id);
          const processed = subFiles.map(sf => ({
            ...sf,
            providerName: subfolder.name
          }));
          allFiles.push(...processed);
        } catch (e) {
          // ignora erro em subpasta isolada
        }
      }));

      // 4. Comparar os arquivos .webp e lista.txt encontrados com o estado atual
      const getFingerprint = (files) => (files || [])
        .filter(f => f.mimeType === 'image/webp' || f.name.toLowerCase() === this.config.listFileName.toLowerCase())
        .map(f => `${f.id}:${f.name}:${f.modifiedTime || f.size || ''}`)
        .sort()
        .join('|');

      const newFingerprint = getFingerprint(allFiles);
      const currentFingerprint = getFingerprint(this.state.driveFiles);

      let driveFilesChanged = newFingerprint !== currentFingerprint;

      if (driveFilesChanged) {
        this.state.driveFiles = allFiles;
      }

      // 5. Se houve alteração na lista ou nos arquivos do Drive, re-sincroniza o catálogo local e atualiza a tela
      if (listChanged || driveFilesChanged) {
        this.addLog("Sincronização em segundo plano: Status de miniaturas ou lista atualizados.");
        this.saveStateToStorage();
        this.syncLocalCatalog();
        this.render();
      }
    } catch (err) {
      console.warn("[ThumbSync] Auto-sync silencioso em segundo plano:", err.message);
    } finally {
      this.isSyncingSilent = false;
    }
  }

  /**
   * Reconstrói catálogo unificando o arquivo lista.txt com as artes encontradas no Drive
   */
  syncLocalCatalog() {
    const oldCatalogItems = this.state.catalogItems || [];
    const oldWebpStatus = new Map(oldCatalogItems.map(item => [item.id, item.hasWebp]));

    const listGames = [];
    const lines = this.state.listContent.split(/\r?\n/);

    let currentProvider = "Sem provedor";
    const priorityProvidersSet = new Set();

    for (const line of lines) {
      let clean = line.replace(/^\uFEFF/, '').replace(/^\s*(?:[-*•]\s+|\d+\s*[\).\]-]\s*)/, '').trim();
      if (!clean || clean.startsWith('#')) continue;

      const providerMatch = clean.match(/^provedor\s*:\s*(.+)$/i);
      if (providerMatch) {
        let provName = providerMatch[1].trim();
        let isProvPriority = false;
        if (provName.includes('!')) {
          isProvPriority = true;
          provName = provName.replace(/!/g, '').trim();
        }
        currentProvider = provName;
        if (isProvPriority) {
          priorityProvidersSet.add(this.normalizeName(provName));
        }
        continue;
      }

      if (/^provedor\s*:/i.test(clean)) continue;

      let isNotFound = false;
      let isPriority = false;
      if (clean.includes('!')) {
        isPriority = true;
        clean = clean.replace(/!/g, '').trim();
        if (!clean) continue;
      }
      if (clean.includes('?')) {
        isNotFound = true;
        clean = clean.replace(/\?/g, '').trim();
        if (!clean) continue;
      }

      listGames.push({
        displayName: clean,
        normalizedName: this.normalizeName(clean),
        providerName: currentProvider,
        isNotFound: isNotFound,
        isPriority: isPriority
      });
    }

    this.state.priorityProvidersSet = priorityProvidersSet;

    const driveFiles = this.state.driveFiles;
    const itemsMap = new Map();

    listGames.forEach(game => {
      const key = `${this.normalizeName(game.providerName)}::${game.normalizedName}`;
      const addedDate = this.getAddedDateForItem(key);
      itemsMap.set(key, {
        id: key,
        displayName: game.displayName,
        normalizedName: game.normalizedName,
        providerName: game.providerName,
        isListed: true,
        hasWebp: false,
        isNotFound: game.isNotFound,
        isPriority: game.isPriority,
        addedDate: addedDate
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

    const newItems = Array.from(itemsMap.values());

    const newlyCompleted = [];
    if (this.state.hasSeenOnboarding && oldCatalogItems.length > 0) {
      newItems.forEach(item => {
        if (item.hasWebp && oldWebpStatus.has(item.id) && !oldWebpStatus.get(item.id)) {
          newlyCompleted.push(item);
        }
      });
    }

    if (newlyCompleted.length > 0) {
      this.notifyNewlyCompleted(newlyCompleted);
    }

    this.state.catalogItems = newItems;
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

  fuzzyMatch(text, query) {
    if (!query) return true;
    if (!text) return false;

    if (text.includes(query)) return true;

    const queryWords = query.split(/\s+/).filter(Boolean);
    const textWords = text.split(/\s+/).filter(Boolean);

    for (const qw of queryWords) {
      let wordMatched = false;
      for (const tw of textWords) {
        if (tw.includes(qw) || qw.includes(tw)) {
          wordMatched = true;
          break;
        }
        const maxLen = Math.max(qw.length, tw.length);
        const allowedTypos = maxLen <= 3 ? 1 : (maxLen <= 6 ? 2 : 3);
        if (this.levenshteinDistance(qw, tw) <= allowedTypos) {
          wordMatched = true;
          break;
        }
      }
      if (!wordMatched) {
        return false;
      }
    }
    return true;
  }

  levenshteinDistance(a, b) {
    const tmp = [];
    let i, j;
    for (i = 0; i <= a.length; i++) {
      tmp[i] = [i];
    }
    for (j = 0; j <= b.length; j++) {
      tmp[0][j] = j;
    }
    for (i = 1; i <= a.length; i++) {
      for (j = 1; j <= b.length; j++) {
        tmp[i][j] = Math.min(
          tmp[i - 1][j] + 1,
          tmp[i][j - 1] + 1,
          tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return tmp[a.length][b.length];
  }

  calculateCompletionEstimate(pendingCount) {
    if (pendingCount <= 0) {
      return { dateStr: "Tudo em dia!" };
    }

    const maxGamesPerDay = 20;
    const workStartHour = 14;   // 14:00
    const workEndHour = 17.5;   // 17:30
    const workDuration = 3.5;   // 3.5 hours

    let tempPending = pendingCount;
    let currentDate = new Date(); // Use local time

    let iterations = 0;
    while (tempPending > 0 && iterations < 365) {
      iterations++;
      const dayOfWeek = currentDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
      const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);

      if (!isWeekend) {
        let capacityToday = maxGamesPerDay;

        // If today is a workday and we are on the first day, adjust based on current time
        if (iterations === 1) {
          const currentHour = currentDate.getHours() + currentDate.getMinutes() / 60;
          if (currentHour >= workEndHour) {
            capacityToday = 0;
          } else if (currentHour > workStartHour) {
            const timeLeft = workEndHour - currentHour;
            const fraction = timeLeft / workDuration;
            capacityToday = Math.floor(maxGamesPerDay * fraction);
          }
        }

        if (capacityToday > 0) {
          if (tempPending <= capacityToday) {
            // Finish today!
            let startHour = workStartHour;
            if (iterations === 1) {
              const currentHour = currentDate.getHours() + currentDate.getMinutes() / 60;
              if (currentHour > workStartHour) {
                startHour = currentHour;
              }
            }

            const fractionNeeded = tempPending / capacityToday;
            const hoursTodayLeft = (iterations === 1 && currentDate.getHours() + currentDate.getMinutes() / 60 > workStartHour)
              ? (workEndHour - (currentDate.getHours() + currentDate.getMinutes() / 60))
              : workDuration;

            const hoursNeeded = fractionNeeded * hoursTodayLeft;
            const finalDecimalHour = startHour + hoursNeeded;

            const finalHour = Math.floor(finalDecimalHour);
            const finalMinute = Math.floor((finalDecimalHour - finalHour) * 60);

            currentDate.setHours(finalHour, finalMinute, 0, 0);
            tempPending = 0;
            break;
          } else {
            tempPending -= capacityToday;
          }
        }
      }

      // Move to next day, reset to work start time
      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(14, 0, 0, 0);
    }

    const daysOfWeekPt = [
      "Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira",
      "Quinta-feira", "Sexta-feira", "Sábado"
    ];

    const dayName = daysOfWeekPt[currentDate.getDay()];
    const dayOfMonth = String(currentDate.getDate()).padStart(2, '0');
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const hoursStr = String(currentDate.getHours()).padStart(2, '0');
    const minutesStr = String(currentDate.getMinutes()).padStart(2, '0');

    return {
      dateStr: `${dayName}, ${dayOfMonth}/${month} às ${hoursStr}:${minutesStr}`
    };
  }

  getGameTag(item) {
    if (this.state.customTags && this.state.customTags[item.id]) {
      return this.state.customTags[item.id];
    }
    return classifyGame({ name: item.displayName, provider: item.providerName });
  }

  getGameTagHTML(tag) {
    const config = {
      'Ao Vivo':      { color: '#ff453a', pulse: true },
      'Slot':         { color: '#0a84ff', pulse: false },
      'Crash':        { color: '#f59e0b', pulse: false },
      'Mesa RNG':     { color: '#10b981', pulse: false },
      'Instant Win':  { color: '#a855f7', pulse: false },
      'Scratchcard':  { color: '#ec4899', pulse: false },
      'Prioridades':  { color: '#facc15', pulse: true }
    };
    const style = config[tag] || { color: '#8b8c89', pulse: false };
    return `
      <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[8px] font-extrabold uppercase tracking-wider select-none border" 
            style="background: ${style.color}33; color: ${style.color}; border-color: ${style.color}4D; box-shadow: 0 2px 8px ${style.color}26;">
        <span class="w-1 h-1 rounded-full ${style.pulse ? 'animate-pulse' : ''}" style="background-color: ${style.color};"></span>
        ${tag}
      </span>
    `;
  }

  /**
   * Importa jogos de um arquivo CSV, evitando duplicatas e conflitos.
   */
  async handleImportCSV(providerName, file) {
    if (!file) return;

    try {
      const text = await file.text();
      const rows = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);

      if (rows.length === 0) {
        alert("O arquivo selecionado está vazio.");
        return;
      }

      const nameKeywords = ['name', 'customname', 'game', 'gamename', 'displayname', 'titulo', 'nome', 'jogo'];
      const firstLine = rows[0];
      const hasHeader = nameKeywords.some(kw => firstLine.toLowerCase().includes(kw));
      const delimiter = firstLine.includes(';') ? ';' : ',';

      const headers = firstLine.split(delimiter).map(h => h.trim().toLowerCase().replace(/^["']|["']$/g, ''));
      let nameIdx = headers.findIndex(h => nameKeywords.some(kw => h.includes(kw)));
      if (nameIdx === -1) nameIdx = 0; // Fallback para a primeira coluna

      const gamesToImport = [];
      const seenInCSV = new Set();
      const targetProviderNorm = this.normalizeName(providerName);

      // Cache de jogos já listados para este provedor
      const currentlyListedNorms = new Set(
        this.state.catalogItems
          .filter(item => item.isListed && this.normalizeName(item.providerName) === targetProviderNorm)
          .map(item => item.normalizedName)
      );

      const startIndex = hasHeader ? 1 : 0;

      for (let i = startIndex; i < rows.length; i++) {
        const cols = rows[i].split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''));
        const gameName = cols[nameIdx];

        if (gameName) {
          const norm = this.normalizeName(gameName);
          // Evita duplicatas dentro do CSV e conflitos com o que já está na lista.txt
          if (!seenInCSV.has(norm) && !currentlyListedNorms.has(norm)) {
            gamesToImport.push(gameName);
            seenInCSV.add(norm);
          }
        }
      }

      if (gamesToImport.length === 0) {
        alert("Importação finalizada: Nenhum jogo novo foi encontrado (todos já existem ou são duplicatas).");
      } else {
        this.handleAddGamesToList(providerName, gamesToImport);
        alert(`Sucesso! ${gamesToImport.length} novos jogos foram importados para ${providerName}.`);
      }
    } catch (err) {
      console.error("Erro no processamento do CSV:", err);
      alert("Falha ao ler o arquivo CSV. Verifique se o formato está correto.");
    } finally {
      this.state.isImportingCSV = false;
      this.render();
    }
  }

  async updateGameTag(itemId, newTag) {
    if (!this.state.customTags) {
      this.state.customTags = {};
    }

    const oldTag = this.state.customTags[itemId];
    if (oldTag === newTag) return;

    this.state.customTags[itemId] = newTag;
    this.saveStateToStorage();

    // Sincronização Dupla: Firebase Firestore
    try {
      const fbOk = await firebaseService.saveData('tags', { data: this.state.customTags });
      if (fbOk) this.state.activeDatabase = 'Firebase';
    } catch (e) {
      console.warn("Erro ao salvar tag no Firebase:", e);
    }

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

  /**
   * Copia a imagem .webp para a área de transferência no formato original (WEBP)
   * Se o navegador não suportar gravação direta de WebP na área de transferência, realiza fallback para PNG.
   */
  async copyImageToClipboard(item) {
    if (!item.driveFileId) {
      alert("Esta miniatura não possui imagem (.webp) no Google Drive para cópia.");
      return;
    }

    this.addLog(`Copiando miniatura: ${item.displayName}...`);
    try {
      const btn = document.getElementById('modal-action-copy-img');
      const originalHtml = btn ? btn.innerHTML : null;
      if (btn) btn.innerHTML = '<svg class="w-4 h-4 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg><span>Copiando...</span>';

      const blob = await driveClient.downloadBinaryFile(item.driveFileId);
      const webpBlob = new Blob([blob], { type: 'image/webp' });

      try {
        // Tenta copiar no formato original (.webp)
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/webp': webpBlob })
        ]);
        this.addLog(`Miniatura copiada no formato original (.webp) para a área de transferência.`);
      } catch (webpError) {
        console.warn("Navegador não suporta cópia direta de .webp. Convertendo para .png...", webpError);
        
        // Fallback: Converte .webp para .png para garantir compatibilidade com a área de transferência do sistema
        const img = new Image();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const blobUrl = URL.createObjectURL(webpBlob);
        
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = blobUrl;
        });
        
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        
        await new Promise((resolve, reject) => {
          canvas.toBlob(async (pngBlob) => {
            try {
              if (!pngBlob) {
                reject(new Error("Erro na conversão para PNG"));
                return;
              }
              await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': pngBlob })
              ]);
              URL.revokeObjectURL(blobUrl);
              this.addLog(`Miniatura convertida e copiada como .png (fallback automático por limitação do navegador).`);
              resolve();
            } catch (err) {
              URL.revokeObjectURL(blobUrl);
              reject(err);
            }
          }, 'image/png');
        });
      }

      if (btn) {
        btn.innerHTML = '<svg class="w-4 h-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg><span class="text-emerald-400">Copiada!</span>';
        setTimeout(() => {
          btn.innerHTML = originalHtml;
        }, 2000);
      }
    } catch (err) {
      console.error(err);
      alert('Erro ao copiar a imagem. O navegador pode não suportar a cópia de imagens diretamente.');
      const btn = document.getElementById('modal-action-copy-img');
      if (btn) {
        btn.innerHTML = '<svg class="w-4 h-4 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg><span class="text-red-400">Erro</span>';
        setTimeout(() => {
          btn.innerHTML = '<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg><span>Copiar Imagem</span>';
        }, 2000);
      }
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

      // Sincronização Dupla: Firebase Firestore
      try {
        const fbOk = await firebaseService.saveData('lista', { content: newContent });
        if (fbOk) {
          this.state.activeDatabase = 'Firebase';
          this.addLog(`lista.txt atualizada e sincronizada no Firebase Firestore.`);
        } else {
          this.state.activeDatabase = 'Google Drive (Fallback)';
        }
      } catch (e) {
        console.warn("Erro ao salvar lista no Firebase:", e);
        this.state.activeDatabase = 'Google Drive (Fallback)';
      }

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

  showDuplicatedGameToast(games) {
    let existingToast = document.getElementById('duplicate-game-toast');
    if (existingToast) {
      existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.id = 'duplicate-game-toast';
    Object.assign(toast.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%) scale(0.9)',
      zIndex: '10000',
      width: 'max-content',
      maxWidth: 'min(600px, calc(100vw - 40px))',
      background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
      border: '2px solid rgba(99, 102, 241, 0.6)',
      borderRadius: '24px',
      padding: '24px 32px',
      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px rgba(79, 70, 229, 0.3)',
      display: 'flex',
      alignItems: 'center',
      gap: '20px',
      opacity: '0',
      transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
      pointerEvents: 'auto'
    });

    let gamesText = '';
    if (games.length <= 3) {
      gamesText = games.join(', ');
    } else {
      gamesText = `${games.slice(0, 3).join(', ')} e mais ${games.length - 3}`;
    }

    toast.innerHTML = `
      <div style="width:64px; height:64px; border-radius:16px; background:rgba(99, 102, 241, 0.2); border:2px solid rgba(99, 102, 241, 0.4); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      </div>
      <div style="flex:1; min-width:0;">
        <p style="margin:0 0 6px 0; font-size:22px; font-weight:800; color:#e0e7ff; letter-spacing:-0.01em; line-height:1.2;">Aviso: Miniatura já no Drive!</p>
        <p style="margin:0; font-size:16px; color:#c7d2fe; font-weight:500; line-height:1.4;">${games.length === 1 ? 'O jogo' : 'Os jogos'} <strong style="color:#ffffff;">${gamesText}</strong> já possu${games.length === 1 ? 'i' : 'em'} miniatura.</p>
      </div>
      <button id="duplicate-game-toast-close" style="background:transparent; border:none; cursor:pointer; padding:8px; display:flex; align-items:center; justify-content:center; opacity:0.7;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    `;

    document.body.appendChild(toast);

    toast.getBoundingClientRect();
    toast.style.opacity = '1';
    toast.style.transform = 'translate(-50%, -50%) scale(1)';

    const removeToast = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translate(-50%, -50%) scale(0.9)';
      setTimeout(() => toast.remove(), 300);
    };

    toast.querySelector('#duplicate-game-toast-close').addEventListener('click', removeToast);
    setTimeout(removeToast, 7000);
  }

  showNotFoundGamesToast(notFoundGames) {
    if (this.isAdmin()) return;
    if (!notFoundGames || notFoundGames.length === 0) return;
    
    let existingToast = document.getElementById('notfound-game-toast');
    if (existingToast) {
      existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.id = 'notfound-game-toast';
    Object.assign(toast.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%) scale(0.9)',
      zIndex: '10000',
      width: 'max-content',
      maxWidth: 'min(600px, calc(100vw - 40px))',
      background: 'linear-gradient(135deg, #450a0a 0%, #7f1d1d 100%)',
      border: '2px solid rgba(239, 68, 68, 0.6)',
      borderRadius: '24px',
      padding: '24px 32px',
      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px rgba(239, 68, 68, 0.3)',
      display: 'flex',
      alignItems: 'center',
      gap: '20px',
      opacity: '0',
      transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
      pointerEvents: 'auto'
    });

    const count = notFoundGames.length;
    const title = count === 1 ? "1 jogo não encontrado" : `${count} jogos não encontrados`;

    const displayGames = notFoundGames.slice(0, 5).map(g => g.displayName);
    let messageHtml = `<ul style="margin:0; padding-left:16px; margin-top:4px;">`;
    displayGames.forEach(name => {
      messageHtml += `<li>${name}</li>`;
    });
    messageHtml += `</ul>`;

    if (count > 5) {
      const remaining = count - 5;
      messageHtml += `<p style="margin: 6px 0 0 0; font-style: italic;">...e mais ${remaining} jogo${remaining > 1 ? 's' : ''}</p>`;
    }

    messageHtml += `<p style="margin: 12px 0 0 0; font-weight: 600; line-height: 1.3;">Estes jogos não foram de fato encontrados e não foi possível prosseguir com a confecção das artes.</p>`;

    toast.innerHTML = `
      <div style="width:64px; height:64px; border-radius:16px; background:rgba(239, 68, 68, 0.2); border:2px solid rgba(239, 68, 68, 0.4); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
      </div>
      <div style="flex:1; min-width:0;">
        <p style="margin:0 0 6px 0; font-size:22px; font-weight:800; color:#fee2e2; letter-spacing:-0.01em; line-height:1.2;">${title}</p>
        <div style="margin:0; font-size:16px; color:#fecaca; font-weight:500; line-height:1.4;">${messageHtml}</div>
      </div>
      <button id="notfound-game-toast-close" style="background:transparent; border:none; cursor:pointer; padding:8px; display:flex; align-items:flex-start; justify-content:center; opacity:0.7; height:100%;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    `;

    document.body.appendChild(toast);

    toast.getBoundingClientRect();
    toast.style.opacity = '1';
    toast.style.transform = 'translate(-50%, -50%) scale(1)';

    const removeToast = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translate(-50%, -50%) scale(0.9)';
      setTimeout(() => toast.remove(), 300);
    };

    toast.querySelector('#notfound-game-toast-close').addEventListener('click', removeToast);
    setTimeout(removeToast, 7000);
  }

  async handleAddGamesToList(providerName, gameNames) {
    const validGames = gameNames.map(g => g.trim()).filter(Boolean);
    if (validGames.length === 0) return;

    await this.fetchLatestListContent();

    const normProvider = this.normalizeName(providerName);
    const existingItems = [];
    const existingOnDriveNames = validGames.filter(gameName => {
      const normGame = this.normalizeName(gameName);
      const key = `${normProvider}::${normGame}`;
      const catalogItem = this.state.catalogItems.find(i => i.id === key);
      if (catalogItem && catalogItem.hasWebp) {
        existingItems.push(catalogItem);
        return true;
      }
      return false;
    });

    if (existingOnDriveNames.length > 0) {
      this.showDuplicatedGameToast(existingOnDriveNames);
      this.renderPreviewModal(existingItems[0]);
    }

    const gamesToAdd = validGames.filter(g => !existingOnDriveNames.includes(g));

    if (gamesToAdd.length === 0) {
      this.addLog("Nenhum jogo novo adicionado. Todos já possuíam miniatura.");
      return;
    }

    this.recordAddedDatesForGames(providerName, gamesToAdd);

    this.addLog(`Adicionando ${gamesToAdd.length} jogos ao provedor '${providerName}'...`);

    const lines = this.state.listContent.split(/\r?\n/);
    const targetHeaderRegex = new RegExp(`^provedor\\s*:\\s*${providerName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*(!)?\\s*$`, 'i');

    let injected = false;
    const updatedLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      updatedLines.push(line);

      if (targetHeaderRegex.test(line.trim())) {
        gamesToAdd.forEach(gameName => {
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
      gamesToAdd.forEach(gameName => {
        updatedLines.push(gameName);
      });
    }

    this.saveUpdatedList(updatedLines.join('\n'));
  }

  async handleEditGameInList(item, newName) {
    if (!newName || newName.trim() === '' || newName.trim() === item.displayName) return;

    await this.fetchLatestListContent();

    const trimmedNewName = newName.trim();
    this.addLog(`Renomeando '${item.displayName}' para '${trimmedNewName}'...`);

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
          providerNameNormalized: this.normalizeName(providerMatch[1].replace(/!/g, '').trim()),
          games: []
        };
        continue;
      }

      if (currentSection) {
        let isGame = false;
        let normName = '';
        if (cleanLine && !cleanLine.startsWith('#')) {
           isGame = true;
           let searchName = cleanLine;
           if (searchName.includes('?')) {
             searchName = searchName.replace(/\?/g, '').trim();
           }
           if (!searchName) isGame = false;
           normName = this.normalizeName(searchName);
        }

        if (isGame) {
          currentSection.games.push({
            originalLine: line,
            cleanGameName: cleanLine,
            normalizedGameName: normName,
            isBlankOrComment: false
          });
        } else {
          currentSection.games.push({
            originalLine: line,
            cleanGameName: cleanLine,
            normalizedGameName: normName,
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

    let edited = false;
    const targetProviderNormalized = this.normalizeName(item.providerName);

    for (const sec of sections) {
      if (sec.providerNameNormalized === targetProviderNormalized) {
        const idx = sec.games.findIndex(g => !g.isBlankOrComment && g.normalizedGameName === item.normalizedName);
        if (idx !== -1) {
          const game = sec.games[idx];
          if (game.originalLine.includes(game.cleanGameName)) {
            game.originalLine = game.originalLine.replace(game.cleanGameName, trimmedNewName);
          } else {
            game.originalLine = trimmedNewName;
          }
          edited = true;
          this.addLog(`Jogo renomeado com sucesso.`);
          break;
        }
      }
    }

    if (!edited) {
      this.addLog(`Aviso: O jogo original não pôde ser encontrado no texto da lista.`);
      return;
    }

    const finalLines = [...headerLines];
    sections.forEach((sec) => {
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

  async handleToggleNotFound(item) {
    await this.fetchLatestListContent();
    const lines = this.state.listContent.split(/\r?\n/);
    const sections = [];
    let currentSection = null;
    const headerLines = [];

    for (const line of lines) {
      let cleanLine = line.replace(/^\uFEFF/, '').replace(/^\s*(?:[-*•]\s+|\d+\s*[\).\]-]\s*)/, '').trim();

      const providerMatch = cleanLine.match(/^provedor\s*:\s*(.+)$/i);
      if (providerMatch) {
        if (currentSection) sections.push(currentSection);
        currentSection = {
          providerLine: line,
          providerNameNormalized: this.normalizeName(providerMatch[1].replace(/!/g, '').trim()),
          games: []
        };
        continue;
      }

      if (currentSection) {
        let isGame = false;
        let normName = '';
        if (cleanLine && !cleanLine.startsWith('#')) {
           isGame = true;
           let searchName = cleanLine;
           if (searchName.includes('!')) {
             searchName = searchName.replace(/!/g, '').trim();
           }
           if (searchName.includes('?')) {
             searchName = searchName.replace(/\?/g, '').trim();
           }
           if (!searchName) isGame = false;
           normName = this.normalizeName(searchName);
        }

        currentSection.games.push({
          originalLine: line,
          normalizedGameName: normName,
          isBlankOrComment: !isGame,
          cleanGameName: cleanLine
        });
      } else {
        headerLines.push(line);
      }
    }
    if (currentSection) sections.push(currentSection);

    let edited = false;
    const targetProviderNormalized = this.normalizeName(item.providerName);

    for (const sec of sections) {
      if (sec.providerNameNormalized === targetProviderNormalized) {
        const idx = sec.games.findIndex(g => !g.isBlankOrComment && g.normalizedGameName === item.normalizedName);
        if (idx !== -1) {
          const game = sec.games[idx];
          if (item.isNotFound) {
             // Already not found, let's remove '?'
             game.originalLine = game.originalLine.replace(/\?/g, '').trim();
          } else {
             // Mark as not found by appending ' ?'
             game.originalLine = game.originalLine.trimRight() + ' ?';
          }
          edited = true;
          this.addLog(`Status "Não Encontrado" alterado com sucesso.`);
          break;
        }
      }
    }

    if (edited) {
      const finalLines = [...headerLines];
      sections.forEach((sec) => {
        if (finalLines.length > 0 && finalLines[finalLines.length - 1].trim() !== '') finalLines.push('');
        finalLines.push(sec.providerLine);
        sec.games.forEach(g => finalLines.push(g.originalLine));
      });
      const cleanedFileContent = finalLines.join('\n').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
      this.saveUpdatedList(cleanedFileContent);
    }
  }

  async handleTogglePriority(item) {
    await this.fetchLatestListContent();
    const lines = this.state.listContent.split(/\r?\n/);
    const sections = [];
    let currentSection = null;
    const headerLines = [];

    for (const line of lines) {
      let cleanLine = line.replace(/^\uFEFF/, '').replace(/^\s*(?:[-*•]\s+|\d+\s*[\).\]-]\s*)/, '').trim();

      const providerMatch = cleanLine.match(/^provedor\s*:\s*(.+)$/i);
      if (providerMatch) {
        if (currentSection) sections.push(currentSection);
        currentSection = {
          providerLine: line,
          providerNameNormalized: this.normalizeName(providerMatch[1].replace(/!/g, '').trim()),
          games: []
        };
        continue;
      }

      if (currentSection) {
        let isGame = false;
        let normName = '';
        if (cleanLine && !cleanLine.startsWith('#')) {
           isGame = true;
           let searchName = cleanLine;
           if (searchName.includes('!')) {
             searchName = searchName.replace(/!/g, '').trim();
           }
           if (searchName.includes('?')) {
             searchName = searchName.replace(/\?/g, '').trim();
           }
           if (!searchName) isGame = false;
           normName = this.normalizeName(searchName);
        }

        currentSection.games.push({
          originalLine: line,
          normalizedGameName: normName,
          isBlankOrComment: !isGame,
          cleanGameName: cleanLine
        });
      } else {
        headerLines.push(line);
      }
    }
    if (currentSection) sections.push(currentSection);

    let edited = false;
    const targetProviderNormalized = this.normalizeName(item.providerName);

    for (const sec of sections) {
      if (sec.providerNameNormalized === targetProviderNormalized) {
        const idx = sec.games.findIndex(g => !g.isBlankOrComment && g.normalizedGameName === item.normalizedName);
        if (idx !== -1) {
          const game = sec.games[idx];
          if (item.isPriority) {
             // Already priority, let's remove '!'
             game.originalLine = game.originalLine.replace(/!/g, '').trim();
          } else {
             // Mark as priority by appending ' !'
             game.originalLine = game.originalLine.trimRight() + ' !';
          }
          edited = true;
          this.addLog(`Status "Prioridade" alterado com sucesso.`);
          break;
        }
      }
    }

    if (edited) {
      const finalLines = [...headerLines];
      sections.forEach((sec) => {
        if (finalLines.length > 0 && finalLines[finalLines.length - 1].trim() !== '') finalLines.push('');
        finalLines.push(sec.providerLine);
        sec.games.forEach(g => finalLines.push(g.originalLine));
      });
      const cleanedFileContent = finalLines.join('\n').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
      this.saveUpdatedList(cleanedFileContent);
    }
  }

  async handleToggleProviderPriority(providerName) {
    if (!providerName || providerName === "Sem provedor" || providerName === "Jogos Não Encontrados" || providerName === "Prioridades") return;

    await this.fetchLatestListContent();
    const lines = this.state.listContent.split(/\r?\n/);
    const targetNorm = this.normalizeName(providerName);

    let found = false;
    const updatedLines = lines.map(line => {
      const cleanLine = line.replace(/^\uFEFF/, '').trim();
      const match = cleanLine.match(/^provedor\s*:\s*(.+)$/i);
      if (match) {
        let rawProv = match[1].trim();
        let isPriority = false;
        if (rawProv.includes('!')) {
          isPriority = true;
          rawProv = rawProv.replace(/!/g, '').trim();
        }
        if (this.normalizeName(rawProv) === targetNorm) {
          found = true;
          if (isPriority) {
            this.addLog(`Removida prioridade do provedor '${rawProv}'.`);
            return `Provedor: ${rawProv}`;
          } else {
            this.addLog(`Provedor '${rawProv}' marcado como prioritário.`);
            return `Provedor: ${rawProv} !`;
          }
        }
      }
      return line;
    });

    if (!found) {
      if (updatedLines.length > 0 && updatedLines[updatedLines.length - 1].trim() !== '') {
        updatedLines.push('');
      }
      updatedLines.push(`Provedor: ${providerName} !`);
      this.addLog(`Provedor '${providerName}' marcado como prioritário.`);
    }

    await this.saveUpdatedList(updatedLines.join('\n'));
  }

  async handleExcludeGameFromList(item) {
    const isConfirmed = confirm(`Excluir o jogo "${item.displayName}" do catálogo do provedor "${item.providerName}"?\nEsta alteração modificará o arquivo list.txt.`);
    if (!isConfirmed) return;

    await this.fetchLatestListContent();

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
          providerNameNormalized: this.normalizeName(providerMatch[1].replace(/!/g, '').trim()),
          games: []
        };
        continue;
      }

      if (currentSection) {
        let isGame = false;
        let normName = '';
        if (cleanLine && !cleanLine.startsWith('#')) {
           isGame = true;
           let searchName = cleanLine;
           if (searchName.includes('?')) {
             searchName = searchName.replace(/\?/g, '').trim();
           }
           if (!searchName) isGame = false;
           normName = this.normalizeName(searchName);
        }

        if (isGame) {
          currentSection.games.push({
            originalLine: line,
            cleanGameName: cleanLine,
            normalizedGameName: normName,
            isBlankOrComment: false
          });
        } else {
          currentSection.games.push({
            originalLine: line,
            cleanGameName: cleanLine,
            normalizedGameName: normName,
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

    if (deleted && item && item.hasWebp) {
      await this.addItemsToHistory([item]);
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
  async handleClearFinishedGames() {
    const isConfirmed = confirm(`Deseja remover da lista todos os jogos que já possuem miniaturas (.webp) no Drive?\n\nEstes jogos serão movidos para o Histórico de Concluídos (separados por dia de adição) e removidos do Mural de Demandas.`);
    if (!isConfirmed) return;

    await this.fetchLatestListContent();

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
          providerNameNormalized: this.normalizeName(providerMatch[1].replace(/!/g, '').trim()),
          games: []
        };
        continue;
      }

      if (currentSection) {
        let isGame = false;
        let normName = '';
        if (cleanLine && !cleanLine.startsWith('#')) {
           isGame = true;
           let searchName = cleanLine;
           if (searchName.includes('?')) {
             searchName = searchName.replace(/\?/g, '').trim();
           }
           if (!searchName) isGame = false;
           normName = this.normalizeName(searchName);
        }

        currentSection.games.push({
          originalLine: line,
          normalizedGameName: normName,
          isBlankOrComment: !isGame
        });
      } else {
        headerLines.push(line);
      }
    }
    if (currentSection) sections.push(currentSection);

    let removedCount = 0;
    const itemsMovedToHistory = [];
    sections.forEach(sec => {
      sec.games = sec.games.filter(g => {
        if (g.isBlankOrComment) return true;

        const key = `${sec.providerNameNormalized}::${g.normalizedGameName}`;
        const item = this.state.catalogItems.find(ci => ci.id === key);

        if (item && item.hasWebp) {
          removedCount++;
          itemsMovedToHistory.push(item);
          return false;
        }
        return true;
      });
    });

    if (removedCount === 0) {
      alert("Nenhum jogo concluído para limpar.");
      return;
    }

    if (itemsMovedToHistory.length > 0) {
      await this.addItemsToHistory(itemsMovedToHistory);
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
  async handleDeleteSelectedGames() {
    const selectedCount = this.state.selectedListKeys.size;
    if (selectedCount === 0) return;

    const isConfirmed = confirm(`Excluir os ${selectedCount} jogos selecionados da lista de provedores?\nEsta alteração modificará o arquivo ${this.config.listFileName}.`);
    if (!isConfirmed) return;

    await this.fetchLatestListContent();

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
          providerNameNormalized: this.normalizeName(providerMatch[1].replace(/!/g, '').trim()),
          games: []
        };
        continue;
      }

      if (currentSection) {
        let isGame = false;
        let normName = '';
        if (cleanLine && !cleanLine.startsWith('#')) {
           isGame = true;
           let searchName = cleanLine;
           if (searchName.includes('?')) {
             searchName = searchName.replace(/\?/g, '').trim();
           }
           if (!searchName) isGame = false;
           normName = this.normalizeName(searchName);
        }

        currentSection.games.push({
          originalLine: line,
          normalizedGameName: normName,
          isBlankOrComment: !isGame
        });
      } else {
        headerLines.push(line);
      }
    }
    if (currentSection) sections.push(currentSection);

    const itemsMovedToHistory = [];
    sections.forEach(sec => {
      sec.games = sec.games.filter(g => {
        if (g.isBlankOrComment) return true;
        const key = `${sec.providerNameNormalized}::${g.normalizedGameName}`;
        if (this.state.selectedListKeys.has(key)) {
          const item = this.state.catalogItems.find(ci => ci.id === key);
          if (item && item.hasWebp) {
            itemsMovedToHistory.push(item);
          }
          return false;
        }
        return true;
      });
    });

    if (itemsMovedToHistory.length > 0) {
      await this.addItemsToHistory(itemsMovedToHistory);
    }

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

  /**
   * Importa jogos a partir de um arquivo CSV/planilha e os insere no provedor selecionado.
   */
  async handleImportCSV(providerName, file) {
    if (!file || !providerName) return;
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/);
      const gameNames = [];

      lines.forEach(line => {
        const parts = line.split(/[,;]/);
        parts.forEach(part => {
          const clean = part.replace(/^["']|["']$/g, '').trim();
          if (clean && !clean.toLowerCase().includes('name') && !clean.toLowerCase().includes('jogo') && !clean.toLowerCase().includes('titulo')) {
            gameNames.push(clean);
          }
        });
      });

      if (gameNames.length > 0) {
        await this.handleAddGamesToList(providerName, gameNames);
        this.state.isImportingCSV = false;
        this.renderActiveTab();
      } else {
        alert("Nenhum nome de jogo válido foi encontrado na planilha.");
      }
    } catch (err) {
      console.error("Erro ao importar CSV:", err);
      alert("Falha ao ler o arquivo CSV.");
    }
  }

  saveScrollState() {
    if ((this._renderDepth || 0) > 0) return;
    this.savedScrolls = this.savedScrolls || {};
    const main = document.getElementById('main-scroll-container');
    if (main) {
      this.savedScrolls.mainScrollY = main.scrollTop;
      this.savedScrolls.mainScrollX = main.scrollLeft;
    }
    const horizontal = document.getElementById('mural-horizontal-scroll');
    if (horizontal) {
      this.savedScrolls.muralScrollX = horizontal.scrollLeft;
      this.savedScrolls.muralScrollY = horizontal.scrollTop;
    }
    this.savedScrolls.windowY = window.scrollY;
    this.savedScrolls.windowX = window.scrollX;
  }

  restoreScrollState() {
    if ((this._renderDepth || 0) > 0) return;
    if (!this.savedScrolls) return;
    requestAnimationFrame(() => {
      if (this.savedScrolls.windowY !== undefined) {
        window.scrollTo(this.savedScrolls.windowX || 0, this.savedScrolls.windowY || 0);
      }
      const main = document.getElementById('main-scroll-container');
      if (main && this.savedScrolls.mainScrollY !== undefined) {
        main.scrollTop = this.savedScrolls.mainScrollY;
        main.scrollLeft = this.savedScrolls.mainScrollX || 0;
      }
      const horizontal = document.getElementById('mural-horizontal-scroll');
      if (horizontal && this.savedScrolls.muralScrollX !== undefined) {
        horizontal.scrollLeft = this.savedScrolls.muralScrollX;
        horizontal.scrollTop = this.savedScrolls.muralScrollY || 0;
      }
    });
  }

  // --- HTML DRAW PIPELINE ---
  render() {
    this._renderDepth = (this._renderDepth || 0);
    this.saveScrollState();
    this._renderDepth++;
    const root = document.getElementById('root');
    if (!root) return;

    const profile = this.getProfile();
    const listedItems = this.state.catalogItems.filter(i => i.isListed);
    const completedGames = listedItems.filter(i => i.hasWebp).length;
    const totalListedCount = listedItems.length;
    const pendingGamesCount = totalListedCount - completedGames;
    const progressPercent = totalListedCount > 0 ? Math.round((completedGames / totalListedCount) * 100) : 0;
    const estimatedCompletion = this.calculateCompletionEstimate(pendingGamesCount);

    if (!this.state.notifiedNotFoundGames) {
      const notFoundGames = this.state.catalogItems.filter(i => i.isNotFound);
      if (notFoundGames.length > 0) {
        // use a small timeout to make sure it plays nicely with the initial render
        setTimeout(() => this.showNotFoundGamesToast(notFoundGames), 500);
      }
      if (this.state.catalogItems.length > 0) {
        this.state.notifiedNotFoundGames = true;
      }
    }

    const showOnboarding = !this.state.hasSeenOnboarding;

    root.innerHTML = `
      <div id="app-container" class="flex h-screen h-[100dvh] w-full overflow-hidden text-[#f4f4f5] select-none font-sans bg-[#0c0c0e]">

        ${showOnboarding ? `
        <div id="onboarding-overlay" class="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-md flex items-center justify-center transition-opacity duration-300">
          <div class="bg-[#131316] border border-white/10 rounded-[32px] p-8 max-w-lg w-[90%] shadow-2xl relative overflow-hidden">
            <div class="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 blur-[50px] rounded-full pointer-events-none"></div>
            <div class="absolute bottom-0 left-0 w-32 h-32 bg-purple-500/10 blur-[50px] rounded-full pointer-events-none"></div>
            
            <div class="relative z-10 space-y-6">
              <div class="w-16 h-16 bg-blue-600/20 text-blue-500 rounded-2xl flex items-center justify-center mb-6">
                <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
              </div>
              
              <div>
                <h2 class="text-2xl font-black text-white tracking-tight mb-2">Bem-vindo ao ThumbSync</h2>
                <p class="text-zinc-400 text-sm leading-relaxed">Seu organizador de catálogos e miniaturas de jogos. Gerencie tudo diretamente pelo Google Drive com automação.</p>
              </div>

              <div class="space-y-4">
                <div class="flex items-start gap-3 bg-white/5 p-4 rounded-2xl border border-white/5">
                  <span class="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center shrink-0 font-bold text-xs mt-0.5">1</span>
                  <div>
                    <strong class="text-white text-xs block mb-1">Mural de Jogos</strong>
                    <span class="text-zinc-500 text-[10px] leading-relaxed block">Cadastre os provedores e os jogos que deseja manter no catálogo. Você pode importar planilhas ou adicionar manualmente.</span>
                  </div>
                </div>
                <div class="flex items-start gap-3 bg-white/5 p-4 rounded-2xl border border-white/5">
                  <span class="w-6 h-6 rounded-full bg-blue-500/20 text-blue-500 flex items-center justify-center shrink-0 font-bold text-xs mt-0.5">2</span>
                  <div>
                    <strong class="text-white text-xs block mb-1">Miniaturas</strong>
                    <span class="text-zinc-500 text-[10px] leading-relaxed block">Arraste imagens .webp na tela de Miniaturas. O ThumbSync fará a sincronização direta com seu Drive.</span>
                  </div>
                </div>
              </div>

              <button id="btn-close-onboarding" class="w-full py-3.5 px-4 bg-white text-black font-bold rounded-2xl text-xs hover:bg-neutral-200 transition-colors cursor-pointer mt-4 shadow-[0_0_20px_rgba(255,255,255,0.1)]">
                Começar a Organizar
              </button>
            </div>
          </div>
        </div>
        ` : ''}

        <!-- BANNER DE DESCONEXÃO DO GOOGLE DRIVE -->
        ${!this.state.gdriveConnected ? `
        <!-- Overlay + card: visível só no desktop (>= 1024px) -->
        <div id="disconnected-overlay" style="
          position: fixed;
          inset: 0;
          z-index: 9998;
          background: rgba(0,0,0,0.72);
          backdrop-filter: blur(3px);
          -webkit-backdrop-filter: blur(3px);
          animation: fadeInOverlay 0.35s ease both;
          display: none;
        "></div>

        <div id="disconnected-card-desktop" style="
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 9999;
          width: min(520px, calc(100vw - 48px));
          background: linear-gradient(160deg, #1c1000 0%, #110c00 60%, #0c0900 100%);
          border: 1.5px solid rgba(245, 158, 11, 0.5);
          border-radius: 24px;
          padding: 40px 36px 36px;
          box-shadow:
            0 0 0 1px rgba(245,158,11,0.08),
            0 24px 80px rgba(245, 158, 11, 0.22),
            0 8px 32px rgba(0,0,0,0.7),
            inset 0 1px 0 rgba(255,255,255,0.05);
          animation: popInCard 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both;
          flex-direction: column;
          align-items: center;
          gap: 20px;
          text-align: center;
          display: none;
        ">
          <div style="
            width: 72px; height: 72px; border-radius: 20px;
            background: rgba(245,158,11,0.12);
            border: 1.5px solid rgba(245,158,11,0.35);
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 0 32px rgba(245,158,11,0.15);
            margin: 0 auto;
          ">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div style="display:flex; flex-direction:column; gap:10px; align-items:center;">
            <p style="margin:0; font-size:22px; font-weight:900; color:#fbbf24; letter-spacing:-0.03em; line-height:1.1;">Você está desconectado</p>
            <p style="margin:0; font-size:14px; color:rgba(251,191,36,0.6); font-weight:500; line-height:1.6; max-width:360px;">
              Sua sessão com o Google Drive expirou<br>ou não foi iniciada.<br>
              <strong style="color:rgba(251,191,36,0.85);">Conecte-se para continuar usando o ThumbSync.</strong>
            </p>
          </div>
          <button
            id="banner-btn-login"
            style="
              background:#f59e0b; color:#000; border:none; border-radius:14px;
              padding:14px 32px; font-size:14px; font-weight:900; cursor:pointer;
              letter-spacing:0.01em; transition:background 0.15s, transform 0.1s;
              white-space:nowrap; width:100%;
              box-shadow:0 4px 20px rgba(245,158,11,0.35);
            "
            onmouseover="this.style.background='#d97706';this.style.transform='translateY(-1px)'"
            onmouseout="this.style.background='#f59e0b';this.style.transform='translateY(0)'"
          >Conectar ao Google Drive</button>
        </div>

        <!-- Toast pequeno: visível só no mobile (< 1024px) -->
        <div id="disconnected-toast-mobile" style="
          position: fixed;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 9999;
          width: min(480px, calc(100vw - 32px));
          background: linear-gradient(135deg, #1a0e00 0%, #1c0f00 50%, #0f0a00 100%);
          border: 1.5px solid rgba(245,158,11,0.45);
          border-radius: 18px;
          padding: 16px 18px;
          box-shadow: 0 8px 40px rgba(245,158,11,0.18), 0 2px 12px rgba(0,0,0,0.6);
          display: none;
          align-items: center;
          gap: 14px;
          animation: slideUpBanner 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        ">
          <div style="
            width:42px; height:42px; border-radius:12px;
            background:rgba(245,158,11,0.15); border:1px solid rgba(245,158,11,0.3);
            display:flex; align-items:center; justify-content:center; flex-shrink:0;
          ">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div style="flex:1; min-width:0;">
            <p style="margin:0 0 3px 0; font-size:13px; font-weight:800; color:#fbbf24; letter-spacing:-0.01em; line-height:1.2;">Conta desconectada</p>
            <p style="margin:0; font-size:11px; color:rgba(251,191,36,0.65); font-weight:500; line-height:1.4;">Você não está conectado ao Google Drive. Clique em <strong style="color:#fbbf24;">Conectar</strong> para retomar.</p>
          </div>
          <button
            id="banner-btn-login-mobile"
            style="
              flex-shrink:0; background:#f59e0b; color:#000; border:none;
              border-radius:10px; padding:8px 14px; font-size:11px; font-weight:800;
              cursor:pointer; letter-spacing:0.01em; transition:background 0.15s; white-space:nowrap;
            "
            onmouseover="this.style.background='#d97706'"
            onmouseout="this.style.background='#f59e0b'"
          >Conectar</button>
        </div>

        <style>
          @keyframes fadeInOverlay {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
          @keyframes popInCard {
            from { opacity: 0; transform: translate(-50%, -50%) scale(0.88); }
            to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          }
          @keyframes slideUpBanner {
            from { opacity: 0; transform: translateX(-50%) translateY(20px); }
            to   { opacity: 1; transform: translateX(-50%) translateY(0); }
          }
          @media (min-width: 1024px) {
            #disconnected-overlay     { display: block !important; }
            #disconnected-card-desktop { display: flex !important; }
            #disconnected-toast-mobile { display: none !important; }
          }
          @media (max-width: 1023px) {
            #disconnected-overlay      { display: none !important; }
            #disconnected-card-desktop { display: none !important; }
            #disconnected-toast-mobile { display: flex !important; }
          }
        </style>
        ` : ''}
        
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
                <span class="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-white font-bold">${this.state.catalogItems.filter(i => i.hasWebp).length}</span>
              `)}
              ${this.renderNavItem('list_manager', 'Mural de Jogos', `
                <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              `)}
              ${this.renderNavItem('history', 'Histórico', `
                <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              `, `
                <span class="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-bold">${(this.state.historyItems || []).length}</span>
              `)}
              ${this.isAdmin() ? this.renderNavItem('settings', 'Configurações', `
                <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0" />
                </svg>
              `) : ''}
            </nav>

            <!-- Previsão de Conclusão / Barra de Progresso Widget -->
            <div class="p-3.5 rounded-2xl bg-white/[0.015] border border-white/[0.04] space-y-3 select-none">
              <div class="flex justify-between items-center text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                <span>Progresso</span>
                <span class="text-white">${completedGames}/${totalListedCount} (${progressPercent}%)</span>
              </div>
              <div class="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                <div class="bg-gradient-to-r from-blue-500 to-emerald-500 h-full rounded-full transition-all duration-500" style="width: ${progressPercent}%"></div>
              </div>
              <div class="pt-2 border-t border-white/[0.03] space-y-1">
                <span class="text-[9px] text-zinc-500 font-extrabold uppercase tracking-widest block">Previsão PJ (14h - 17h30)</span>
                <span class="text-xs font-bold text-white block leading-tight">
                  ${estimatedCompletion.dateStr}
                </span>
                <p class="text-[9px] text-zinc-500 leading-normal mt-0.5">
                  De segunda a sexta-feira.
                </p>
              </div>
            </div>
          </div>

          <!-- Bottom account control -->
          <div class="border-t border-white/[0.05] pt-4 flex flex-col gap-2 relative z-10 w-full select-none">
            ${this.state.gdriveConnected ? `
              <div class="flex flex-col gap-1.5 bg-white/[0.015] border border-white/[0.04] p-3 rounded-2xl w-full">
                <div class="flex items-center gap-2.5 min-w-0">
                  <div class="w-8 h-8 rounded-full ${profile.isAdmin ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-blue-600/20 text-blue-300 border border-blue-500/30'} flex items-center justify-center font-black text-xs uppercase shrink-0">
                    ${profile.isAdmin ? 'A' : 'U'}
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="text-[11px] font-extrabold text-white truncate leading-none">${profile.name}</p>
                    <span class="text-[9px] ${profile.isAdmin ? 'text-amber-400' : 'text-blue-400'} font-semibold truncate mt-0.5 block">${profile.isAdmin ? 'Administrador' : 'Usuário Comum'}</span>
                  </div>
                </div>
                ${profile.email ? `<p class="text-[9px] text-zinc-500 font-mono truncate pt-1 border-t border-white/5">${profile.email}</p>` : ''}
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
              ${this.state.gdriveConnected ? `
                <span class="px-2.5 py-0.5 rounded-full text-[8px] sm:text-[9px] font-black border ${profile.badgeColor} flex items-center gap-1 shadow-sm">
                  ${profile.isAdmin ? 'André Luiz' : 'Emerson'}
                </span>
              ` : ''}
            </div>

            <!-- Apple-style Center Title for Mobile -->
            <div class="lg:hidden absolute left-1/2 -translate-x-1/2 flex items-center justify-center">
              <span class="text-xs font-black tracking-tight text-white font-sans pointer-events-none">ThumbSync</span>
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

          <!-- MOBILE PROGRESS WIDGET -->
          <div class="lg:hidden px-4 pt-4 shrink-0">
            <div class="p-3.5 rounded-2xl bg-[#0f0f13] border border-white/[0.06] space-y-3 select-none w-full shadow-sm">
              <div class="flex justify-between items-center text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                <span>Progresso</span>
                <span class="text-white">${completedGames}/${totalListedCount} (${progressPercent}%)</span>
              </div>
              <div class="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                <div class="bg-gradient-to-r from-blue-500 to-emerald-500 h-full rounded-full transition-all duration-500" style="width: ${progressPercent}%"></div>
              </div>
              <div class="flex justify-between items-end pt-2 border-t border-white/[0.03]">
                <div class="space-y-1">
                  <span class="text-[9px] text-zinc-500 font-extrabold uppercase tracking-widest block">Previsão PJ (14h - 17h30)</span>
                  <span class="text-xs font-bold text-white block leading-tight">
                    ${estimatedCompletion.dateStr}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- TAB CONTENT DISPLAY FRAME -->
          <div id="main-scroll-container" class="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 md:p-8 pb-32 lg:pb-12 custom-scrollbar relative z-0 w-full">
            <div id="tab-content" class="w-full"></div>
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
          ${this.renderMobileNavItem('history', 'Histórico', `
            <svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          `)}
          ${this.isAdmin() ? this.renderMobileNavItem('settings', 'Ajustes', `
            <svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            </svg>
          `) : ''}
        </nav>
      </div>

      <!-- Subtle top progress bar with dynamic status feedback -->
      <div id="gdrive-loader" class="fixed top-0 left-0 right-0 h-[34px] z-50 bg-black/80 backdrop-blur-md border-b border-white/[0.04] overflow-hidden pointer-events-none transition-all duration-300 flex items-center justify-between px-6 opacity-0 translate-y-[-10px] hidden">
        <div class="flex items-center gap-2">
          <svg class="w-3.5 h-3.5 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" /></svg>
          <span id="gdrive-status-text" class="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">${this.state.loadingStatusText || 'Processando...'}</span>
        </div>
        <div class="w-24 h-1 bg-white/[0.06] rounded-full overflow-hidden relative">
          <div class="h-full bg-blue-500 rounded-full" style="width: 50%; animation: slideProgress 1.2s infinite ease-in-out;"></div>
        </div>
        <style>
          @keyframes slideProgress {
            0% { transform: translateX(-100%); width: 35%; }
            50% { width: 65%; }
            100% { transform: translateX(180%); width: 35%; }
          }
        </style>
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
                  Se a lista parecer desatualizada, use o botão <strong class="text-white font-bold">Sincronizar</strong> no topo do site para recarregar tudo com o Google Drive.
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

              <!-- Tip 4 -->
              <div class="flex gap-3 p-3.5 rounded-2xl transition-colors" style="background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.05);">
                <div class="w-6 h-6 rounded-xl shrink-0 flex items-center justify-center mt-0.5" style="background: rgba(234,179,8,0.12); border: 1px solid rgba(234,179,8,0.18);">
                  <svg class="w-3.5 h-3.5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                </div>
                <p class="text-[11px] text-zinc-300 leading-relaxed">
                  Na aba <strong class="text-white font-bold">Mural/Lista</strong>, use o botão de estrela para marcar jogos como <strong class="text-yellow-400 font-bold">Prioridade</strong>. Eles serão agrupados no topo para facilitar a organização das artes mais urgentes.
                </p>
              </div>

              <!-- Tip 5 -->
              <div class="flex gap-3 p-3.5 rounded-2xl transition-colors" style="background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.05);">
                <div class="w-6 h-6 rounded-xl shrink-0 flex items-center justify-center mt-0.5" style="background: rgba(249,115,22,0.12); border: 1px solid rgba(249,115,22,0.18);">
                  <svg class="w-3.5 h-3.5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p class="text-[11px] text-zinc-300 leading-relaxed">
                  Se um jogo não tiver arte, marque-o como <strong class="text-orange-400 font-bold">Não Encontrado</strong> no Mural/Lista. Eles ficarão em uma seção separada para não poluir os provedores e você lembrar de ignorá-los.
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
          <div id="modal-content" class="flex flex-col h-full overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"></div>
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
    this._renderDepth--;
    this.restoreScrollState();
  }

  setActiveTab(tab) {
    if (tab === 'settings' && !this.isAdmin()) {
      this.state.activeTab = 'catalog';
      this.render();
      return;
    }
    if (tab === 'history') {
      this.state.activeTab = 'list_manager';
      this.state.muralSubTab = 'history';
    } else if (tab === 'list_manager') {
      this.state.activeTab = 'list_manager';
      this.state.muralSubTab = 'mural';
    } else {
      this.state.activeTab = tab;
    }
    this.render();
  }

  renderNavItem(tab, label, iconHtml, badgeHtml = '') {
    const isActive = this.state.activeTab === tab;
    return `
      <button data-tab="${tab}" class="flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold w-full transition-all cursor-pointer ${isActive ? 'bg-blue-600 text-white shadow-[0_8px_24px_rgba(37,99,235,0.3)] scale-[1.01]' : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'}">
        ${iconHtml}
        <span>${label}</span>
        ${badgeHtml}
      </button>
    `;
  }

  renderMobileNavItem(tab, label, iconHtml) {
    const isActive = this.state.activeTab === tab;
    return `
      <button data-mobile-tab-btn data-tab="${tab}" class="flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-all text-center ${isActive ? 'text-blue-500' : 'text-zinc-500'}">
        <div class="px-3 py-1 rounded-full ${isActive ? 'bg-blue-500/10 text-blue-500' : 'text-zinc-400'}">
          ${iconHtml}
        </div>
        <span class="text-[9px] font-bold tracking-tight mt-0.5">${label}</span>
      </button>
    `;
  }

  renderActiveTab() {
    this._renderDepth = (this._renderDepth || 0);
    this.saveScrollState();
    this._renderDepth++;
    const contentFrame = document.getElementById('tab-content');
    if (!contentFrame) return;

    if (this.state.activeTab === 'settings' && !this.isAdmin()) {
      this.state.activeTab = 'catalog';
    }

    const loader = document.getElementById('gdrive-loader');
    if (loader) {
      if (this.state.isLoading) {
        loader.classList.remove('opacity-0', 'translate-y-[-10px]', 'hidden');
        loader.classList.add('translate-y-0');
        const statusTxtEl = document.getElementById('gdrive-status-text');
        if (statusTxtEl && this.state.loadingStatusText) {
          statusTxtEl.innerText = this.state.loadingStatusText;
        }
      } else {
        loader.classList.add('opacity-0', 'translate-y-[-10px]');
        loader.classList.remove('translate-y-0');
        setTimeout(() => { if (!this.state.isLoading) loader.classList.add('hidden'); }, 300);
      }
    }

    if (this.state.activeTab === 'catalog') {
      this.renderCatalog(contentFrame);
    } else if (this.state.activeTab === 'list_manager') {
      if (this.state.muralSubTab === 'history') {
        this.renderHistory(contentFrame);
      } else {
        this.renderListManager(contentFrame);
      }
    } else if (this.state.activeTab === 'history') {
      this.renderHistory(contentFrame);
    } else if (this.state.activeTab === 'settings') {
      this.renderSettings(contentFrame);
    }

    this.bindTabEvents();
    this._renderDepth--;
    this.restoreScrollState();
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
      items = items.filter(i => this.getGameTag(i) === this.state.filterTag);
    }

    if (this.state.searchQuery.trim() !== '') {
      const q = this.normalizeName(this.state.searchQuery);
      items = items.filter(i => {
        const normDisplayName = this.normalizeName(i.displayName);
        const normProviderName = this.normalizeName(i.providerName);
        return this.fuzzyMatch(normDisplayName, q) || 
               this.fuzzyMatch(normProviderName, q) ||
               this.fuzzyMatch(normProviderName + ' ' + normDisplayName, q);
      });
    }

    if (this.state.filterDate === 'recent') {
      items.sort((a, b) => new Date(b.modifiedTime || 0).getTime() - new Date(a.modifiedTime || 0).getTime());
    } else if (this.state.filterDate === 'oldest') {
      items.sort((a, b) => new Date(a.modifiedTime || 0).getTime() - new Date(b.modifiedTime || 0).getTime());
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
        <!-- Overlay de drag and drop global -->
        <div id="global-dropzone-overlay" class="fixed inset-0 z-50 bg-[#0c0c0e]/95 backdrop-blur-sm flex flex-col items-center justify-center opacity-0 pointer-events-none transition-all duration-300">
          <div class="text-center p-8 border-4 border-dashed border-white/10 rounded-[32px] m-8 max-w-lg scale-95 transition-transform duration-300" id="global-dropzone-panel">
            <div class="w-20 h-20 bg-blue-600/10 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-[0_0_32px_rgba(37,99,235,0.15)] border border-blue-500/25 animate-bounce">
              <svg class="w-10 h-10 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <h2 class="text-xl font-black text-white uppercase tracking-wider mb-2 font-sans">Solte para Enviar Artes</h2>
            <p class="text-zinc-500 text-xs leading-relaxed font-semibold">Solte um ou múltiplos arquivos .webp nesta tela!<br>O sistema identificará os jogos por seus nomes, organizará nas pastas dos respectivos provedores e fará a sincronização com o Google Drive automaticamente.</p>
          </div>
        </div>

        <div class="space-y-6 text-left select-none relative">
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-white/[0.05]">
            <div>
              <h1 class="text-2xl font-black text-white tracking-tight">Miniaturas</h1>
              <p class="text-zinc-500 text-xs mt-0.5">Veja e gerencie as fotos .webp do seu catálogo geral no Google Drive.</p>
            </div>
          </div>

          <!-- Filtros -->
          <div class="space-y-4">
            <div class="flex flex-wrap gap-2">
              <button data-quick-filter="todos" class="quick-filter-btn px-4 py-2 rounded-full text-xs font-bold transition-colors ${this.state.filterStatus === 'todos' ? 'bg-white text-black' : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white'}">Todos os Jogos</button>
              <button data-quick-filter="com_arte" class="quick-filter-btn flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-colors ${this.state.filterStatus === 'com_arte' ? 'bg-[#10b981] text-black' : 'bg-[#10b981]/10 text-[#10b981] hover:bg-[#10b981]/20'}">
                <span class="w-1.5 h-1.5 rounded-full bg-current"></span> Prontos
              </button>
              <button data-quick-filter="sem_arte" class="quick-filter-btn flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-colors ${this.state.filterStatus === 'sem_arte' ? 'bg-[#f59e0b] text-black' : 'bg-[#f59e0b]/10 text-[#f59e0b] hover:bg-[#f59e0b]/20'}">
                <span class="w-1.5 h-1.5 rounded-full bg-current"></span> Sem Arte
              </button>
              <button data-quick-filter="nao_listados" class="quick-filter-btn flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-colors ${this.state.filterStatus === 'nao_listados' ? 'bg-blue-500 text-black' : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'}">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
                Não Listados
              </button>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-white/[0.01] border border-white/[0.04] p-4 rounded-2xl">
              <div class="space-y-1">
                <label class="text-[10px] text-zinc-500 font-extrabold uppercase tracking-wider block">Procurar</label>
                <input type="text" id="catalouge-search" value="${this.state.searchQuery}" placeholder="Ex: Sweet Bonanza..." class="w-full bg-[#131317] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white outline-none focus:border-blue-500">
              </div>
              <div class="space-y-1">
                <label class="text-[10px] text-zinc-500 font-extrabold uppercase tracking-wider block">Provedor</label>
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
                  ${['Slot', 'Ao Vivo', 'Crash', 'Mesa RNG', 'Instant Win', 'Scratchcard', 'Prioridades'].map(tag => `
                    <option value="${tag}" class="bg-zinc-900 text-white" ${this.state.filterTag === tag ? 'selected' : ''}>${tag}</option>
                  `).join('')}
                </select>
              </div>
              <div class="space-y-1">
                <label class="text-[10px] text-zinc-500 font-extrabold uppercase tracking-wider block">Ordenar</label>
                <select id="catalouge-date-filter" class="w-full bg-[#131317] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white outline-none">
                  <option value="recent" class="bg-zinc-900 text-white" ${this.state.filterDate === 'recent' ? 'selected' : ''}>Mais Recentes</option>
                  <option value="oldest" class="bg-zinc-900 text-white" ${this.state.filterDate === 'oldest' ? 'selected' : ''}>Mais Antigos</option>
                </select>
              </div>
            </div>
          </div>

          <div id="catalog-results-area"></div>
        </div>
      `;
      resultsArea = container.querySelector('#catalog-results-area');
    }

    // Renderização Dinâmica apenas da Grade de Itens
    if (this.state.isLoading && items.length === 0) {
      resultsArea.innerHTML = `
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
          ${Array.from({ length: 15 }).map(() => `
            <div class="aspect-[2/3] rounded-2xl bg-white/[0.02] border border-white/[0.03] animate-pulse flex flex-col justify-end p-4">
              <div class="w-1/2 h-2.5 bg-white/10 rounded mb-2"></div>
              <div class="w-3/4 h-3.5 bg-white/20 rounded"></div>
            </div>
          `).join('')}
        </div>
      `;
    } else {
      resultsArea.innerHTML = `
        ${items.length === 0 ? `
          <div class="py-20 text-center italic text-zinc-650 text-xs select-none">Nenhuma miniatura encontrada para os filtros selecionados.</div>
        ` : `
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
            ${itemsToShow.map(item => {
      const providerKey = (item.providerName || '').toLowerCase().trim();
      const customLogo = this.state.customLogos ? this.state.customLogos[providerKey] : null;

      const gradient = (customLogo && customLogo.customBgGradient) 
        ? customLogo.customBgGradient 
        : (PROVIDER_GRADIENTS[providerKey] || PROVIDER_GRADIENTS['default']);

      const boardGlow = customLogo 
        ? (customLogo.customGlowColor || 'rgba(255,255,255,0.08)') 
        : (PROVIDER_BORDER_GLOWS[providerKey] || PROVIDER_BORDER_GLOWS['default']);

      const hasWebp = item.hasWebp;
      const tag = this.getGameTag(item);
      const tagHtml = this.getGameTagHTML(tag);

      return `
              <div data-catalog-key="${item.id}" 
                   style="--card-glow: ${boardGlow}" 
                   class="group relative aspect-[2/3] rounded-2xl overflow-hidden bg-zinc-950 border border-white/[0.08] hover:border-white/20 hover:shadow-[0_0_22px_var(--card-glow)] shadow-md cursor-pointer transition-all transform hover:scale-[1.02] duration-300">
                ${hasWebp ? `
                  <img id="thumb-${item.id}" 
                       data-catalog-key="${item.id}" 
                       src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" 
                       alt="${item.displayName}" 
                       class="w-full h-full object-cover opacity-0 transition-opacity duration-500">
                ` : (customLogo ? `
                  <div class="absolute inset-0 bg-gradient-to-tr ${customLogo.customBgGradient} flex flex-col justify-between p-4 text-left overflow-hidden select-none">
                    <img src="${customLogo.customCover}" class="absolute inset-0 w-full h-full object-cover opacity-[0.22] mix-blend-overlay filter blur-[0.3px] scale-105 transition-transform duration-700 hover:scale-110 pointer-events-none">
                    <div class="text-[8px] font-extrabold uppercase tracking-widest text-[#0a84ff] bg-[#0a84ff]/10 border border-[#0a84ff]/20 px-2.5 py-0.5 rounded-full w-fit z-10">
                      PENDENTE
                    </div>
                    <div class="flex flex-col items-center justify-center text-center my-auto px-4 z-10 w-full max-w-full">
                      <span class="text-[12px] font-black tracking-widest text-white uppercase block drop-shadow-md truncate max-w-full leading-tight select-none">${customLogo.brandText}</span>
                      ${customLogo.tagline ? `<span class="text-[7.5px] font-extrabold tracking-[0.25em] text-white/40 uppercase mt-0.5 truncate max-w-full select-none">${customLogo.tagline}</span>` : ''}
                    </div>
                    <div class="space-y-1 z-10 pointer-events-none">
                      <span class="text-[8px] text-zinc-400 font-bold uppercase tracking-widest block">${item.providerName}</span>
                      <h4 class="text-xs font-black text-white leading-tight truncate px-0.5 block select-text">${item.displayName}</h4>
                      <span class="text-[7px] text-zinc-500 font-bold uppercase tracking-wider block">Falta arte (.webp)</span>
                    </div>
                  </div>
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
                `)}

                <div class="absolute top-3 right-3 z-20">
                  ${tagHtml}
                </div>

                <div class="absolute inset-0 ${hasWebp ? 'bg-gradient-to-t from-black/80 via-transparent to-transparent' : `bg-gradient-to-t ${gradient} opacity-90`} pointer-events-none"></div>
                
                ${hasWebp ? `
                  <div class="absolute inset-x-0 bottom-0 p-4 text-left z-10 leading-none">
                    <span class="text-[8px] text-zinc-400 font-black uppercase tracking-widest block">${item.providerName}</span>
                    <h4 class="text-xs font-black text-white leading-normal mt-0.5">${item.displayName}</h4>
                  </div>
                ` : ''}

                <div class="absolute inset-0 bg-blue-600/20 m-1 rounded-2xl border-2 border-dashed border-blue-500 flex flex-col items-center justify-center opacity-0 group-hover:pointer-events-none transition-opacity duration-300 pointer-events-none dropzone-indicator">
                  <svg class="w-7 h-7 text-white animate-bounce mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4 4m4-4v12" /></svg>
                  <span class="text-[9px] font-bold text-white uppercase tracking-wider text-center leading-tight">Solte Webp<br>para Sincronizar</span>
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
    }

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
          alert("Ação não permitida no modo de demonstração off-line. Ative e conecte seu Google Drive para sincronizar Webps reais!");
          return;
        }

        const files = e.dataTransfer.files;
        if (files.length === 0) return;

        const file = files[0];
        if (!file.name.toLowerCase().endsWith('.webp')) {
          alert("Formato incompatível! Por favor, envie apenas arquivos de imagem do formato .webp.");
          return;
        }

        // Sincronizar
        this.addLog(`Preparando envio de '${file.name}' (${Math.round(file.size / 1024)} KB) p/ Drive...`);
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

          // Sincronizar imagem via Drive CLIENT
          const uploadedFile = await driveClient.uploadImage(fileName, file, targetFolderId);
          this.addLog(`Miniatura '${fileName}' enviada com sucesso ao Drive (Novo ID: ${uploadedFile.id.substring(0, 8)}...)`);

          await this.syncWithGoogleDrive();
        } catch (uploadError) {
          this.addLog(`Incorreto ao enviar imagem: ${uploadError.message}`);
          alert(`Incompatibilidade na sincronização: ${uploadError.message}`);
        } finally {
          this.state.isLoading = false;
          this.render();
        }
      });
    });
  }

  /**
   * TELA DE HISTÓRICO DE JOGOS CONCLUÍDOS
   */
  renderHistory(container) {
    const historyList = this.state.historyItems || [];

    // Agrupar itens por data de adição (addedDate)
    const groupsByDate = new Map();
    
    // Ordenar itens com datas mais recentes primeiro
    const sortedItems = [...historyList].sort((a, b) => {
      const dateA = a.addedDate || a.addedAt || '2000-01-01';
      const dateB = b.addedDate || b.addedAt || '2000-01-01';
      return dateB.localeCompare(dateA);
    });

    sortedItems.forEach(item => {
      const dateKey = item.addedDate || (item.addedAt ? item.addedAt.split('T')[0] : 'Sem Data');
      if (!groupsByDate.has(dateKey)) {
        groupsByDate.set(dateKey, []);
      }
      groupsByDate.get(dateKey).push(item);
    });

    const datesList = Array.from(groupsByDate.entries());

    container.innerHTML = `
      <div class="space-y-6 text-left select-none relative w-full">
        <!-- Subtabs e Voltar -->
        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b border-white/[0.05]">
          <div>
            <div class="flex items-center gap-2">
              <button id="btn-back-to-mural" class="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 transition-colors cursor-pointer mr-1" title="Voltar ao Mural">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                </svg>
              </button>
              <h1 class="text-2xl font-black text-white tracking-tight">Histórico de Concluídos</h1>
            </div>
            <p class="text-zinc-500 text-xs mt-1">Jogos que foram marcados com miniatura (.webp) e removidos do Mural de Demandas, organizados por dia de adição.</p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            ${this.isAdmin() ? `
              <input type="file" id="input-import-history-json" accept=".json,.txt,application/json,text/plain" multiple class="hidden" />
              <button id="btn-import-history-json" class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-all text-xs font-bold cursor-pointer" title="Importar arquivo(s) JSON ou TXT de histórico">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span>Importar JSON/TXT</span>
              </button>
            ` : ''}
            <span class="px-3 py-1.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold shrink-0">
              ${historyList.length} ${historyList.length === 1 ? 'jogo concluído' : 'jogos concluídos'}
            </span>
          </div>
        </div>

        ${this.isAdmin() ? `
          <div class="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-300 text-xs shadow-lg shadow-amber-500/5">
            <div class="flex items-start gap-3">
              <div class="w-8 h-8 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
                <svg class="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>
              <div>
                <h4 class="font-extrabold text-white text-xs">Painel de Administrador: Fazer Upload de Histórico (.json, .txt)</h4>
                <p class="text-amber-200/80 text-[11px] mt-0.5 leading-relaxed">
                  Se você possui arquivos de histórico salvos no computador (como <code class="bg-black/30 px-1 py-0.5 rounded text-amber-300 font-mono">untitled.json</code>, <code class="bg-black/30 px-1 py-0.5 rounded text-amber-300 font-mono">historico.json</code> ou <code class="bg-black/30 px-1 py-0.5 rounded text-amber-300 font-mono">lista.txt</code>), clique no botão ao lado para enviá-los. Os jogos serão adicionados ao histórico automaticamente <strong>sem duplicatas</strong>.
                </p>
              </div>
            </div>
            <button id="btn-import-history-banner" class="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-xs transition-colors shrink-0 cursor-pointer flex items-center gap-1.5">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span>Selecionar Arquivos (.JSON / .TXT)</span>
            </button>
          </div>
        ` : ''}

        ${historyList.length === 0 ? `
          <div class="py-16 text-center space-y-3 bg-white/[0.01] border border-white/[0.04] rounded-3xl p-8">
            <div class="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto text-blue-400">
              <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 class="text-sm font-bold text-white">Nenhum jogo no histórico ainda</h3>
            <p class="text-xs text-zinc-500 max-w-sm mx-auto leading-relaxed">
              Quando um jogo no Mural tiver sua miniatura (.webp) pronta e for removido (ou ao clicar em "Limpar Feitos"), ele aparecerá aqui automaticamente.
            </p>
          </div>
        ` : `
          <div class="space-y-6">
            ${datesList.map(([dateStr, items]) => {
              let formattedDateHeader = dateStr;
              if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                const parts = dateStr.split('-');
                formattedDateHeader = `${parts[2]}/${parts[1]}/${parts[0]}`;
              }

              return `
                <div class="bg-white/[0.015] border border-white/[0.05] rounded-2xl p-4 sm:p-5 space-y-3">
                  <div class="flex items-center justify-between border-b border-white/[0.04] pb-2.5">
                    <div class="flex items-center gap-2">
                      <span class="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"></span>
                      <h2 class="text-sm font-black text-white tracking-wide">
                        Adicionados em: <span class="text-blue-400">${formattedDateHeader}</span>
                      </h2>
                    </div>
                    <span class="text-[10px] font-bold text-zinc-400 bg-white/5 px-2 py-0.5 rounded-md">
                      ${items.length} ${items.length === 1 ? 'item' : 'itens'}
                    </span>
                  </div>

                  <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                    ${items.map(item => {
                      const key = item.id || `${this.normalizeName(item.providerName)}::${this.normalizeName(item.displayName || item.normalizedName)}`;
                      const catalogItem = this.state.catalogItems.find(ci => ci.id === key);
                      const hasWebp = catalogItem ? catalogItem.hasWebp : item.hasWebp;

                      return `
                        <div data-catalog-key="${key}" class="group relative bg-[#131317] border border-white/[0.06] hover:border-blue-500/40 rounded-xl p-3.5 flex flex-col justify-between transition-all hover:bg-white/[0.03] cursor-pointer">
                          <div class="flex items-start justify-between gap-2">
                            <div class="min-w-0 flex-1">
                              <span class="text-[9px] font-extrabold uppercase tracking-wider text-blue-400/80 block truncate">
                                ${item.providerName || 'Sem provedor'}
                              </span>
                              <h4 class="text-xs font-bold text-white truncate mt-0.5" title="${item.displayName}">
                                ${item.displayName}
                              </h4>
                            </div>
                            <span class="text-[8px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                              CONCLUÍDO
                            </span>
                          </div>

                          <div class="flex items-center justify-between pt-2.5 mt-2 border-t border-white/[0.04]">
                            <button data-copy-history-name="${(item.displayName || '').replace(/"/g, '&quot;')}" class="flex items-center gap-1 text-[10px] font-semibold text-zinc-400 hover:text-white px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 transition-colors cursor-pointer" title="Copiar Nome">
                              <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              <span>Copiar Nome</span>
                            </button>

                            ${hasWebp ? `
                              <button data-preview-history-key="${key}" class="flex items-center gap-1 text-[10px] font-semibold text-blue-400 hover:text-blue-300 px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 transition-colors cursor-pointer" title="Ver / Baixar Arte">
                                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                                <span>Ver Arte</span>
                              </button>
                            ` : ''}
                          </div>
                        </div>
                      `;
                    }).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;

    // Bind event listeners para o histórico
    const btnBack = container.querySelector('#btn-back-to-mural');
    if (btnBack) {
      btnBack.addEventListener('click', () => {
        this.setActiveTab('list_manager');
      });
    }

    // Event listeners para upload de JSON de Histórico (Administrador)
    const btnImportHeader = container.querySelector('#btn-import-history-json');
    const btnImportBanner = container.querySelector('#btn-import-history-banner');
    const inputImport = container.querySelector('#input-import-history-json');

    if (inputImport) {
      if (btnImportHeader) {
        btnImportHeader.addEventListener('click', () => inputImport.click());
      }
      if (btnImportBanner) {
        btnImportBanner.addEventListener('click', () => inputImport.click());
      }
      inputImport.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files.length > 0) {
          await this.handleImportHistoryFiles(e.target.files);
          e.target.value = '';
        }
      });
    }

    container.querySelectorAll('[data-catalog-key]').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('a')) return;
        const key = card.getAttribute('data-catalog-key');
        const catalogItem = this.state.catalogItems.find(i => i.id === key);
        if (catalogItem) {
          this.renderPreviewModal(catalogItem);
        }
      });
    });

    container.querySelectorAll('[data-preview-history-key]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.getAttribute('data-preview-history-key');
        const catalogItem = this.state.catalogItems.find(i => i.id === key);
        if (catalogItem) {
          this.renderPreviewModal(catalogItem);
        }
      });
    });

    container.querySelectorAll('[data-copy-history-name]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const textToCopy = btn.getAttribute('data-copy-history-name');
        if (textToCopy) {
          try {
            await navigator.clipboard.writeText(textToCopy);
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<svg class="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg><span class="text-emerald-400">Copiado!</span>';
            setTimeout(() => {
              btn.innerHTML = originalHTML;
            }, 1500);
          } catch (err) {
            console.error('Erro ao copiar:', err);
          }
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
      let clean = line.replace(/^\uFEFF/, '').replace(/^\s*(?:[-*•]\s+|\d+\s*[\).\]-]\s*)/, '').trim();
      if (!clean || clean.startsWith('#')) continue;

      let isNotFound = false;
      let isPriority = false;
      if (clean.includes('!')) {
        isPriority = true;
        clean = clean.replace(/!/g, '').trim();
        if (!clean) continue;
      }
      if (clean.includes('?')) {
        isNotFound = true;
        clean = clean.replace(/\?/g, '').trim();
        if (!clean) continue;
      }

      const providerMatch = clean.match(/^provedor\s*:\s*(.+)$/i);
      if (providerMatch) {
        let provName = providerMatch[1].trim();
        if (provName.includes('!')) {
          provName = provName.replace(/!/g, '').trim();
        }
        currentProvider = provName;
        continue;
      }

      if (/^provedor\s*:/i.test(clean)) continue;

      listGames.push({
        displayName: clean,
        normalizedName: this.normalizeName(clean),
        providerName: currentProvider,
        isNotFound: isNotFound,
        isPriority: isPriority
      });
    }

    const catalogItemsByKey = new Map(this.state.catalogItems.map(item => [item.id, item]));
    const getListGameKey = (game) => `${this.normalizeName(game.providerName)}::${game.normalizedName}`;
    const isListGameOk = (game) => catalogItemsByKey.get(getListGameKey(game))?.hasWebp || false;
    const sortGamesForProvider = (a, b) => {
      const okDiff = Number(isListGameOk(b)) - Number(isListGameOk(a));
      if (okDiff !== 0) return okDiff;
      return a.displayName.localeCompare(b.displayName, 'pt-BR', { sensitivity: 'base' });
    };

    const groupsMap = new Map();
    const notFoundGames = [];
    const priorityGames = [];

    listGames.forEach(g => {
      if (g.isPriority) {
        priorityGames.push(g);
      } else if (g.isNotFound) {
        notFoundGames.push(g);
      } else {
        const arr = groupsMap.get(g.providerName) || [];
        arr.push(g);
        groupsMap.set(g.providerName, arr);
      }
    });

    const groupsList = Array.from(groupsMap.entries()).map(([providerName, games]) => [
      providerName,
      [...games].sort(sortGamesForProvider)
    ]);
    
    if (notFoundGames.length > 0) {
      groupsList.unshift([
        "Jogos Não Encontrados",
        [...notFoundGames].sort(sortGamesForProvider)
      ]);
    }

    if (priorityGames.length > 0) {
      groupsList.unshift([
        "Prioridades",
        [...priorityGames].sort(sortGamesForProvider)
      ]);
    }

    // Combinar provedores para exibir como opções no modal de adicionar jogo
    const modalProvidersSet = new Set();

    // 1. Dos grupos do lista.txt
    groupsList.forEach(([prov]) => {
      if (prov && prov !== "Sem provedor" && prov !== "Jogos Não Encontrados" && prov !== "Prioridades") {
        modalProvidersSet.add(prov);
      }
    });

    // 1.5. Provedores declarados explicitamente na lista (incluindo sem jogos)
    lines.forEach(line => {
      const cleanLine = line.replace(/^\uFEFF/, '').trim();
      const match = cleanLine.match(/^provedor\s*:\s*(.+)$/i);
      if (match) {
        let prov = match[1].trim();
        if (prov.includes('!')) {
          prov = prov.replace(/!/g, '').trim();
        }
        if (prov && prov !== "Sem provedor") {
          modalProvidersSet.add(prov);
        }
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
      <div class="space-y-6 text-left select-none relative w-full">
        <div class="flex flex-col gap-4 pb-2 border-b border-white/[0.05]">
          <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h1 class="text-2xl font-black text-white tracking-tight">Mural de Jogos</h1>
              <p class="text-zinc-500 text-xs mt-0.5">Gerencie os jogos, adicione novos provedores e controle seu catálogo visualmente.</p>
            </div>

            <div class="flex items-center gap-2 bg-white/[0.03] border border-white/[0.06] p-1 rounded-xl shrink-0">
              <button id="subtab-btn-mural" class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${this.state.muralSubTab !== 'history' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'}">
                Demandas
              </button>
              <button id="subtab-btn-history" class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${this.state.muralSubTab === 'history' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'}">
                <span>Histórico</span>
                <span class="px-1.5 py-0.2 text-[9px] rounded-full bg-white/10 text-white font-extrabold">${(this.state.historyItems || []).length}</span>
              </button>
            </div>
          </div>
          
          <!-- Botões de Ação Dinâmicos e Responsivos para Desktop/Tablet/Mobile -->
          <div class="flex flex-row items-center justify-start gap-2 w-full select-none overflow-x-auto py-1 no-scrollbar sm:flex-row sm:items-stretch sm:justify-between sm:gap-2.5 sm:overflow-visible sm:py-0">
            <button id="btn-clear-finished" class="flex items-center justify-center w-9 h-9 sm:flex-1 sm:h-auto sm:py-2.5 sm:px-3.5 rounded-xl bg-orange-600/[0.15] hover:bg-orange-600/25 text-[#f59e0b] border border-orange-500/20 shadow-sm transition-all cursor-pointer active:scale-95 shrink-0" title="Limpar Jogos Feitos (Mover para o Histórico)">
              <svg class="w-3.5 h-3.5 text-[#f59e0b] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142a2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span class="hidden sm:inline ml-1.5 text-xs font-bold whitespace-nowrap">Limpar Feitos</span>
            </button>
            
            <button id="btn-view-history" class="flex items-center justify-center w-9 h-9 sm:flex-1 sm:h-auto sm:py-2.5 sm:px-3.5 rounded-xl bg-blue-600/[0.15] hover:bg-blue-600/25 text-blue-400 border border-blue-500/20 shadow-sm transition-all cursor-pointer active:scale-95 shrink-0" title="Ver Histórico de Concluídos">
              <svg class="w-3.5 h-3.5 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span class="hidden sm:inline ml-1.5 text-xs font-bold whitespace-nowrap">Histórico (${(this.state.historyItems || []).length})</span>
            </button>
            
            <button id="btn-delete-selected" class="${this.state.selectedListKeys.size > 0 ? 'flex' : 'hidden'} items-center justify-center w-9 h-9 sm:flex-1 sm:h-auto sm:py-2.5 sm:px-3.5 rounded-xl bg-red-600/[0.15] hover:bg-red-600/25 text-red-500 border border-red-500/20 shadow-sm transition-all cursor-pointer active:scale-95 shrink-0" title="Excluir Selecionados">
              <svg class="w-3.5 h-3.5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142a2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span class="hidden sm:inline ml-1.5 text-xs font-bold whitespace-nowrap">Excluir</span>
              <span class="bg-red-500/25 text-red-500 sm:bg-red-500/10 sm:text-red-500 text-[9px] px-1.5 py-0.5 rounded-full font-bold ml-1 shrink-0" id="selected-count-badge">
                <span id="selected-count">${this.state.selectedListKeys.size}</span>
              </span>
            </button>
            
            <button id="btn-add-provider" class="flex items-center justify-center w-9 h-9 sm:flex-1 sm:h-auto sm:py-2.5 sm:px-3.5 rounded-xl bg-white/[0.03] text-white hover:bg-white/[0.06] border border-white/[0.06] transition-all cursor-pointer active:scale-95 shrink-0" title="Novo Provedor">
              <svg class="w-3.5 h-3.5 text-zinc-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span class="hidden sm:inline ml-1.5 text-xs font-bold whitespace-nowrap">Novo Provedor</span>
            </button>
            
            <button id="btn-import-csv" class="flex items-center justify-center w-9 h-9 sm:flex-1 sm:h-auto sm:py-2.5 sm:px-3.5 rounded-xl bg-white/[0.03] text-white hover:bg-white/[0.06] border border-white/[0.06] transition-all cursor-pointer active:scale-95 shrink-0" title="Importar Planilha">
              <svg class="w-3.5 h-3.5 text-zinc-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <span class="hidden sm:inline ml-1.5 text-xs font-bold whitespace-nowrap">Importar Planilha</span>
            </button>
            
            <button id="btn-add-games-main" class="flex items-center justify-center py-2 px-3 rounded-xl sm:flex-1 sm:py-2.5 sm:px-3.5 bg-blue-600 hover:bg-blue-700 text-white border border-blue-500/20 shadow-md transition-all cursor-pointer active:scale-95 shrink-0" title="Adicionar Jogos">
              <svg class="w-3.5 h-3.5 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span class="inline-block ml-1 text-xs font-bold whitespace-nowrap">Adicionar<span class="hidden sm:inline"> Jogos</span></span>
            </button>
          </div>
        </div>

        <div class="flex flex-col lg:flex-row gap-6 w-full items-start">
          <!-- Lista Principal de Provedores e Jogos -->
          <div class="space-y-4 w-full lg:flex-1 lg:min-w-0">
            ${this.state.isLoading && groupsList.length === 0 ? `
              <div class="space-y-4">
                ${Array.from({ length: 4 }).map(() => `
                  <div class="rounded-2xl border border-white/[0.03] bg-white/[0.01] px-4 py-3 flex justify-between items-center animate-pulse">
                    <div class="flex items-center gap-3">
                      <div class="w-1.5 h-1.5 rounded-full bg-blue-500/30"></div>
                      <div class="w-32 h-3 bg-white/10 rounded"></div>
                    </div>
                    <div class="flex items-center gap-2">
                       <div class="w-12 h-3.5 bg-white/5 rounded-full"></div>
                       <div class="w-6 h-6 bg-blue-500/10 rounded-lg"></div>
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : groupsList.length === 0 ? `
              <div class="py-24 text-center italic text-zinc-600 text-xs">Nenhum provedor cadastrado ainda. Crie um novo provedor acima.</div>
            ` : `
              <div id="mural-horizontal-scroll" class="flex overflow-x-auto items-start gap-6 pb-6 custom-scrollbar snap-x">
              ${groupsList.map(([providerName, games]) => {
      const providerKey = this.normalizeName(providerName);
      const providerAttr = encodeURIComponent(providerKey);
      const isCollapsed = this.state.collapsedProviderKeys.has(providerKey);
      const isNotFoundSection = providerName === "Jogos Não Encontrados";
      const isPrioritySection = providerName === "Prioridades";

      return `
                <div class="w-[340px] shrink-0 snap-start rounded-2xl border ${isNotFoundSection ? 'border-orange-500/30 bg-orange-500/5' : isPrioritySection ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-white/[0.05] bg-white/[0.01]'} divide-y divide-white/[0.03]">
                  <div data-provider-toggle="${providerAttr}" role="button" tabindex="0" aria-expanded="${!isCollapsed}" aria-controls="provider-games-${providerAttr}" class="flex justify-between items-center px-4 py-3 hover:bg-white/[0.02] cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50">
                    <span class="text-xs font-black ${isNotFoundSection ? 'text-orange-400' : isPrioritySection ? 'text-yellow-400' : 'text-white'} uppercase tracking-wider flex items-center gap-2 min-w-0">
                      <span class="w-1.5 h-1.5 rounded-full ${isNotFoundSection ? 'bg-orange-500' : isPrioritySection ? 'bg-yellow-500' : 'bg-blue-500'} shrink-0"></span>
                      <svg class="w-3 h-3 text-zinc-500 transition-transform shrink-0 ${isCollapsed ? '-rotate-90' : 'rotate-0'}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                      <span class="truncate pr-2 flex items-center gap-1 ${this.state.priorityProvidersSet?.has(providerKey) ? 'text-yellow-400' : ''}">
                        ${providerName}
                        ${this.state.priorityProvidersSet?.has(providerKey) ? `<svg class="w-3.5 h-3.5 text-yellow-400 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path></svg>` : ''}
                      </span>
                    </span>
                    <div class="flex items-center gap-2 shrink-0">
                      <span class="text-[9px] bg-white/5 border border-white/10 px-2 py-0.5 rounded-full text-zinc-400 font-bold whitespace-nowrap">
                        ${games.length} jogos
                      </span>
                      ${isNotFoundSection || isPrioritySection ? '' : `
                      <button data-trigger-toggle-provider-priority="${providerName}" class="w-6.5 h-6.5 rounded-lg ${this.state.priorityProvidersSet?.has(providerKey) ? 'bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border-yellow-500/15' : 'bg-white/5 hover:bg-white/10 text-zinc-400 border-white/10'} border flex items-center justify-center cursor-pointer shrink-0" title="Marcar/Desmarcar como Prioridade">
                        <svg class="w-3.5 h-3.5" fill="${this.state.priorityProvidersSet?.has(providerKey) ? 'currentColor' : 'none'}" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                      </button>
                      <button data-trigger-add-game="${providerName}" class="w-6.5 h-6.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/15 flex items-center justify-center cursor-pointer shrink-0" title="Adicionar jogo">
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
                      </button>
                      `}
                    </div>
                  </div>

                  ${isCollapsed ? '' : `
                  <div id="provider-games-${providerAttr}" class="p-2 bg-[#09090c]/40 space-y-1.5">
                    ${games.map(game => {
                      const key = `${this.normalizeName(game.providerName)}::${game.normalizedName}`;
                      const catalogItem = this.state.catalogItems.find(i => i.id === key);
                      const hasWebp = catalogItem?.hasWebp || false;
                      const formattedDate = catalogItem?.modifiedTime ? new Date(catalogItem.modifiedTime).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';

                      return `
                        <div data-list-preview-key="${key}" class="flex flex-col gap-2 py-2.5 px-3 rounded-lg hover:bg-white/[0.03] cursor-pointer transition-colors border ${hasWebp && !game.isNotFound ? 'border-[#10b981]/40 shadow-[0_0_12px_rgba(16,185,129,0.15)] bg-[#10b981]/[0.02]' : 'border-transparent'}">
                          <div class="flex items-start gap-2.5 min-w-0 w-full">
                            <input type="checkbox" data-select-key="${key}" ${this.state.selectedListKeys.has(key) ? 'checked' : ''} class="game-selector w-3.5 h-3.5 mt-0.5 rounded border-white/10 bg-white/5 checked:bg-blue-600 cursor-pointer shrink-0">
                            <span class="w-1.5 h-1.5 rounded-full ${game.isNotFound ? 'bg-red-500' : hasWebp ? 'bg-[#10b981]' : (game.isPriority ? 'bg-yellow-500' : 'bg-[#f59e0b]')} shrink-0 mt-1.5"></span>
                            <div class="flex-1 min-w-0">
                              <span class="text-xs font-bold text-zinc-100 select-text cursor-text relative z-10 block break-words leading-tight ${game.isNotFound ? 'line-through opacity-50' : ''} ${game.isPriority && !hasWebp ? 'text-yellow-200' : ''}">
                                ${game.displayName}
                                ${isNotFoundSection || isPrioritySection ? `<span class="text-[9px] text-zinc-500 ml-1 font-normal select-none">(${game.providerName})</span>` : ''}
                              </span>
                            </div>
                          </div>

                          <!-- Sub-row: Badges and date -->
                          <div class="flex flex-wrap items-center gap-1.5 pl-6">
                            ${game.isPriority ? `<span class="text-[7.5px] font-extrabold tracking-wider px-1 py-0.2 rounded-md bg-yellow-500/10 text-yellow-500">PRIORIDADE</span>` : ''}
                            ${game.isNotFound ? `<span class="text-[7.5px] font-extrabold tracking-wider px-1 py-0.2 rounded-md bg-red-500/10 text-red-500">NÃO ENCONTRADO</span>` : ''}
                            ${(!game.isNotFound && hasWebp) ? `<span class="text-[7.5px] font-extrabold tracking-wider px-1 py-0.2 rounded-md bg-[#10b981]/10 text-[#10b981]">THUMB FEITA</span>` : ''}
                            ${(!game.isNotFound && !hasWebp) ? `<span class="text-[7.5px] font-extrabold tracking-wider px-1 py-0.2 rounded-md bg-[#f59e0b]/10 text-[#f59e0b]">EM PRODUÇÃO</span>` : ''}
                            ${hasWebp && formattedDate ? `<span class="text-[9px] text-zinc-500 font-medium whitespace-nowrap">${formattedDate}</span>` : ''}
                          </div>

                          <!-- Action buttons row, aligned below the information -->
                          <div class="flex items-center flex-wrap gap-1.5 pl-6 mt-1">
                            ${this.isAdmin() ? `
                            <a href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent(game.providerName + ' ' + game.displayName)}" 
                               target="_blank" 
                               rel="noopener noreferrer" 
                               class="w-7 h-7 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 flex items-center justify-center cursor-pointer text-purple-400 transition-colors shrink-0" 
                               title="Pesquisar Imagem no Google (Administrador)"
                               onclick="event.stopPropagation()">
                              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                                <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 7.5v6m3-3h-6" />
                              </svg>
                            </a>
                            ` : ''}
                            <button data-copy-catalog-name="${game.displayName.replace(/"/g, '&quot;')}" class="w-7 h-7 rounded-lg bg-zinc-500/5 hover:bg-zinc-500/15 border border-zinc-500/10 flex items-center justify-center cursor-pointer text-zinc-400 transition-colors" title="Copiar Nome">
                              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </button>
                            <button data-priority-catalog-key="${key}" class="w-7 h-7 rounded-lg hover:bg-yellow-500/15 border flex items-center justify-center cursor-pointer transition-colors ${game.isPriority ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/20' : 'bg-yellow-500/5 text-yellow-500/60 border-yellow-500/10'}" title="${game.isPriority ? 'Desmarcar Prioridade' : 'Marcar Prioridade'}">
                              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                              </svg>
                            </button>
                            <button data-notfound-catalog-key="${key}" class="w-7 h-7 rounded-lg hover:bg-orange-500/15 border flex items-center justify-center cursor-pointer transition-colors ${game.isNotFound ? 'bg-orange-500/20 text-orange-300 border-orange-500/20' : 'bg-orange-500/5 text-orange-400 border-orange-500/10'}" title="${game.isNotFound ? 'Desmarcar Não Encontrado' : 'Marcar Não Encontrado'}">
                              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </button>
                            <button data-edit-catalog-key="${key}" class="w-7 h-7 rounded-lg bg-blue-500/5 hover:bg-blue-500/15 border border-blue-500/10 flex items-center justify-center cursor-pointer text-blue-400 transition-colors" title="Editar Nome">
                              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" /></svg>
                            </button>
                            <button data-delete-catalog-key="${key}" class="w-7 h-7 rounded-lg bg-red-500/5 hover:bg-red-500/15 border border-red-500/10 flex items-center justify-center cursor-pointer text-red-400 transition-colors" title="Excluir Jogo">
                              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </div>
                        </div>
                      `;
                    }).join('')}
                  </div>
                  `}
                </div>
              `;
    }).join('')}
              </div>
            `}
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

      <!-- Import CSV Modal -->
      ${this.state.isImportingCSV ? `
        <div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center">
          <div class="w-[90%] max-w-sm bg-[#131316] border border-white/[0.08] p-6 rounded-3xl shadow-2xl flex flex-col">
            <h3 class="text-sm font-black text-white uppercase tracking-wider mb-4 leading-none font-sans">Importar Planilha</h3>
            
            <div class="mb-4 text-left">
              <label class="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1 block">Selecione o Provedor</label>
              <select id="modal-import-csv-provider-select" class="w-full bg-[#1c1c22] border border-white/10 rounded-xl px-3 py-2 text-xs text-white">
                ${modalProvidersList.map(prov => `
                  <option value="${prov}">${prov}</option>
                `).join('')}
              </select>
            </div>

            <div class="mb-5 text-left">
              <label class="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1 block">Arquivo CSV / Planilha</label>
              <input type="file" id="import-csv-file-input" accept=".csv" class="w-full bg-[#1c1c22] border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-blue-500">
              <p class="text-[9px] text-zinc-500 mt-2">O sistema reconhece colunas como 'name', 'game', 'titulo' ou 'jogo'. Salve sua planilha como .csv antes de enviar.</p>
            </div>
            
            <div class="flex items-center gap-3">
              <button id="modal-import-csv-cancel" class="flex-1 py-2 px-4 rounded-xl bg-white/5 border border-white/5 text-zinc-300 font-semibold text-xs hover:bg-white/10 cursor-pointer">Cancelar</button>
              <button id="modal-import-csv-confirm" class="flex-1 py-2 px-4 rounded-xl bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-700 cursor-pointer">Importar</button>
            </div>
          </div>
        </div>
      ` : ''}
      
      <!-- Edit Game Name Modal -->
      ${this.state.isEditingGameName && this.state.editingGameItem ? `
        <div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center">
          <div class="w-[90%] max-w-sm bg-[#131316] border border-white/[0.08] p-6 rounded-3xl shadow-2xl flex flex-col">
            <h3 class="text-sm font-black text-white uppercase tracking-wider mb-4 leading-none font-sans">Editar Nome do Jogo</h3>
            
            <div class="mb-5 text-left">
              <label class="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1 block">Nome do Jogo</label>
              <input type="text" id="modal-edit-game-name" value="${this.state.editingGameItem.displayName.replace(/"/g, '&quot;')}" class="w-full bg-[#1c1c22] border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-blue-500" />
            </div>
            
            <div class="flex items-center gap-3">
              <button id="modal-edit-game-cancel" class="flex-1 py-2 px-4 rounded-xl bg-white/5 border border-white/5 text-zinc-300 font-semibold text-xs hover:bg-white/10 cursor-pointer">Cancelar</button>
              <button id="modal-edit-game-confirm" class="flex-1 py-2 px-4 rounded-xl bg-blue-600 text-white font-semibold text-xs hover:bg-blue-700 cursor-pointer">Salvar</button>
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
    const profile = this.getProfile();
    const emersonAccounts = this.getEmersonAccounts();
    const isAdmin = this.isAdmin();

    container.innerHTML = `
      <div class="space-y-6 text-left select-none max-w-2xl">
        <div class="pb-2 border-b border-white/[0.05]">
          <h1 class="text-2xl font-black text-white tracking-tight">Conexão com a Nuvem</h1>
          <p class="text-zinc-500 text-xs mt-0.5">Gerencie sua sincronização com o Google Drive e o acesso ao seu catálogo.</p>
        </div>

        <div class="space-y-6">
          <!-- Card de Indicador do Banco de Dados Principal vs Fallback -->
          <div class="rounded-3xl bg-white/[0.015] border border-white/[0.05] p-6 space-y-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-xl ${this.state.activeDatabase === 'Firebase' ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400' : 'bg-blue-500/10 border border-blue-500/20 text-blue-400'} flex items-center justify-center shadow-sm">
                  <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                  </svg>
                </div>
                <div>
                  <h3 class="text-xs font-black text-white">Banco de Dados em Uso (BD)</h3>
                  <p class="text-[10px] text-zinc-500 font-semibold">Mecanismo de leitura e sincronização de dados</p>
                </div>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="w-2.5 h-2.5 rounded-full ${this.state.activeDatabase === 'Firebase' ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-amber-400 shadow-[0_0_8px_#fbbf24]'}"></span>
                <span class="text-xs font-bold text-white">
                  ${this.state.activeDatabase === 'Firebase' ? 'Firebase Firestore' : 'Google Drive (Fallback)'}
                </span>
              </div>
            </div>

            <div class="bg-neutral-900/60 border border-white/[0.04] p-4 rounded-xl leading-relaxed space-y-3">
              <div class="flex items-center justify-between border-b border-white/5 pb-2">
                <span class="text-xs font-bold text-zinc-300">Modo de Operação:</span>
                <span class="text-[10px] font-mono font-bold ${this.state.activeDatabase === 'Firebase' ? 'text-emerald-400' : 'text-amber-400'}">
                  ${this.state.activeDatabase === 'Firebase' ? '🟢 PRIMÁRIO: Firebase Firestore' : '🟠 CONTINGÊNCIA: Drive (Fallback)'}
                </span>
              </div>

              <p class="text-[11px] text-zinc-400 leading-relaxed">
                ${this.state.activeDatabase === 'Firebase' 
                  ? 'O sistema está lendo os dados do <strong class="text-amber-300">Firebase Firestore</strong> (banco principal) e realizando a <strong class="text-blue-300">Sincronização Dupla</strong> no seu Google Drive como backup contínuo.' 
                  : 'O Firebase Firestore está inativo ou inacessível no momento. O sistema alternou automaticamente para o <strong class="text-amber-300">Google Drive como Banco de Dados de Contingência</strong>.'}
              </p>

              <!-- Grid de Mapeamento das 5 Entidades do Banco de Dados -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <div class="flex items-center gap-2 bg-white/[0.02] border border-white/5 px-2.5 py-1.5 rounded-lg">
                  <span class="text-xs">📄</span>
                  <div class="min-w-0">
                    <p class="text-[10px] font-bold text-zinc-200">Demanda de Jogos</p>
                    <p class="text-[9px] text-zinc-500 truncate">lista.txt</p>
                  </div>
                </div>
                <div class="flex items-center gap-2 bg-white/[0.02] border border-white/5 px-2.5 py-1.5 rounded-lg">
                  <span class="text-xs">🏷️</span>
                  <div class="min-w-0">
                    <p class="text-[10px] font-bold text-zinc-200">Tags Personalizadas</p>
                    <p class="text-[9px] text-zinc-500 truncate">tags.json</p>
                  </div>
                </div>
                <div class="flex items-center gap-2 bg-white/[0.02] border border-white/5 px-2.5 py-1.5 rounded-lg">
                  <span class="text-xs">📜</span>
                  <div class="min-w-0">
                    <p class="text-[10px] font-bold text-zinc-200">Histórico de Concluídos</p>
                    <p class="text-[9px] text-zinc-500 truncate">historico.json</p>
                  </div>
                </div>
                <div class="flex items-center gap-2 bg-white/[0.02] border border-white/5 px-2.5 py-1.5 rounded-lg">
                  <span class="text-xs">📅</span>
                  <div class="min-w-0">
                    <p class="text-[10px] font-bold text-zinc-200">Datas de Adição</p>
                    <p class="text-[9px] text-zinc-500 truncate">added_dates.json</p>
                  </div>
                </div>
                <div class="flex items-center gap-2 bg-white/[0.02] border border-white/5 px-2.5 py-1.5 rounded-lg sm:col-span-2">
                  <span class="text-xs">👤</span>
                  <div class="min-w-0">
                    <p class="text-[10px] font-bold text-zinc-200">Contas Mapeadas (Acesso Emerson)</p>
                    <p class="text-[9px] text-zinc-500 truncate">emerson_accounts.json</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

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
                  <h3 class="text-xs font-black text-white">Google Drive</h3>
                  <p class="text-[10px] text-zinc-500 font-semibold">Status de Autenticação</p>
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
                  <p class="text-xs font-bold text-white truncate">${profile.email ? profile.email : 'Google Drive Conectado'}</p>
                  <p class="text-[10px] text-zinc-400 font-semibold leading-relaxed mt-0.5 max-w-md">Seu catálogo e arquivo de lista estão sendo salvos com segurança em sua própria pasta na nuvem.</p>
                </div>
                <button class="btn-logout-action flex items-center justify-center gap-2 text-xs font-bold py-2.5 px-4 text-center rounded-xl text-red-400 hover:bg-red-500/10 transition-colors border border-red-500/15 cursor-pointer shrink-0">
                  Sair da Conta
                </button>
              </div>
            ` : `
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-neutral-900/60 border border-white/[0.04] p-4 rounded-xl leading-relaxed">
                <div class="max-w-md">
                  <p class="text-xs font-bold text-white">Nenhum Drive Conectado</p>
                  <p class="text-[10px] text-zinc-500 font-medium leading-relaxed mt-0.5">Faça login com sua conta do Google para permitir que o sistema salve suas imagens e organize seu catálogo.</p>
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

          <!-- Gestão de Perfis Card (RESTRITO AO ADMINISTRADOR) -->
          ${isAdmin ? `
            <div class="rounded-3xl bg-white/[0.015] border border-white/[0.05] p-6 space-y-5">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="w-9 h-9 rounded-xl bg-purple-600/10 border border-purple-500/20 flex items-center justify-center text-purple-400 shadow-sm">
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                    </svg>
                  </div>
                  <div>
                    <h3 class="text-xs font-black text-white">Painel de Perfis e Permissões (Administrador)</h3>
                    <p class="text-[10px] text-zinc-500 font-semibold">Mapeamento confidencial de contas autorizadas</p>
                  </div>
                </div>
                <span class="text-[10px] font-black px-2.5 py-1 rounded-full border ${profile.badgeColor}">
                  André Luiz (Admin)
                </span>
              </div>

              <!-- Perfil Administrador -->
              <div class="bg-neutral-900/60 border border-amber-500/20 rounded-2xl p-4 space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-black text-amber-300 flex items-center gap-1.5">
                    Perfil Administrador: André Luiz
                  </span>
                  <span class="text-[9px] bg-amber-500/20 text-amber-300 font-bold px-2 py-0.5 rounded-md">Administrador</span>
                </div>
                <p class="text-[11px] text-zinc-400 font-medium leading-relaxed">
                  Possui acesso total ao sistema e ao <strong class="text-amber-200 font-bold">Botão exclusivo de Link Direto para Busca de Imagens no Google</strong> na lista de jogos.
                </p>
                <div class="pt-2 border-t border-white/5 space-y-1">
                  <span class="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block">Contas Google Atreladas ao Administrador:</span>
                  <div class="flex flex-wrap gap-1.5">
                    ${this.getAdminAccounts().map(email => `
                      <span class="text-[10px] font-mono bg-white/5 text-zinc-300 border border-white/10 px-2 py-0.5 rounded-lg ${profile.email && profile.email.toLowerCase() === email.toLowerCase() ? 'border-amber-500/50 text-amber-300 font-bold bg-amber-500/10' : ''}">${email}</span>
                    `).join('')}
                  </div>
                </div>
              </div>

              <!-- Perfil Usuário Comum -->
              <div class="bg-neutral-900/60 border border-blue-500/20 rounded-2xl p-4 space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-black text-blue-300 flex items-center gap-1.5">
                    Perfil Usuário Comum: Emerson
                  </span>
                  <span class="text-[9px] bg-blue-500/20 text-blue-300 font-bold px-2 py-0.5 rounded-md">Usuário Padrão</span>
                </div>
                <p class="text-[11px] text-zinc-400 font-medium leading-relaxed">
                  Acesso standard de organização: visualização do catálogo, adição/edição de jogos, envio de miniaturas e controle de prioridades.
                </p>
                <div class="pt-2 border-t border-white/5 space-y-1">
                  <span class="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block">Contas Google Registradas sob este Perfil:</span>
                  <div class="flex flex-wrap gap-1.5">
                    <span class="text-[10px] font-mono bg-white/5 text-zinc-300 border border-white/10 px-2 py-0.5 rounded-lg ${profile.email && profile.email.toLowerCase() === 'emerson@betdasorte.com' ? 'border-blue-500/50 text-blue-300 font-bold bg-blue-500/10' : ''}">emerson@betdasorte.com</span>
                    ${emersonAccounts.filter(e => e.toLowerCase() !== 'emerson@betdasorte.com' && !this.getAdminAccounts().map(a => a.toLowerCase()).includes(e.toLowerCase())).map(email => `
                      <span class="text-[10px] font-mono bg-white/5 text-zinc-300 border border-white/10 px-2 py-0.5 rounded-lg ${profile.email && profile.email.toLowerCase() === email.toLowerCase() ? 'border-blue-500/50 text-blue-300 font-bold bg-blue-500/10' : ''}">${email}</span>
                    `).join('')}
                  </div>
                </div>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  renderPreviewModal(item) {
    const modal = document.getElementById('preview-modal');
    const content = document.getElementById('modal-content');
    if (!modal || !content) return;

    if (modal.classList.contains('opacity-0')) {
      this.state.isShowingModalCat = false;
    }

    modal.classList.remove('pointer-events-none', 'opacity-0');
    const child = modal.firstElementChild;
    if (child) child.classList.remove('scale-95');

    const currentTag = this.getGameTag(item);
    const showCatEditor = this.state.isShowingModalCat || this.state.isSavingTag;

    content.innerHTML = `
      <div class="flex flex-col gap-4 pt-3 text-left relative h-full">
        <div class="relative w-full aspect-[2/3] rounded-2xl overflow-hidden bg-neutral-950 border border-white/5 shadow-inner shrink-0">
          <img id="modal-img-preview" src="" alt="${item.displayName}" class="w-full h-full object-cover">
          <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent"></div>
        </div>

        <div class="flex items-center justify-between gap-3 select-none">
          <h2 class="text-base font-black text-white leading-snug break-words min-w-0 flex-1">${item.displayName}</h2>
          <button id="modal-toggle-cat" class="shrink-0 py-1 px-2.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-[11px] font-medium text-zinc-400 hover:text-white border border-white/5 flex items-center gap-1.5 cursor-pointer transition-colors" title="Editar Categoria">
            <svg class="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
            <span>${currentTag || 'Categoria'}</span>
          </button>
        </div>

        <!-- Categoria do Jogo oculto inicialmente -->
        <div id="modal-cat-container" class="${showCatEditor ? '' : 'hidden'} space-y-1.5 select-none pt-1 transition-all">
          <div class="text-[10px] text-zinc-500 font-extrabold uppercase tracking-wider block">Categoria do Jogo (Tag)</div>
          <div class="flex gap-1.5 p-1 bg-white/[0.03] border border-white/[0.05] rounded-xl flex-wrap">
            ${this.state.isSavingTag ? `
              <div class="w-full py-1.5 flex items-center justify-center gap-2 text-[10px] font-bold text-zinc-500 animate-pulse">
                <svg class="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" /></svg>
                SALVANDO...
              </div>
            ` : `
            ${['Slot', 'Ao Vivo', 'Crash', 'Mesa RNG', 'Instant Win', 'Scratchcard', 'Prioridades'].map(tag => `
              <button data-cat-tag="${tag}" class="cat-tag-btn flex-1 min-w-[28%] sm:min-w-[30%] py-1.5 px-2 sm:px-3 rounded-lg text-[10px] sm:text-xs font-black flex items-center justify-center gap-1 transition-all cursor-pointer ${currentTag === tag ? 'bg-[#0a84ff]/20 text-[#0a84ff] border border-[#0a84ff]/30 shadow-sm' : 'bg-transparent text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300'}">
                <span class="w-1.5 h-1.5 rounded-full ${currentTag === tag ? 'bg-[#0a84ff] animate-pulse' : 'bg-transparent border border-zinc-600'}"></span>
                ${tag}
              </button>
            `).join('')}
            `}
          </div>
        </div>

        <div class="flex flex-col gap-2 select-none mt-auto pt-1 pb-2">
          <button id="modal-action-copy-name" class="w-full py-2 px-4 rounded-xl bg-zinc-800 text-white font-bold text-xs hover:bg-zinc-700 flex items-center justify-center gap-1.5 cursor-pointer">
            <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            <span>Copiar Nome do Jogo</span>
          </button>
          <button id="modal-action-copy-img" class="w-full py-2 px-4 rounded-xl bg-zinc-800 text-white font-bold text-xs hover:bg-zinc-700 flex items-center justify-center gap-1.5 cursor-pointer">
            <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span>Copiar Imagem</span>
          </button>
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

    const btnToggleCat = document.getElementById('modal-toggle-cat');
    if (btnToggleCat) {
      btnToggleCat.addEventListener('click', () => {
        this.state.isShowingModalCat = !this.state.isShowingModalCat;
        const catContainer = document.getElementById('modal-cat-container');
        if (catContainer) {
          catContainer.classList.toggle('hidden', !this.state.isShowingModalCat);
        }
      });
    }

    const btnDownload = document.getElementById('modal-action-download');
    if (btnDownload) {
      btnDownload.addEventListener('click', () => {
        this.handleDownloadFile(item);
      });
    }

    const btnCopyImg = document.getElementById('modal-action-copy-img');
    if (btnCopyImg) {
      btnCopyImg.addEventListener('click', () => {
        this.copyImageToClipboard(item);
      });
    }

    const btnCopyName = document.getElementById('modal-action-copy-name');
    if (btnCopyName) {
      btnCopyName.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(item.displayName);
          const originalHtml = btnCopyName.innerHTML;
          btnCopyName.innerHTML = '<svg class="w-4 h-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg><span class="text-emerald-400">Copiado!</span>';
          setTimeout(() => {
            btnCopyName.innerHTML = originalHtml;
          }, 2000);
        } catch (err) {
          console.error(err);
        }
      });
    }

    document.querySelectorAll('.cat-tag-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const selectedTag = e.currentTarget.getAttribute('data-cat-tag');
        if (selectedTag) {
          this.updateGameTag(item.id, selectedTag);
        }
      });
    });
  }

  closePreviewModal() {
    this.state.isShowingModalCat = false;
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
        text: 'Lista desatualizada? Use o botão <strong style="color:#fff;font-weight:900;">Sincronizar</strong> no topo do site para recarregar tudo com o Google Drive.',
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
    const iconEl = document.getElementById('chat-bubble-icon');
    const textEl = document.getElementById('chat-bubble-text');
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
        if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
        this.syncWithGoogleDrive();
      });
    }

    const btnLogin = document.getElementById('btn-login');
    if (btnLogin) {
      btnLogin.addEventListener('click', () => {
        this.handleGoogleLogin();
      });
    }

    const bannerBtnLogin = document.getElementById('banner-btn-login');
    if (bannerBtnLogin) {
      bannerBtnLogin.addEventListener('click', () => {
        this.handleGoogleLogin();
      });
    }

    const bannerBtnLoginMobile = document.getElementById('banner-btn-login-mobile');
    if (bannerBtnLoginMobile) {
      bannerBtnLoginMobile.addEventListener('click', () => {
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
    const btnCloseOnboarding = document.getElementById('btn-close-onboarding');
    if (btnCloseOnboarding && !btnCloseOnboarding.dataset.bound) {
      btnCloseOnboarding.dataset.bound = "true";
      btnCloseOnboarding.addEventListener('click', () => {
        this.state.hasSeenOnboarding = true;
        localStorage.setItem('thumbsync_has_seen_onboarding', 'true');
        this.render();
      });
    }

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

      const dateSelect = document.getElementById('catalouge-date-filter');
      if (dateSelect && !dateSelect.dataset.bound) {
        dateSelect.dataset.bound = "true";
        dateSelect.addEventListener('change', (e) => {
          this.state.filterDate = e.currentTarget.value;
          this.state.catalogPage = 1;
          this.saveStateToStorage();
          this.renderActiveTab();
        });
      }

      const quickFilters = document.querySelectorAll('.quick-filter-btn');
      quickFilters.forEach(btn => {
        btn.addEventListener('click', (e) => {
          this.state.filterStatus = e.currentTarget.getAttribute('data-quick-filter');
          this.state.catalogPage = 1;
          this.saveStateToStorage();
          this.renderActiveTab();
        });
      });

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

      // 3. Registro de Drag and Drop Global para sincronização inteligente em lote
      const dropzoneOverlay = document.getElementById('global-dropzone-overlay');
      const dropzonePanel = document.getElementById('global-dropzone-panel');

      if (dropzoneOverlay) {
        let dragCounter = 0;

        const onDragEnter = (e) => {
          if (this.state.activeTab !== 'catalog') return;
          e.preventDefault();
          dragCounter++;
          dropzoneOverlay.classList.remove('opacity-0', 'pointer-events-none');
          dropzoneOverlay.classList.add('opacity-100');
          if (dropzonePanel) dropzonePanel.classList.remove('scale-95');
        };

        const onDragOver = (e) => {
          if (this.state.activeTab !== 'catalog') return;
          e.preventDefault();
        };

        const onDragLeave = (e) => {
          if (this.state.activeTab !== 'catalog') return;
          e.preventDefault();
          dragCounter--;
          if (dragCounter === 0) {
            dropzoneOverlay.classList.remove('opacity-100');
            dropzoneOverlay.classList.add('opacity-0', 'pointer-events-none');
            if (dropzonePanel) dropzonePanel.classList.add('scale-95');
          }
        };

        const onDrop = async (e) => {
          if (this.state.activeTab !== 'catalog') return;
          e.preventDefault();
          dragCounter = 0;
          dropzoneOverlay.classList.remove('opacity-100');
          dropzoneOverlay.classList.add('opacity-0', 'pointer-events-none');
          if (dropzonePanel) dropzonePanel.classList.add('scale-95');

          if (!driveClient.isAuthenticated()) {
            alert("Ação não permitida offline. Conecte sua conta do Google Drive para fazer a sincronização inteligente!");
            return;
          }

          const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.webp'));
          if (files.length === 0) {
            alert("Nenhum arquivo .webp válido detectado! Envie apenas arquivos .webp.");
            return;
          }

          this.addLog(`Processando envio inteligente em lote de ${files.length} arquivos...`);
          this.state.isLoading = true;
          this.render();

          let successCount = 0;
          let failCount = 0;
          let skippedCount = 0;

          for (const file of files) {
            const fileBaseNameNoExt = file.name.replace(/\.webp$/i, '');
            const normalizedFileName = this.normalizeName(fileBaseNameNoExt);

            // Tentar localizar um jogo no catálogo com o mesmo nome
            const matchingItems = this.state.catalogItems.filter(item => item.normalizedName === normalizedFileName);

            if (matchingItems.length === 0) {
              this.addLog(`Pulado: Jogo não encontrado no catálogo para o arquivo '${file.name}'`);
              skippedCount++;
              continue;
            }

            // Se encontrou, escolhe o primeiro correspondente
            const item = matchingItems[0];
            const providerName = item.providerName || "Sem provedor";

            this.addLog(`Sincronizando '${file.name}' (${Math.round(file.size / 1024)} KB) -> ${providerName}::${item.displayName}`);

            try {
              let targetFolderId = this.state.thumbsFolderId;
              if (providerName && providerName !== "Sem provedor") {
                targetFolderId = await driveClient.findOrCreateSubfolder(providerName, this.state.thumbsFolderId);
              }

              const fileNameOnDrive = `${item.displayName}.webp`;
              await driveClient.uploadImage(fileNameOnDrive, file, targetFolderId);
              successCount++;
            } catch (err) {
              console.error(`Erro ao enviar ${file.name}:`, err);
              failCount++;
            }
          }

          this.addLog(`Lote concluído! Sucesso: ${successCount} | Pulado: ${skippedCount} | Falha: ${failCount}`);
          alert(`Sincronização em lote concluída!\n\nSucesso: ${successCount} miniaturas associadas e enviadas.\nNão encontrados no catálogo: ${skippedCount}.\nErros: ${failCount}.`);

          // Sincronizar após envio de todos os arquivos do lote
          await this.syncWithGoogleDrive();
        };

        window.addEventListener('dragenter', onDragEnter);
        window.addEventListener('dragover', onDragOver);
        window.addEventListener('dragleave', onDragLeave);
        window.addEventListener('drop', onDrop);

        // Descadastrar esses listeners de window ao destruir os observers desta aba
        this.observers.push({
          disconnect: () => {
            window.removeEventListener('dragenter', onDragEnter);
            window.removeEventListener('dragover', onDragOver);
            window.removeEventListener('dragleave', onDragLeave);
            window.removeEventListener('drop', onDrop);
          }
        });
      }
    }

    // EVENTS DE LISTA.TXT
    if (this.state.activeTab === 'list_manager') {
      const btnSubtabMural = document.getElementById('subtab-btn-mural');
      if (btnSubtabMural) {
        btnSubtabMural.addEventListener('click', () => {
          this.state.muralSubTab = 'mural';
          this.renderActiveTab();
        });
      }

      const btnSubtabHistory = document.getElementById('subtab-btn-history');
      if (btnSubtabHistory) {
        btnSubtabHistory.addEventListener('click', () => {
          this.state.muralSubTab = 'history';
          this.renderActiveTab();
          this.syncHistoryFromDrive();
        });
      }

      const btnViewHistory = document.getElementById('btn-view-history');
      if (btnViewHistory) {
        btnViewHistory.addEventListener('click', () => {
          this.state.muralSubTab = 'history';
          this.renderActiveTab();
          this.syncHistoryFromDrive();
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

      const btnImportCSV = document.getElementById('btn-import-csv');
      if (btnImportCSV) {
        btnImportCSV.addEventListener('click', () => {
          this.state.isImportingCSV = true;
          this.renderActiveTab();
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
        btnCreateProvider.addEventListener('click', async () => {
          const input = document.getElementById('new-provider-name');
          if (input && input.value.trim() !== '') {
            const name = input.value.trim();

            await this.fetchLatestListContent();

            const lines = this.state.listContent.split(/\r?\n/);
            if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
              lines.push('');
            }
            lines.push(`Provedor: ${name}`);
            await this.saveUpdatedList(lines.join('\n'));
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
          e.stopPropagation();
          const provider = e.currentTarget.getAttribute('data-trigger-add-game') || '';
          this.state.isAddingGame = true;
          this.state.addingGameToProvider = provider;
          this.renderActiveTab();
        });
      });

      const togglePriorityTriggers = document.querySelectorAll('[data-trigger-toggle-provider-priority]');
      togglePriorityTriggers.forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const provider = e.currentTarget.getAttribute('data-trigger-toggle-provider-priority') || '';
          if (provider) {
            await this.handleToggleProviderPriority(provider);
          }
        });
      });

      const providerToggles = document.querySelectorAll('[data-provider-toggle]');
      providerToggles.forEach(toggle => {
        const toggleProvider = () => {
          const providerKey = decodeURIComponent(toggle.getAttribute('data-provider-toggle') || '');
          if (!providerKey) return;

          if (this.state.collapsedProviderKeys.has(providerKey)) {
            this.state.collapsedProviderKeys.delete(providerKey);
          } else {
            this.state.collapsedProviderKeys.add(providerKey);
          }

          this.renderActiveTab();
        };

        toggle.addEventListener('click', (e) => {
          if (e.target.closest('button, input, select, textarea, a')) return;
          toggleProvider();
        });

        toggle.addEventListener('keydown', (e) => {
          if (e.target.closest('button, input, select, textarea, a')) return;
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          toggleProvider();
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
        btnAddGameConfirm.addEventListener('click', async () => {
          const providerSelect = document.getElementById('modal-add-game-provider-select');
          const textarea = document.getElementById('new-game-displayNames');

          const selectedProvider = providerSelect ? providerSelect.value : this.state.addingGameToProvider;
          const textValue = textarea ? textarea.value.trim() : '';

          if (textValue !== '' && selectedProvider) {
            const gameLines = textValue.split('\n').map(l => l.trim()).filter(Boolean);
            if (gameLines.length > 0) {
              await this.handleAddGamesToList(selectedProvider, gameLines);
            }
            this.state.isAddingGame = false;
            this.renderActiveTab();
          }
        });
      }

      const btnImportCSVCancel = document.getElementById('modal-import-csv-cancel');
      if (btnImportCSVCancel) {
        btnImportCSVCancel.addEventListener('click', () => {
          this.state.isImportingCSV = false;
          this.renderActiveTab();
        });
      }

      const btnImportCSVConfirm = document.getElementById('modal-import-csv-confirm');
      if (btnImportCSVConfirm) {
        btnImportCSVConfirm.addEventListener('click', async () => {
          const providerSelect = document.getElementById('modal-import-csv-provider-select');
          const fileInput = document.getElementById('import-csv-file-input');

          const selectedProvider = providerSelect ? providerSelect.value : '';
          const file = fileInput ? fileInput.files[0] : null;

          if (selectedProvider && file) {
            await this.handleImportCSV(selectedProvider, file);
          } else if (!file) {
            alert("Por favor, selecione um arquivo CSV.");
          }
        });
      }

      const listPreviewTriggers = document.querySelectorAll('[data-list-preview-key]');
      listPreviewTriggers.forEach(btn => {
        btn.addEventListener('click', (e) => {
          if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.select-text')) {
            return;
          }
          const key = e.currentTarget.getAttribute('data-list-preview-key');
          const catalogItem = this.state.catalogItems.find(i => i.id === key);
          if (catalogItem) {
            this.state.selectedCatalogItem = catalogItem;
            this.renderPreviewModal(catalogItem);
          }
        });
      });

      const editTriggers = document.querySelectorAll('[data-edit-catalog-key]');
      editTriggers.forEach(btn => {
        btn.addEventListener('click', (e) => {
          const key = e.currentTarget.getAttribute('data-edit-catalog-key');
          const catalogItem = this.state.catalogItems.find(i => i.id === key);
          if (catalogItem) {
            this.state.isEditingGameName = true;
            this.state.editingGameItem = catalogItem;
            this.renderActiveTab();
          }
        });
      });

      const notFoundTriggers = document.querySelectorAll('[data-notfound-catalog-key]');
      notFoundTriggers.forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const key = e.currentTarget.getAttribute('data-notfound-catalog-key');
          const catalogItem = this.state.catalogItems.find(i => i.id === key);
          if (catalogItem) {
            await this.handleToggleNotFound(catalogItem);
          }
        });
      });

      const priorityTriggers = document.querySelectorAll('[data-priority-catalog-key]');
      priorityTriggers.forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const key = e.currentTarget.getAttribute('data-priority-catalog-key');
          const catalogItem = this.state.catalogItems.find(i => i.id === key);
          if (catalogItem) {
            await this.handleTogglePriority(catalogItem);
          }
        });
      });

      const copyTriggers = document.querySelectorAll('[data-copy-catalog-name]');
      copyTriggers.forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const name = e.currentTarget.getAttribute('data-copy-catalog-name');
          if (name) {
            try {
              await navigator.clipboard.writeText(name);
              const originalHTML = e.currentTarget.innerHTML;
              e.currentTarget.innerHTML = '<svg class="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>';
              setTimeout(() => {
                e.currentTarget.innerHTML = originalHTML;
              }, 1500);
            } catch (err) {
              console.error('Failed to copy text: ', err);
            }
          }
        });
      });

      const btnEditGameCancel = document.getElementById('modal-edit-game-cancel');
      if (btnEditGameCancel) {
        btnEditGameCancel.addEventListener('click', () => {
          this.state.isEditingGameName = false;
          this.state.editingGameItem = null;
          this.renderActiveTab();
        });
      }

      const btnEditGameConfirm = document.getElementById('modal-edit-game-confirm');
      if (btnEditGameConfirm) {
        btnEditGameConfirm.addEventListener('click', async () => {
          const input = document.getElementById('modal-edit-game-name');
          if (input && this.state.editingGameItem) {
            const newName = input.value;
            await this.handleEditGameInList(this.state.editingGameItem, newName);
            this.state.isEditingGameName = false;
            this.state.editingGameItem = null;
            this.renderActiveTab();
          }
        });
      }

      const deleteTriggers = document.querySelectorAll('[data-delete-catalog-key]');
      deleteTriggers.forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const key = e.currentTarget.getAttribute('data-delete-catalog-key');
          const catalogItem = this.state.catalogItems.find(i => i.id === key);
          if (catalogItem) {
            await this.handleExcludeGameFromList(catalogItem);
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
              const proceed = confirm("ATENÇÃO & CUIDADO:\nVocê está alterando o Google Client ID padrão homologado para esta aplicação.\n\nFazer isso pode comprometer a autenticação e interromper totalmente o sincronismo automático de imagens com o Google Drive.\n\nDeseja realmente prosseguir com a alteração do Client ID?");
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
  notifyNewlyCompleted(games) {
    if (!games || games.length === 0) return;
    if (this.isAdmin()) return; // Não exibe para administrador, apenas para Emerson

    // 1. In-site Toast
    this.showNewCompletedGameToast(games);

    // 2. Sound Effect
    this.playNotificationSound();

    // 3. Browser Notification
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        this.sendBrowserNotification(games);
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            this.sendBrowserNotification(games);
          }
        });
      }
    }
  }

  playNotificationSound() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
      oscillator.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1); // A5
      
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
      console.warn("Erro ao tocar som de notificação:", e);
    }
  }

  sendBrowserNotification(games) {
    const title = 'Miniatura(s) Finalizada(s)!';
    const body = games.length === 1 
      ? `O jogo "${games[0].displayName}" foi marcado como feito.` 
      : `${games.length} jogos foram marcados como feitos.`;
    
    try {
      new Notification(title, {
        body: body,
        icon: 'favicon.png'
      });
    } catch (e) {
      console.warn("Erro ao enviar notificação do navegador:", e);
    }
  }

  showNewCompletedGameToast(games) {
    let existingToast = document.getElementById('completed-game-toast');
    if (existingToast) {
      existingToast.remove();
    }
    
    const toast = document.createElement('div');
    toast.id = 'completed-game-toast';
    Object.assign(toast.style, {
      position: 'fixed',
      top: '24px',
      right: '24px',
      transform: 'scale(0.9) translateX(120%)',
      backgroundColor: '#10b981', // emerald-500
      color: '#fff',
      padding: '16px 24px',
      borderRadius: '16px',
      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)',
      zIndex: '10000',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '15px',
      fontWeight: '600',
      opacity: '0',
      transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)'
    });

    const gamesText = games.length === 1 
      ? `<span style="color:#a7f3d0;">${games[0].displayName}</span>`
      : `${games.length} jogos`;

    toast.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
      <div style="display:flex; flex-direction:column;">
        <span>Miniatura finalizada!</span>
        <span style="font-weight:400; font-size:13px; opacity:0.9;">${gamesText} marcado(s) como feito(s).</span>
      </div>
      <button id="completed-game-toast-close" style="background:transparent; border:none; cursor:pointer; padding:8px; display:flex; align-items:flex-start; justify-content:center; opacity:0.7; height:100%; color:white; margin-left: 8px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    `;

    document.body.appendChild(toast);
    toast.getBoundingClientRect(); // force reflow
    toast.style.opacity = '1';
    toast.style.transform = 'scale(1) translateX(0)';

    const removeToast = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'scale(0.9) translateX(120%)';
      setTimeout(() => toast.remove(), 400);
    };

    toast.querySelector('#completed-game-toast-close').addEventListener('click', removeToast);
    setTimeout(removeToast, 6000);
  }
}

// Inicializar aplicativo no carregamento da página
window.addEventListener('load', async () => {
  await loadMappings();
  new ThumbSyncApp().render();
});
