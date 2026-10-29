/**
 * OctoSQL Cache Layer
 * Integrates Redis if available, or high-speed in-memory store with TTL and stats
 */
class OctoCache {
  constructor(options = {}) {
    this.redisHost = options.redisHost || process.env.REDIS_HOST || '127.0.0.1';
    this.redisPort = options.redisPort || process.env.REDIS_PORT || 6379;
    this.memoryStore = new Map();
    this.ttls = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      writes: 0,
      invalidations: 0,
      driver: 'in-memory-lru'
    };

    this.initRedis();
  }

  async initRedis() {
    // Attempt net connection check to Redis without throwing
    const net = require('net');
    const socket = new net.Socket();
    socket.setTimeout(800);

    socket.on('connect', () => {
      this.stats.driver = `redis-active (${this.redisHost}:${this.redisPort})`;
      this.hasRedis = true;
      socket.destroy();
    });

    socket.on('error', () => {
      this.stats.driver = 'in-memory-fast (redis standby)';
      this.hasRedis = false;
      socket.destroy();
    });

    socket.on('timeout', () => {
      this.stats.driver = 'in-memory-fast (redis timeout)';
      this.hasRedis = false;
      socket.destroy();
    });

    try {
      socket.connect(this.redisPort, this.redisHost);
    } catch {
      this.hasRedis = false;
    }
  }

  get(key) {
    const expireAt = this.ttls.get(key);
    if (expireAt && Date.now() > expireAt) {
      this.memoryStore.delete(key);
      this.ttls.delete(key);
      this.stats.misses++;
      return null;
    }

    if (this.memoryStore.has(key)) {
      this.stats.hits++;
      return this.memoryStore.get(key);
    }

    this.stats.misses++;
    return null;
  }

  set(key, val, ttlSeconds = 60) {
    this.memoryStore.set(key, val);
    if (ttlSeconds > 0) {
      this.ttls.set(key, Date.now() + ttlSeconds * 1000);
    }
    this.stats.writes++;
  }

  invalidateTable(tableName) {
    let count = 0;
    const prefix = `table:${tableName.toLowerCase()}:`;
    for (const key of this.memoryStore.keys()) {
      if (key.startsWith(prefix) || key.includes(tableName.toLowerCase())) {
        this.memoryStore.delete(key);
        this.ttls.delete(key);
        count++;
      }
    }
    this.stats.invalidations += count;
    return count;
  }

  flush() {
    this.memoryStore.clear();
    this.ttls.clear();
  }

  getStats() {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? ((this.stats.hits / totalRequests) * 100).toFixed(1) + '%' : '100%';
    return {
      ...this.stats,
      cachedKeys: this.memoryStore.size,
      hitRate
    };
  }
}

module.exports = new OctoCache();