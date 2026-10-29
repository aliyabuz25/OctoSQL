const fs = require('fs');
const path = require('path');
const { encrypt, decrypt, checksum, uuid } = require('./crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const MAGIC_HEADER = 'OCTOSQL_V1';

// Supported Variable / Column Types
const SUPPORTED_TYPES = [
  'INT', 'INTEGER',
  'FLOAT', 'DECIMAL', 'NUMBER',
  'TEXT', 'VARCHAR', 'STRING',
  'BOOLEAN', 'BOOL',
  'JSON',
  'DATETIME', 'TIMESTAMP',
  'UUID'
];

class OctoStorageEngine {
  constructor(dataDir = DATA_DIR) {
    this.dataDir = dataDir;
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.tables = new Map(); // in-memory table metadata and records
    this.init();
  }

  init() {
    // Scan data directory for existing .osql and .owal files
    const files = fs.readdirSync(this.dataDir);
    const osqlFiles = files.filter(f => f.endsWith('.osql'));

    for (const file of osqlFiles) {
      const tableName = file.replace('.osql', '');
      this.loadTable(tableName);
    }
  }

  getTableFilePath(tableName) {
    return path.join(this.dataDir, `${tableName.toLowerCase()}.osql`);
  }

  getWalFilePath(tableName) {
    return path.join(this.dataDir, `${tableName.toLowerCase()}.owal`);
  }

  loadTable(tableName) {
    const filePath = this.getTableFilePath(tableName);
    const walPath = this.getWalFilePath(tableName);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const lines = raw.split('\n');
      if (lines[0] !== MAGIC_HEADER) {
        throw new Error(`Invalid file magic header for table ${tableName}`);
      }

      // Line 1: Header metadata (JSON)
      const meta = JSON.parse(lines[1]);
      // Line 2: Encrypted payload containing records
      const encryptedPayload = lines.slice(2).join('\n');
      const records = encryptedPayload.trim() ? decrypt(encryptedPayload, true) : [];

      const tableData = {
        name: meta.name,
        schema: meta.schema,
        primaryKey: meta.primaryKey || 'id',
        autoIncrement: meta.autoIncrement || 1,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        records: Array.isArray(records) ? records : []
      };

      this.tables.set(tableName.toLowerCase(), tableData);

      // Check if WAL exists and recover if needed
      if (fs.existsSync(walPath)) {
        this.recoverFromWal(tableName);
      }

      return tableData;
    } catch (err) {
      console.error(`Failed to load table ${tableName}:`, err.message);
      return null;
    }
  }

  recoverFromWal(tableName) {
    const walPath = this.getWalFilePath(tableName);
    try {
      const walRaw = fs.readFileSync(walPath, 'utf8');
      const entries = walRaw.trim().split('\n').filter(Boolean).map(JSON.parse);
      const table = this.tables.get(tableName.toLowerCase());
      if (!table) return;

      for (const op of entries) {
        if (op.action === 'INSERT') {
          table.records.push(op.record);
        } else if (op.action === 'UPDATE') {
          const idx = table.records.findIndex(r => r[table.primaryKey] == op.pk);
          if (idx !== -1) table.records[idx] = { ...table.records[idx], ...op.updates };
        } else if (op.action === 'DELETE') {
          table.records = table.records.filter(r => r[table.primaryKey] != op.pk);
        }
      }

      // Persist recovered state and remove WAL
      this.persistTable(tableName);
      fs.unlinkSync(walPath);
      console.log(`[OctoSQL] Auto-recovered table ${tableName} from WAL successfully.`);
    } catch (err) {
      console.error(`WAL recovery error for ${tableName}:`, err.message);
    }
  }

  persistTable(tableName) {
    const table = this.tables.get(tableName.toLowerCase());
    if (!table) throw new Error(`Table ${tableName} not found in memory`);

    const filePath = this.getTableFilePath(tableName);
    const meta = {
      name: table.name,
      schema: table.schema,
      primaryKey: table.primaryKey,
      autoIncrement: table.autoIncrement,
      createdAt: table.createdAt,
      updatedAt: new Date().toISOString()
    };

    const encryptedData = encrypt(table.records);
    const fileContent = `${MAGIC_HEADER}\n${JSON.stringify(meta)}\n${encryptedData}`;

    // Write file atomically via temp file
    const tempPath = filePath + '.tmp';
    fs.writeFileSync(tempPath, fileContent, 'utf8');
    fs.renameSync(tempPath, filePath);
  }

  appendWal(tableName, operation) {
    const walPath = this.getWalFilePath(tableName);
    const line = JSON.stringify({ ...operation, timestamp: Date.now() }) + '\n';
    fs.appendFileSync(walPath, line, 'utf8');
  }

  clearWal(tableName) {
    const walPath = this.getWalFilePath(tableName);
    if (fs.existsSync(walPath)) {
      try {
        fs.unlinkSync(walPath);
      } catch {}
    }
  }

  createTable(name, schemaColumns, primaryKey = 'id') {
    const cleanName = name.toLowerCase().trim();
    if (this.tables.has(cleanName)) {
      throw new Error(`Table '${name}' already exists.`);
    }

    // Validate and normalize schema
    const schema = {};
    for (const [colName, colType] of Object.entries(schemaColumns)) {
      const upperType = colType.toUpperCase();
      schema[colName] = upperType;
    }

    if (!schema[primaryKey]) {
      schema[primaryKey] = 'INTEGER';
    }

    const tableData = {
      name,
      schema,
      primaryKey,
      autoIncrement: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      records: []
    };

    this.tables.set(cleanName, tableData);
    this.persistTable(name);
    return tableData;
  }

  dropTable(name) {
    const cleanName = name.toLowerCase().trim();
    if (!this.tables.has(cleanName)) {
      throw new Error(`Table '${name}' does not exist.`);
    }

    this.tables.delete(cleanName);
    const filePath = this.getTableFilePath(cleanName);
    const walPath = this.getWalFilePath(cleanName);

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    return true;
  }

  getTable(name) {
    return this.tables.get(name.toLowerCase().trim()) || null;
  }

  listTables() {
    const result = [];
    for (const [key, tbl] of this.tables.entries()) {
      const filePath = this.getTableFilePath(key);
      let sizeBytes = 0;
      if (fs.existsSync(filePath)) {
        sizeBytes = fs.statSync(filePath).size;
      }

      result.push({
        name: tbl.name,
        rows: tbl.records.length,
        primaryKey: tbl.primaryKey,
        columns: Object.keys(tbl.schema),
        schema: tbl.schema,
        sizeBytes,
        updatedAt: tbl.updatedAt
      });
    }
    return result;
  }

  castValue(val, type) {
    if (val === null || val === undefined) return null;
    const t = (type || 'TEXT').toUpperCase();

    if (t === 'INT' || t === 'INTEGER') {
      const parsed = parseInt(val, 10);
      return isNaN(parsed) ? 0 : parsed;
    }
    if (t === 'FLOAT' || t === 'DECIMAL' || t === 'NUMBER') {
      const parsed = parseFloat(val);
      return isNaN(parsed) ? 0.0 : parsed;
    }
    if (t === 'BOOLEAN' || t === 'BOOL') {
      return (val === true || val === 'true' || val === 1 || val === '1');
    }
    if (t === 'JSON') {
      if (typeof val === 'object') return val;
      try {
        return JSON.parse(val);
      } catch {
        return {};
      }
    }
    if (t === 'DATETIME' || t === 'TIMESTAMP') {
      try {
        return new Date(val).toISOString();
      } catch {
        return new Date().toISOString();
      }
    }
    if (t === 'UUID') {
      return val ? String(val) : uuid();
    }
    return String(val);
  }
}

module.exports = {
  OctoStorageEngine,
  SUPPORTED_TYPES
};