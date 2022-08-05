import NodeCache from "node-cache";

class Cache {
    private static instance: Cache;
    private cache: NodeCache;

    constructor() {
        this.cache = new NodeCache({ useClones: false });

    }

    public static getInstance(): Cache {
        if (!Cache.instance) {
            Cache.instance = new Cache();
        }

        return Cache.instance;
    }

    async get(key: NodeCache.Key, retrieveData: () => any) {
        const value = this.cache.get(key);
        if (value) {
            return value;
        }

        const data = await retrieveData();
        this.cache.set(key, data, 120);
        return data;
    }

    setTtl(key: string, ttl: number): boolean {
        return this.cache.ttl(key, ttl);
    }

    del(key: string): number {
        return this.cache.del(key);
    }

    keys(): string[] {
        return this.cache.keys();
    }
}

export default Cache;
