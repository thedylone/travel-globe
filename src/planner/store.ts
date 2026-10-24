// Plans are kept in this browser's IndexedDB. Nothing leaves the phone until it's exported.
import type { Plan } from "./plan";

const DB = "travel-planner";
const STORE = "plans";

let opening: Promise<IDBDatabase> | undefined;
const db = () =>
    (opening ??= new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }));

const run = async <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>) => {
    const tx = (await db()).transaction(STORE, mode);
    const req = op(tx.objectStore(STORE));
    return new Promise<T>((resolve, reject) => {
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
};

export const store = {
    /** Newest first. */
    all: () => run<Plan[]>("readonly", (s) => s.getAll()).then((ps) => ps.sort((a, b) => b.updated - a.updated)),
    put: (p: Plan) => run("readwrite", (s) => s.put(p)).then(() => undefined),
    remove: (id: string) => run("readwrite", (s) => s.delete(id)).then(() => undefined),
};

/**
 * Asks the browser not to clear the plans when it's short of space. Safari can still clear a
 * site's storage after weeks without a visit, which is why the planner asks you to export.
 */
export const persist = async () => {
    try {
        return (await navigator.storage?.persist?.()) ?? false;
    } catch {
        return false;
    }
};

/** Saves a file: the share sheet on phones that have one (Save to Files, AirDrop, …), else a download. */
export const saveFiles = async (files: File[]) => {
    if (navigator.canShare?.({ files })) {
        try {
            await navigator.share({ files });
            return true;
        } catch (e) {
            // Closing the share sheet isn't a failure, but nothing was saved.
            if ((e as Error).name === "AbortError") return false;
        }
    }
    for (const f of files) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(f);
        a.download = f.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    return true;
};
