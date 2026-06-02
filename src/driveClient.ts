import { DriveFile } from './types';

export class DriveApiClient {
  private accessToken: string | null = null;

  setAccessToken(token: string) {
    this.accessToken = token;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  private async fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
    if (!this.accessToken) {
      throw new Error("Usuário não autenticado no Google Drive.");
    }

    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${this.accessToken}`);

    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      // Token expired or invalid
      this.accessToken = null;
      localStorage.removeItem('gdrive_access_token');
      localStorage.removeItem('gdrive_token_expires_at');
      window.dispatchEvent(new Event('gdrive_unauthorized'));
      throw new Error("Sessão do Google Drive expirada. Faça login novamente.");
    }
    return res;
  }

  /**
   * Search for a folder by name inside the user's Drive.
   * If folder does not exist, create it.
   */
  async findOrCreateFolder(folderName: string): Promise<string> {
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

    // Create folder
    const createUrl = 'https://www.googleapis.com/drive/v3/files';
    const createRes = await this.fetchWithAuth(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
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
   * Search for a folder by name inside a parent folder in the user's Drive.
   * If folder does not exist, create it inside that parent.
   */
  async findOrCreateSubfolder(folderName: string, parentFolderId: string): Promise<string> {
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

    // Create folder inside parent
    const createUrl = 'https://www.googleapis.com/drive/v3/files';
    const createRes = await this.fetchWithAuth(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
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
   * List all files inside a folder (or recursively).
   */
  async listFilesInFolder(folderId: string): Promise<DriveFile[]> {
    // List directly within the parent folder
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
   * Retrieve file content as text (e.g. for list.txt).
   */
  async downloadTextFile(fileId: string): Promise<string> {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const res = await this.fetchWithAuth(url);
    if (!res.ok) {
      throw new Error(`Erro ao ler conteúdo do arquivo: ${res.statusText}`);
    }
    return await res.text();
  }

  /**
   * Download a binary file (like a .webp image) as a Blob.
   */
  async downloadBinaryFile(fileId: string): Promise<Blob> {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const res = await this.fetchWithAuth(url);
    if (!res.ok) {
      throw new Error(`Erro ao carregar miniatura do Google Drive: ${res.statusText}`);
    }
    return await res.blob();
  }

  /**
   * Write text content to Google Drive.
   * If fileId is provided, overwrites it.
   * If not, creates the file inside parentFolderId.
   */
  async saveTextFile(fileName: string, content: string, parentFolderId?: string, fileId?: string): Promise<string> {
    if (fileId) {
      // Overwrite existing file media contents
      const updateUrl = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
      const res = await this.fetchWithAuth(updateUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8'
        },
        body: content
      });

      if (!res.ok) {
        throw new Error(`Erro ao atualizar arquivo no Drive: ${res.statusText}`);
      }

      // Also update metadata (modifiedTime touches automatically, but can update name if needed)
      return fileId;
    } else {
      if (!parentFolderId) {
        throw new Error("parentFolderId é obrigatório para criar novos arquivos.");
      }

      // 1. Create metadata
      const createMetaUrl = 'https://www.googleapis.com/drive/v3/files';
      const metaRes = await this.fetchWithAuth(createMetaUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
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
      const newFileId = newFile.id;

      // 2. Upload content
      return await this.saveTextFile(fileName, content, undefined, newFileId);
    }
  }

  /**
   * Uploads an image File/Blob to the specified Google Drive parent folder.
   */
  async uploadImage(fileName: string, blob: Blob, parentFolderId: string): Promise<DriveFile> {
    // We use a simplified two-step client metadata creation + media upload
    // 1. Create Metadata
    const createMetaUrl = 'https://www.googleapis.com/drive/v3/files';
    const metaRes = await this.fetchWithAuth(createMetaUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
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

    // 2. Upload media
    const uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${newFileId}?uploadType=media`;
    const uploadRes = await this.fetchWithAuth(uploadUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'image/webp'
      },
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
