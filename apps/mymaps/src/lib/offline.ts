const DB_NAME = 'mymaps-idb';
const DB_VER = 1;

let _db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('maps'))
        db.createObjectStore('maps', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('layers')) {
        const ls = db.createObjectStore('layers', { keyPath: 'id' });
        ls.createIndex('map_id', 'map_id');
      }
      if (!db.objectStoreNames.contains('features')) {
        const fs = db.createObjectStore('features', { keyPath: 'id' });
        fs.createIndex('layer_id', 'layer_id');
      }
    };
    req.onsuccess = (e) => {
      _db = (e.target as IDBOpenDBRequest).result;
      resolve(_db!);
    };
    req.onerror = () => reject(req.error);
  });
}

function op<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(storeName, mode).objectStore(storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

function byIndex<T>(storeName: string, indexName: string, value: string): Promise<T[]> {
  return openDB().then(
    (db) =>
      new Promise<T[]>((resolve, reject) => {
        const req = db
          .transaction(storeName, 'readonly')
          .objectStore(storeName)
          .index(indexName)
          .getAll(value);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const idb = {
  maps: {
    getAll: <T = unknown>(): Promise<T[]> => op('maps', 'readonly', (s) => s.getAll()),
    put: (v: unknown) => op('maps', 'readwrite', (s) => s.put(v)),
    delete: (id: string) => op('maps', 'readwrite', (s) => s.delete(id)),
  },
  layers: {
    getByMap: <T = unknown>(mapId: string): Promise<T[]> =>
      byIndex<T>('layers', 'map_id', mapId),
    put: (v: unknown) => op('layers', 'readwrite', (s) => s.put(v)),
    delete: (id: string) => op('layers', 'readwrite', (s) => s.delete(id)),
  },
  features: {
    getByLayer: <T = unknown>(layerId: string): Promise<T[]> =>
      byIndex<T>('features', 'layer_id', layerId),
    put: (v: unknown) => op('features', 'readwrite', (s) => s.put(v)),
    delete: (id: string) => op('features', 'readwrite', (s) => s.delete(id)),
  },
};
