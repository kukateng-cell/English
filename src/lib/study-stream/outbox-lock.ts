/** IndexedDB serializes readwrite transactions across tabs, including browsers
 * without Web Locks. Keep the localStorage read/modify/write callback synchronous
 * inside a live transaction; no network or await may enter this critical section.
 * The existing storage format and pending actions remain readable on upgrade.
 */
export async function withStudyOutboxLock<T>(mutate: () => T): Promise<T> {
  if (typeof window === "undefined" || !window.indexedDB) {
    throw new Error("STUDY_STREAM_STORAGE_UNAVAILABLE");
  }
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    const request = window.indexedDB.open("english-study-outbox-lock", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("mutex");
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error("STUDY_STREAM_STORAGE_UNAVAILABLE")); };
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("mutex", "readwrite");
      let result: T;
      let failure: unknown;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? tx.error);
      tx.onerror = () => reject(failure ?? tx.error);
      tx.objectStore("mutex").get("lock").onsuccess = () => {
        try { result = mutate(); }
        catch (error) { failure = error; tx.abort(); }
      };
    });
  } finally { db.close(); }
}
