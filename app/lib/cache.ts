/**
 * Turbine Caching Layer
 * Simple in-memory cache with TTL support for high-performance manifest serving.
 */

type CacheEntry<T> = {
  data: T;
  expiry: number;
}

class TurbineCache {
  private static instance: TurbineCache;
  private storage: Map<string, CacheEntry<any>> = new Map();
  private defaultTtl: number = 3600000; // 1 hour in ms

  private constructor() {
    // Periodic cleanup of expired entries every 30 minutes
    setInterval(() => this.cleanup(), 1800000);
  }

  public static getInstance(): TurbineCache {
    if (!TurbineCache.instance) {
      TurbineCache.instance = new TurbineCache();
    }
    return TurbineCache.instance;
  }

  /**
   * Set a value in cache
   */
  public set(key: string, value: any, ttl?: number): void {
    const expiry = Date.now() + (ttl || this.defaultTtl);
    this.storage.set(key, { data: value, expiry });
  }

  /**
   * Get a value from cache
   */
  public get<T>(key: string): T | null {
    const entry = this.storage.get(key);
    
    if (!entry) return null;

    if (Date.now() > entry.expiry) {
      this.storage.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Delete a key from cache
   */
  public delete(key: string): void {
    this.storage.delete(key);
  }

  /**
   * Clear all items
   */
  public clear(): void {
    this.storage.clear();
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    this.storage.forEach((entry, key) => {
      if (now > entry.expiry) {
        this.storage.delete(key);
      }
    });
  }
}

export const turbineCache = TurbineCache.getInstance();
