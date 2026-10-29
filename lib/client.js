const http = require('http');
const { URL } = require('url');

/**
 * Parse Connection URI (e.g. octosql://root:secret@127.0.0.1:8421/octosql_db)
 */
function parseConnectionUri(uri) {
  if (typeof uri !== 'string') return uri;
  try {
    const parsed = new URL(uri.replace(/^octosql:\/\//, 'http://'));
    return {
      host: parsed.hostname || '127.0.0.1',
      port: parseInt(parsed.port, 10) || 8421,
      user: parsed.username || 'root',
      password: parsed.password || '',
      database: parsed.pathname ? parsed.pathname.replace(/^\//, '') : 'octosql_db'
    };
  } catch {
    return { host: '127.0.0.1', port: 8421, database: 'octosql_db' };
  }
}

/**
 * Standard SQL-Style Result Wrapper
 * Compatible with both `const [rows, fields] = await conn.query(...)` and `const res = await conn.query(...)`
 */
function wrapResult(raw) {
  const rows = raw.rows || (raw.record ? [raw.record] : []);
  
  // Attach metadata properties to rows array
  rows.command = raw.command;
  rows.affectedRows = raw.affectedRows || 0;
  rows.insertId = raw.insertedId || null;
  rows.rowCount = rows.length;
  rows.executionTimeMs = raw.executionTimeMs || 0.1;
  rows.dialect = raw.dialect || 'ansi-sql';
  rows.fromCache = !!raw.fromCache;

  const fields = (rows.length > 0)
    ? Object.keys(rows[0]).map(col => ({ name: col, table: raw.table || '' }))
    : [];

  const tuple = [rows, fields];
  
  // Also expose properties directly on tuple
  tuple.rows = rows;
  tuple.fields = fields;
  tuple.command = raw.command;
  tuple.affectedRows = raw.affectedRows || 0;
  tuple.insertId = raw.insertedId || null;
  tuple.rowCount = rows.length;
  tuple.executionTimeMs = raw.executionTimeMs || 0.1;

  return tuple;
}

/**
 * OctoConnection: Single Database Connection (Analogous to mysql2/Connection or pg/Client)
 */
class OctoConnection {
  constructor(config = {}) {
    const opts = (typeof config === 'string') ? parseConnectionUri(config) : config;
    this.host = opts.host || '127.0.0.1';
    this.port = opts.port || 8421;
    this.user = opts.user || 'root';
    this.password = opts.password || '';
    this.database = opts.database || 'octosql_db';
    this.token = opts.token || process.env.OCTOSQL_API_TOKEN || 'octosql-secret-daemon-token';
    this.inTransaction = false;
    this.connected = false;
  }

  /**
   * Connect / Handshake (Promise or Callback)
   */
  connect(callback) {
    const promise = this.ping().then(() => {
      this.connected = true;
      return this;
    });

    if (typeof callback === 'function') {
      promise.then(res => callback(null, res)).catch(err => callback(err));
      return;
    }
    return promise;
  }

  /**
   * Ping server
   */
  ping(callback) {
    const start = Date.now();
    const promise = this._http('/api/status', {}, 'GET').then(status => {
      return { ok: true, latencyMs: Date.now() - start, status };
    });

    if (typeof callback === 'function') {
      promise.then(res => callback(null, res)).catch(err => callback(err));
      return;
    }
    return promise;
  }

  /**
   * Standard SQL query method: conn.query(sql, [values], [callback])
   */
  query(sql, values, callback) {
    if (typeof values === 'function') {
      callback = values;
      values = [];
    }

    const promise = this._http('/api/query', { query: sql, params: values || [] }).then(wrapResult);

    if (typeof callback === 'function') {
      promise.then(tuple => callback(null, tuple[0], tuple[1])).catch(err => callback(err));
      return;
    }
    return promise;
  }

  /**
   * Prepared Statement execution: conn.execute(sql, [values], [callback])
   */
  execute(sql, values, callback) {
    return this.query(sql, values, callback);
  }

  /**
   * OctoSQLX Dialect query: conn.octo(sqlx, [values], [callback])
   */
  octo(sqlx, values, callback) {
    return this.query(sqlx, values, callback);
  }

  /**
   * Transactions
   */
  async beginTransaction(callback) {
    this.inTransaction = true;
    return this.query('BEGIN', [], callback);
  }

  async commit(callback) {
    this.inTransaction = false;
    return this.query('COMMIT', [], callback);
  }

  async rollback(callback) {
    this.inTransaction = false;
    return this.query('ROLLBACK', [], callback);
  }

  /**
   * Release connection (for pooled connection)
   */
  release() {
    // In connection pool, marks connection as free
    if (this._pool) {
      this._pool._releaseConnection(this);
    }
  }

  /**
   * Close connection
   */
  end(callback) {
    this.connected = false;
    if (typeof callback === 'function') callback(null);
    return Promise.resolve();
  }

  close(callback) {
    return this.end(callback);
  }

  // HTTP Transport Layer
  _http(endpoint, payload = {}, method = 'POST') {
    return new Promise((resolve, reject) => {
      const dataString = JSON.stringify(payload);
      const options = {
        hostname: this.host,
        port: this.port,
        path: endpoint,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
          'X-Client': 'octosql-node-driver',
          'X-Database': this.database
        }
      };

      if (method === 'POST') {
        options.headers['Content-Length'] = Buffer.byteLength(dataString);
      }

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (res.statusCode >= 400) {
              const err = new Error(parsed.error || `HTTP ${res.statusCode}`);
              err.code = parsed.code || 'OCTOSQL_ERROR';
              err.statusCode = res.statusCode;
              return reject(err);
            }
            resolve(parsed);
          } catch (e) {
            if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${body}`));
            resolve(body);
          }
        });
      });

      req.on('error', (err) => {
        const connErr = new Error(`OctoSQL Connection Error to ${this.host}:${this.port} - ${err.message}`);
        connErr.code = 'ECONNREFUSED';
        reject(connErr);
      });

      if (method === 'POST') {
        req.write(dataString);
      }
      req.end();
    });
  }
}

/**
 * OctoPool: Connection Pool (Analogous to mysql2.createPool or pg.Pool)
 */
class OctoPool {
  constructor(config = {}) {
    const opts = (typeof config === 'string') ? parseConnectionUri(config) : config;
    this.config = opts;
    this.connectionLimit = opts.connectionLimit || 10;
    this._connections = [];
    this._available = [];
  }

  async getConnection(callback) {
    let conn;
    if (this._available.length > 0) {
      conn = this._available.pop();
    } else {
      conn = new OctoConnection(this.config);
      conn._pool = this;
      this._connections.push(conn);
    }

    const promise = Promise.resolve(conn);
    if (typeof callback === 'function') {
      promise.then(c => callback(null, c)).catch(err => callback(err));
      return;
    }
    return promise;
  }

  _releaseConnection(conn) {
    if (!this._available.includes(conn)) {
      this._available.push(conn);
    }
  }

  query(sql, values, callback) {
    if (typeof values === 'function') {
      callback = values;
      values = [];
    }
    const conn = new OctoConnection(this.config);
    return conn.query(sql, values, callback);
  }

  execute(sql, values, callback) {
    return this.query(sql, values, callback);
  }

  octo(sqlx, values, callback) {
    const conn = new OctoConnection(this.config);
    return conn.octo(sqlx, values, callback);
  }

  end(callback) {
    this._connections.forEach(c => c.end());
    this._connections = [];
    this._available = [];
    if (typeof callback === 'function') callback(null);
    return Promise.resolve();
  }
}

/**
 * Factory Methods (Standard SQL Driver API)
 */
function createConnection(config) {
  return new OctoConnection(config);
}

function createPool(config) {
  return new OctoPool(config);
}

module.exports = {
  createConnection,
  createPool,
  OctoConnection,
  OctoPool,
  parseConnectionUri
};