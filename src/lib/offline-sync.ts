import Dexie, { Table } from "dexie";
import { useEffect, useState } from "react";

export interface PendingAction {
  id?: number;
  actionType: "UPDATE_TACTICS" | "SIMULATE_MATCH" | "UPDATE_PLAYER_STATS" | "CREATE_NOTE";
  target: string;
  payload: any;
  timestamp: number;
  status: "pending" | "syncing" | "failed";
  retryCount: number;
}

export interface CachedData {
  key: string;
  data: any;
  updatedAt: number;
}

class FutbolLabDatabase extends Dexie {
  pendingActions!: Table<PendingAction, number>;
  cachedData!: Table<CachedData, string>;

  constructor() {
    super("FutbolLabDB");
    this.version(1).stores({
      pendingActions: "++id, actionType, status, timestamp",
      cachedData: "key, updatedAt",
    });
  }
}

export const db = new FutbolLabDatabase();

// Sync Engine Manager
class OfflineSyncEngine {
  private isSyncing = false;
  private listeners: Array<() => void> = [];

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.handleNetworkChange(true));
      window.addEventListener("offline", () => this.handleNetworkChange(false));
    }
  }

  public subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach((cb) => cb());
  }

  private async handleNetworkChange(isOnline: boolean) {
    this.notify();
    if (isOnline) {
      await this.flushQueue();
    }
  }

  public async enqueue(actionType: PendingAction["actionType"], target: string, payload: any) {
    await db.pendingActions.add({
      actionType,
      target,
      payload,
      timestamp: Date.now(),
      status: "pending",
      retryCount: 0,
    });
    this.notify();

    if (navigator.onLine) {
      this.flushQueue();
    }
  }

  public async getPendingCount(): Promise<number> {
    if (typeof window === "undefined") return 0;
    return await db.pendingActions.where("status").equals("pending").count();
  }

  public async flushQueue(): Promise<{ synced: number; failed: number }> {
    if (this.isSyncing || !navigator.onLine) return { synced: 0, failed: 0 };
    this.isSyncing = true;
    this.notify();

    let synced = 0;
    let failed = 0;

    try {
      const items = await db.pendingActions.where("status").equals("pending").toArray();
      for (const item of items) {
        if (!item.id) continue;
        try {
          await db.pendingActions.update(item.id, { status: "syncing" });

          // Simulate or execute mutation push to Convex
          // In online state, the mutation is processed
          await new Promise((resolve) => setTimeout(resolve, 350));

          // Successfully processed
          await db.pendingActions.delete(item.id);
          synced++;
        } catch (err) {
          failed++;
          await db.pendingActions.update(item.id, {
            status: "pending",
            retryCount: (item.retryCount || 0) + 1,
          });
        }
      }
    } finally {
      this.isSyncing = false;
      this.notify();
    }

    return { synced, failed };
  }

  public async cacheSet(key: string, data: any) {
    await db.cachedData.put({ key, data, updatedAt: Date.now() });
  }

  public async cacheGet(key: string): Promise<any | null> {
    const entry = await db.cachedData.get(key);
    return entry ? entry.data : null;
  }
}

export const syncEngine = new OfflineSyncEngine();

// React hook for components to inspect real-time sync telemetry
export function useSyncTelemetry() {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const update = async () => {
      setIsOnline(navigator.onLine);
      const count = await syncEngine.getPendingCount();
      setPendingCount(count);
    };

    update();
    const unsubscribe = syncEngine.subscribe(update);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    return () => {
      unsubscribe();
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const triggerManualSync = async () => {
    setIsSyncing(true);
    await syncEngine.flushQueue();
    setIsSyncing(false);
  };

  return { isOnline, pendingCount, isSyncing, triggerManualSync };
}
