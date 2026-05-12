const DB_NAME = "rajo-offline";
// v2: stores ArrayBuffer + audioType instead of Blob (Blob references are
// invalidated across iOS Safari page suspensions; ArrayBuffer survives).
const DB_VERSION = 2;
const STORE_NAME = "pending_recordings";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        // v1 → v2: schema changed (Blob → ArrayBuffer); drop old store.
        if (event.oldVersion > 0 && db.objectStoreNames.contains(STORE_NAME)) {
          db.deleteObjectStore(STORE_NAME);
        }
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

// Internal shape stored in IndexedDB.
interface StoredRecording {
  id?: number;
  audioData: ArrayBuffer;
  audioType: string;
  promptId: string;
  promptText: string;
  packId: string;
  donorId: string;
  authUserId: string;
  dialect: string;
  gender: string;
  ageRange: string;
  country: string;
  city: string;
  deviceType: string;
  backgroundNoise: string;
  speakingSpeed: string;
  createdAt: string;
  retryCount: number;
  status: "pending_offline" | "failed_permanently";
}

// External shape returned to callers (audioBlob reconstructed from ArrayBuffer).
export interface PendingRecording {
  id: number;
  audioBlob: Blob;
  promptId: string;
  promptText: string;
  packId: string;
  donorId: string;
  authUserId: string;
  dialect: string;
  gender: string;
  ageRange: string;
  country: string;
  city: string;
  deviceType: string;
  backgroundNoise: string;
  speakingSpeed: string;
  createdAt: string;
  retryCount: number;
  status: "pending_offline" | "failed_permanently";
}

function toExternal(r: StoredRecording): PendingRecording {
  const { audioData, audioType, ...rest } = r;
  return {
    ...rest,
    id: r.id!,
    audioBlob: new Blob([audioData], { type: audioType }),
  };
}

export async function saveOfflineRecording(
  recording: Omit<PendingRecording, "id" | "retryCount" | "status">,
): Promise<number> {
  const audioData = await recording.audioBlob.arrayBuffer();
  const stored: Omit<StoredRecording, "id"> = {
    audioData,
    audioType: recording.audioBlob.type || "audio/webm",
    promptId: recording.promptId,
    promptText: recording.promptText,
    packId: recording.packId,
    donorId: recording.donorId,
    authUserId: recording.authUserId,
    dialect: recording.dialect,
    gender: recording.gender,
    ageRange: recording.ageRange,
    country: recording.country,
    city: recording.city,
    deviceType: recording.deviceType,
    backgroundNoise: recording.backgroundNoise,
    speakingSpeed: recording.speakingSpeed,
    createdAt: recording.createdAt,
    retryCount: 0,
    status: "pending_offline",
  };

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).add(stored);
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingRecordings(): Promise<PendingRecording[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const rows = req.result as StoredRecording[];
      resolve(rows.filter((r) => r.status === "pending_offline").map(toExternal));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const count = (req.result as StoredRecording[]).filter(
        (r) => r.status === "pending_offline",
      ).length;
      resolve(count);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deletePendingRecording(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function incrementRetryCount(id: number): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result as StoredRecording | undefined;
      if (!record) { resolve(0); return; }
      record.retryCount = (record.retryCount ?? 0) + 1;
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve(record.retryCount);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function markFailedPermanently(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result as StoredRecording | undefined;
      if (!record) { resolve(); return; }
      record.status = "failed_permanently";
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}
