export interface GameItem {
  displayName: string;
  normalizedName: string;
  providerName: string;
}

export interface ProviderGroup {
  providerName: string;
  games: GameItem[];
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  webContentLink?: string;
  size?: string;
  modifiedTime?: string;
  providerName?: string;
}

export interface CatalogItem {
  id: string;
  displayName: string;
  normalizedName: string;
  providerName: string;
  isListed: boolean;
  hasWebp: boolean;
  driveFileId?: string;
  fileSize?: string;
  modifiedTime?: string;
}

export interface AppConfig {
  clientId: string;
  folderName: string;
  listFileName: string;
  useMock: boolean;
}
