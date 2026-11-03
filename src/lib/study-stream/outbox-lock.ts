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
      const store = tx.objectStore("mutex");
      store.get("lock").onsuccess = () => {
        try { result = mutate(); }
        catch (error) { failure = error; tx.abort(); return; }
        // Firefox 把本 task 內的 localStorage 改動在 task 結束時才送出；若交易在同一
        // task 內完成，另一分頁可能在改動送達前取得鎖並讀到舊資料，造成遺失寫入。
        // 在下一個 task 再發一個請求，令鎖持有到 localStorage 改動已送出之後。
        store.put(Date.now(), "lock").onsuccess = () => { store.get("lock"); };
      };
    });
  } finally { db.close(); }
}
