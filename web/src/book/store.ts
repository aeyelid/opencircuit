import { coercePrefs, coerceStored, serializeBook, type Book, type ListenPrefs } from "./model.ts";

const DB_NAME = "opencircuit-listening-book";
const STORE = "kv";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB"));
  });
}

async function kvGet(key: string): Promise<unknown> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error("read"));
    });
  } finally {
    db.close();
  }
}

async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("write"));
      tx.onabort = () => reject(tx.error ?? new Error("abort"));
      tx.objectStore(STORE).put(value, key);
    });
  } finally {
    db.close();
  }
}

export async function loadStoredBook(): Promise<Book | null> {
  const raw = await kvGet("book");
  if (raw == null) return null;
  return coerceStored(raw);
}

export async function saveStoredBook(book: Book): Promise<void> {
  const file = JSON.parse(serializeBook(book)) as unknown;
  await kvSet("book", file);
}

export async function loadStoredPrefs(): Promise<ListenPrefs | null> {
  const raw = await kvGet("prefs");
  if (raw == null) return null;
  return coercePrefs(raw);
}

export async function saveStoredPrefs(prefs: ListenPrefs): Promise<void> {
  await kvSet("prefs", prefs);
}
