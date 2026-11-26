import { WorldMetadata, WorldSaveData } from '../types/game';

const DB_NAME = 'terravoxel_saves_v1';
const STORE_NAME = 'worlds';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'meta.id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listSavedWorlds(): Promise<WorldMetadata[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = (req.result as WorldSaveData[]) ?? [];
        const metas = items.map((w) => w.meta).sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(metas);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function saveWorldToDb(data: WorldSaveData): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(data);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function loadWorldFromDb(id: string): Promise<WorldSaveData | null> {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve((req.result as WorldSaveData) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteWorldFromDb(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function downloadWorldSaveFile(data: WorldSaveData): void {
  const json = JSON.stringify(data);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = data.meta.name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'world';
  a.href = url;
  a.download = `${safeName}_terravoxel.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function parseWorldSaveFile(file: File): Promise<WorldSaveData> {
  const text = await file.text();
  const parsed = JSON.parse(text) as WorldSaveData;
  if (!parsed?.meta?.id || !parsed?.player || !Array.isArray(parsed.modifiedChunks)) {
    throw new Error('Invalid TerraVoxel world save file');
  }
  return parsed;
}
