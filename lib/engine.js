const { OctoStorageEngine, SUPPORTED_TYPES } = require('./storage');
const cache = require('./cache');
const { uuid } = require('./crypto');

function splitRespectingQuotes(str, delimiter = ',') {
  const result = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const prev = i > 0 ? str[i - 1] : null;

    if (ch === "'" && prev !== '\\') {
      if (!inDoubleQuote) inSingleQuote = !inSingleQuote;
      current += ch;
    } else if (ch === '"' && prev !== '\\') {
      if (!inSingleQuote) inDoubleQuote = !inDoubleQuote;
      current += ch;
    } else if (!inSingleQuote && !inDoubleQuote) {
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
      else if (ch === '[') bracketDepth++;
      else if (ch === ']') bracketDepth--;

      if (ch === delimiter && braceDepth === 0 && bracketDepth === 0) {
        result.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) {
    result.push(current.trim());
  }
  return result;
}

function interpolateParams(query, params) {
  if (!params) return query;

  const formatVal = (val) => {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number') return String(val);
    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
    if (typeof val === 'object') {
      const json = JSON.stringify(val).replace(/'/g, "''");
      return `'${json}'`;
    }
    const str = String(val).replace(/'/g, "''");
    return `'${str}'`;
  };

  if (Array.isArray(params)) {
    if (params.length === 0) return query;
    // 1. Positional ? placeholders
    let paramIdx = 0;
    let res = query.replace(/\?/g, () => {
      if (paramIdx < params.length) {
        return formatVal(params[paramIdx++]);
      }
      return '?';
    });

    // 2. Indexed $1, $2, ... placeholders
    res = res.replace(/\$(\d+)/g, (match, num) => {
      const idx = parseInt(num, 10) - 1;
      if (idx >= 0 && idx < params.length) {
        return formatVal(params[idx]);
      }
      return match;
    });

    return res;
  }

  if (typeof params === 'object') {
    let res = query;
    for (const [key, val] of Object.entries(params)) {
      const regex = new RegExp(`:${key}\\b`, 'g');
      res = res.replace(regex, formatVal(val));
    }
    return res;
  }

  return query;
}

class OctoEngine {
  constructor(storage = new OctoStorageEngine()) {
    this.storage = storage;
  }

  /**
   * Universal entry point: executes either standard SQL or OctoSQLX query
   */
  async execute(queryStr, params = {}) {
    const start = process.hrtime();
    let query = (queryStr || '').trim();

    if (!query) {
      throw new Error('Empty query provided.');
    }

    // Safely bind parameters if provided
    query = interpolateParams(query, params);

    let result;
    const isOctoX = this.isOctoSqlx(query);

    if (isOctoX) {
      result = await this.executeOctoSqlx(query, params);
    } else {
      result = await this.executeSql(query, params);
    }

    const diff = process.hrtime(start);
    const executionTimeMs = (diff[0] * 1000 + diff[1] / 1e6).toFixed(2);

    return {
      ...result,
      dialect: isOctoX ? 'octosqlx' : 'ansi-sql',
      executionTimeMs: parseFloat(executionTimeMs)
    };
  }

  isOctoSqlx(q) {
    const upper = q.toUpperCase();
    return (
      upper.startsWith('FETCH ') ||
      upper.startsWith('STORE ') ||
      upper.startsWith('MUTATE ') ||
      upper.startsWith('PURGE ') ||
      upper.startsWith('SPAWN ') ||
      upper.startsWith('INSPECT ') ||
      upper.startsWith('ERASE ')
    );
  }

  // --- SQL Execution Engine ---
  async executeSql(query, params) {
    const q = query.trim().replace(/;+$/, '');
    const upper = q.toUpperCase();

    // Transactions
    if (upper === 'BEGIN' || upper === 'BEGIN TRANSACTION' || upper === 'START TRANSACTION') {
      return { command: 'BEGIN', message: 'Transaction started.' };
    } else if (upper === 'COMMIT' || upper === 'COMMIT TRANSACTION') {
      return { command: 'COMMIT', message: 'Transaction committed.' };
    } else if (upper === 'ROLLBACK' || upper === 'ROLLBACK TRANSACTION') {
      return { command: 'ROLLBACK', message: 'Transaction rolled back.' };
    } else if (upper.startsWith('SELECT')) {
      return this.handleSelect(q, params);
    } else if (upper.startsWith('INSERT INTO')) {
      return this.handleInsert(q, params);
    } else if (upper.startsWith('UPDATE')) {
      return this.handleUpdate(q, params);
    } else if (upper.startsWith('DELETE FROM')) {
      return this.handleDelete(q, params);
    } else if (upper.startsWith('CREATE TABLE')) {
      return this.handleCreateTable(q);
    } else if (upper.startsWith('DROP TABLE')) {
      return this.handleDropTable(q);
    } else if (upper.startsWith('SHOW TABLES')) {
      return this.handleShowTables();
    } else if (upper.startsWith('DESCRIBE') || upper.startsWith('DESC ')) {
      return this.handleDescribe(q);
    } else if (upper.startsWith('TRUNCATE')) {
      return this.handleTruncate(q);
    } else {
      throw new Error(`Unsupported SQL statement: "${query.substring(0, 30)}..."`);
    }
  }

  // --- OctoSQLX Execution Engine ---
  async executeOctoSqlx(query, params) {
    const q = query.trim().replace(/;+$/, '');
    const upper = q.toUpperCase();

    if (upper.startsWith('FETCH')) {
      // FETCH [cols] FROM <table> [FILTER cond] [SORT col [ASC|DESC]] [RANGE limit] [SKIP offset]
      return this.handleOctoFetch(q, params);
    } else if (upper.startsWith('STORE')) {
      // STORE IN <table> OBJECT {...} or STORE IN <table> (cols) VALUES (vals)
      return this.handleOctoStore(q, params);
    } else if (upper.startsWith('MUTATE')) {
      // MUTATE <table> SET col=val [FILTER cond]
      return this.handleOctoMutate(q, params);
    } else if (upper.startsWith('PURGE')) {
      // PURGE FROM <table> [FILTER cond]
      return this.handleOctoPurge(q, params);
    } else if (upper.startsWith('SPAWN TABLE')) {
      // SPAWN TABLE <table> WITH (col TYPE, ...)
      return this.handleOctoSpawn(q);
    } else if (upper.startsWith('INSPECT')) {
      // INSPECT <table>
      const tableName = q.split(/\s+/)[1];
      return this.handleDescribe(`DESCRIBE ${tableName}`);
    } else if (upper.startsWith('ERASE TABLE')) {
      // ERASE TABLE <table>
      const tableName = q.split(/\s+/)[2];
      return this.handleDropTable(`DROP TABLE ${tableName}`);
    } else {
      throw new Error(`Unsupported OctoSQLX statement: "${query.substring(0, 30)}..."`);
    }
  }

  // --- Handlers ---
  handleShowTables() {
    const tables = this.storage.listTables();
    return {
      command: 'SHOW TABLES',
      rows: tables.map(t => ({ table_name: t.name, rows: t.rows, size_bytes: t.sizeBytes })),
      rowCount: tables.length
    };
  }

  handleDescribe(query) {
    const parts = query.trim().split(/\s+/);
    const tableName = parts[1];
    const table = this.storage.getTable(tableName);
    if (!table) throw new Error(`Table '${tableName}' not found.`);

    const rows = Object.entries(table.schema).map(([col, type]) => ({
      column_name: col,
      data_type: type,
      primary_key: col === table.primaryKey
    }));

    return {
      command: 'DESCRIBE',
      table: tableName,
      rows,
      rowCount: rows.length
    };
  }

  handleCreateTable(query) {
    // CREATE TABLE [IF NOT EXISTS] <table> (<columns>)
    const match = query.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s*\(([\s\S]+)\)/i);
    if (!match) throw new Error('Syntax error in CREATE TABLE statement.');

    const tableName = match[1];
    const columnsDef = match[2];

    const ifNotExists = /IF\s+NOT\s+EXISTS/i.test(query);
    if (ifNotExists && this.storage.getTable(tableName)) {
      return { command: 'CREATE TABLE', message: `Table '${tableName}' already exists (skipped).` };
    }

    const schema = {};
    let primaryKey = 'id';

    const colParts = columnsDef.split(',').map(s => s.trim()).filter(Boolean);
    for (const part of colParts) {
      const tokens = part.trim().split(/\s+/);
      const colName = tokens[0];
      const colType = tokens[1] || 'TEXT';

      schema[colName] = colType;
      if (part.toUpperCase().includes('PRIMARY KEY')) {
        primaryKey = colName;
      }
    }

    this.storage.createTable(tableName, schema, primaryKey);
    return {
      command: 'CREATE TABLE',
      table: tableName,
      columns: Object.keys(schema),
      primaryKey,
      message: `Table '${tableName}' created successfully.`
    };
  }

  handleDropTable(query) {
    const match = query.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_]+)/i);
    if (!match) throw new Error('Syntax error in DROP TABLE statement.');

    const tableName = match[1];
    const ifExists = /IF\s+EXISTS/i.test(query);

    if (!this.storage.getTable(tableName)) {
      if (ifExists) return { command: 'DROP TABLE', message: `Table '${tableName}' does not exist (skipped).` };
      throw new Error(`Table '${tableName}' does not exist.`);
    }

    this.storage.dropTable(tableName);
    cache.invalidateTable(tableName);
    return { command: 'DROP TABLE', table: tableName, message: `Table '${tableName}' dropped.` };
  }

  handleTruncate(query) {
    const match = query.match(/TRUNCATE\s+(?:TABLE\s+)?([a-zA-Z0-9_]+)/i);
    if (!match) throw new Error('Syntax error in TRUNCATE statement.');
    const tableName = match[1];
    const table = this.storage.getTable(tableName);
    if (!table) throw new Error(`Table '${tableName}' not found.`);

    table.records = [];
    table.autoIncrement = 1;
    this.storage.persistTable(tableName);
    cache.invalidateTable(tableName);

    return { command: 'TRUNCATE', table: tableName, message: `Table '${tableName}' truncated.` };
  }

  handleSelect(query, params) {
    // Check Cache
    const cacheKey = `sql:${query}:${JSON.stringify(params || {})}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return { ...cached, fromCache: true };
    }

    const selectRegex = /SELECT\s+([\s\S]+?)\s+FROM\s+([a-zA-Z0-9_]+)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+ORDER\s+BY\s+([a-zA-Z0-9_]+(?:\s+(?:ASC|DESC))?))?(?:\s+LIMIT\s+(\d+))?(?:\s+OFFSET\s+(\d+))?$/i;
    const match = query.match(selectRegex);

    if (!match) {
      throw new Error(`Syntax error or complex unsupported subquery in SELECT: "${query}"`);
    }

    const colsStr = match[1].trim();
    const tableName = match[2].trim();
    const whereClause = match[3] ? match[3].trim() : null;
    const orderByClause = match[4] ? match[4].trim() : null;
    const limit = match[5] ? parseInt(match[5], 10) : null;
    const offset = match[6] ? parseInt(match[6], 10) : 0;

    const table = this.storage.getTable(tableName);
    if (!table) throw new Error(`Table '${tableName}' does not exist.`);

    let filtered = [...table.records];

    // Filter by WHERE
    if (whereClause) {
      filtered = filtered.filter(row => this.evaluateCondition(whereClause, row, params));
    }

    // Sort by ORDER BY
    if (orderByClause) {
      const [col, direction] = orderByClause.split(/\s+/);
      const isDesc = (direction || '').toUpperCase() === 'DESC';
      filtered.sort((a, b) => {
        const valA = a[col];
        const valB = b[col];
        if (valA < valB) return isDesc ? 1 : -1;
        if (valA > valB) return isDesc ? -1 : 1;
        return 0;
      });
    }

    // Apply OFFSET and LIMIT
    if (offset > 0) {
      filtered = filtered.slice(offset);
    }
    if (limit !== null) {
      filtered = filtered.slice(0, limit);
    }

    // Project columns
    let rows = filtered;
    if (colsStr !== '*') {
      const cols = colsStr.split(',').map(c => c.trim());
      rows = filtered.map(row => {
        const projected = {};
        for (const col of cols) {
          projected[col] = row[col];
        }
        return projected;
      });
    }

    const result = {
      command: 'SELECT',
      table: tableName,
      rows,
      rowCount: rows.length
    };

    cache.set(cacheKey, result, 30);
    return result;
  }

  handleInsert(query, params) {
    // INSERT INTO <table> (<cols>) VALUES (<vals>)
    const match = query.match(/INSERT\s+INTO\s+([a-zA-Z0-9_]+)\s*\(([\s\S]+?)\)\s*VALUES\s*\(([\s\S]+?)\)/i);
    if (!match) throw new Error('Syntax error in INSERT INTO statement.');

    const tableName = match[1];
    const cols = splitRespectingQuotes(match[2]);
    const rawVals = splitRespectingQuotes(match[3]);

    const table = this.storage.getTable(tableName);
    if (!table) throw new Error(`Table '${tableName}' not found.`);

    const record = {};
    for (let i = 0; i < cols.length; i++) {
      const colName = cols[i];
      let val = rawVals[i];

      // Parse string literal quotes or numbers
      if (val && ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"')))) {
        val = val.substring(1, val.length - 1).replace(/''/g, "'");
      } else if (val === 'true' || val === 'TRUE') {
        val = true;
      } else if (val === 'false' || val === 'FALSE') {
        val = false;
      } else if (val === 'null' || val === 'NULL') {
        val = null;
      }

      const colType = table.schema[colName] || 'TEXT';
      record[colName] = this.storage.castValue(val, colType);
    }

    // Assign primary key if missing and autoIncrement
    if (table.primaryKey && !record[table.primaryKey]) {
      const pkType = table.schema[table.primaryKey];
      if (pkType === 'UUID') {
        record[table.primaryKey] = uuid();
      } else {
        record[table.primaryKey] = table.autoIncrement++;
      }
    }

    this.storage.appendWal(tableName, { action: 'INSERT', record });
    table.records.push(record);
    this.storage.persistTable(tableName);
    this.storage.clearWal(tableName);

    cache.invalidateTable(tableName);

    return {
      command: 'INSERT',
      table: tableName,
      insertedId: record[table.primaryKey],
      affectedRows: 1,
      record
    };
  }

  handleUpdate(query, params) {
    // UPDATE <table> SET <assignments> [WHERE <condition>]
    const match = query.match(/UPDATE\s+([a-zA-Z0-9_]+)\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+))?$/i);
    if (!match) throw new Error('Syntax error in UPDATE statement.');

    const tableName = match[1];
    const setClause = match[2];
    const whereClause = match[3] ? match[3].trim() : null;

    const table = this.storage.getTable(tableName);
    if (!table) throw new Error(`Table '${tableName}' not found.`);

    // Parse SET pairs: col1 = val1, col2 = val2
    const updates = {};
    const pairs = splitRespectingQuotes(setClause);
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) continue;
      const col = pair.substring(0, eqIdx).trim();
      let val = pair.substring(eqIdx + 1).trim();

      if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
        val = val.substring(1, val.length - 1).replace(/''/g, "'");
      } else if (val === 'true' || val === 'TRUE') val = true;
      else if (val === 'false' || val === 'FALSE') val = false;
      else if (val === 'null' || val === 'NULL') val = null;

      const colType = table.schema[col] || 'TEXT';
      updates[col] = this.storage.castValue(val, colType);
    }

    let affectedRows = 0;
    for (let i = 0; i < table.records.length; i++) {
      const row = table.records[i];
      if (!whereClause || this.evaluateCondition(whereClause, row, params)) {
        table.records[i] = { ...row, ...updates };
        affectedRows++;
      }
    }

    if (affectedRows > 0) {
      this.storage.appendWal(tableName, { action: 'UPDATE', updates });
      this.storage.persistTable(tableName);
      this.storage.clearWal(tableName);
      cache.invalidateTable(tableName);
    }

    return { command: 'UPDATE', table: tableName, affectedRows };
  }

  handleDelete(query, params) {
    const match = query.match(/DELETE\s+FROM\s+([a-zA-Z0-9_]+)(?:\s+WHERE\s+([\s\S]+))?$/i);
    if (!match) throw new Error('Syntax error in DELETE statement.');

    const tableName = match[1];
    const whereClause = match[2] ? match[2].trim() : null;

    const table = this.storage.getTable(tableName);
    if (!table) throw new Error(`Table '${tableName}' not found.`);

    const initialCount = table.records.length;
    table.records = table.records.filter(row => {
      if (!whereClause) return false; // delete all if no where
      return !this.evaluateCondition(whereClause, row, params);
    });

    const affectedRows = initialCount - table.records.length;
    if (affectedRows > 0) {
      this.storage.persistTable(tableName);
      cache.invalidateTable(tableName);
    }

    return { command: 'DELETE', table: tableName, affectedRows };
  }

  // --- OctoSQLX Handlers ---
  handleOctoFetch(query, params) {
    // FETCH [cols] FROM <table> [FILTER cond] [SORT col [ASC|DESC]] [RANGE limit] [SKIP offset]
    const regex = /FETCH\s+([\s\S]+?)\s+FROM\s+([a-zA-Z0-9_]+)(?:\s+FILTER\s+([\s\S]+?))?(?:\s+SORT\s+([a-zA-Z0-9_]+(?:\s+(?:ASC|DESC))?))?(?:\s+RANGE\s+(\d+))?(?:\s+SKIP\s+(\d+))?$/i;
    const match = query.match(regex);
    if (!match) throw new Error(`Syntax error in OctoSQLX FETCH statement: "${query}"`);

    const colsStr = match[1].trim();
    const tableName = match[2].trim();
    const filterClause = match[3] ? match[3].trim() : null;
    const sortClause = match[4] ? match[4].trim() : null;
    const range = match[5] ? parseInt(match[5], 10) : null;
    const skip = match[6] ? parseInt(match[6], 10) : 0;

    let sql = `SELECT ${colsStr} FROM ${tableName}`;
    if (filterClause) sql += ` WHERE ${filterClause}`;
    if (sortClause) sql += ` ORDER BY ${sortClause}`;
    if (range !== null) sql += ` LIMIT ${range}`;
    if (skip > 0) sql += ` OFFSET ${skip}`;

    return this.handleSelect(sql, params);
  }

  handleOctoStore(query, params) {
    // Supports STORE IN <table> OBJECT { "title": "Home", "slug": "/" }
    const objectMatch = query.match(/STORE\s+IN\s+([a-zA-Z0-9_]+)\s+OBJECT\s+([\s\S]+)/i);
    if (objectMatch) {
      const tableName = objectMatch[1];
      const rawJson = objectMatch[2].trim();
      let obj;
      try {
        obj = JSON.parse(rawJson);
      } catch (err) {
        throw new Error(`Invalid JSON in STORE OBJECT: ${err.message}`);
      }

      const table = this.storage.getTable(tableName);
      if (!table) throw new Error(`Table '${tableName}' not found.`);

      const record = {};
      for (const [col, val] of Object.entries(obj)) {
        const colType = table.schema[col] || 'TEXT';
        record[col] = this.storage.castValue(val, colType);
      }

      if (table.primaryKey && !record[table.primaryKey]) {
        record[table.primaryKey] = (table.schema[table.primaryKey] === 'UUID') ? uuid() : table.autoIncrement++;
      }

      table.records.push(record);
      this.storage.persistTable(tableName);
      cache.invalidateTable(tableName);

      return {
        command: 'STORE OBJECT',
        table: tableName,
        insertedId: record[table.primaryKey],
        affectedRows: 1,
        record
      };
    }

    // Standard column-values format
    const stdMatch = query.match(/STORE\s+IN\s+([a-zA-Z0-9_]+)\s*\(([\s\S]+?)\)\s*VALUES\s*\(([\s\S]+?)\)/i);
    if (stdMatch) {
      const sql = `INSERT INTO ${stdMatch[1]} (${stdMatch[2]}) VALUES (${stdMatch[3]})`;
      return this.handleInsert(sql, params);
    }

    throw new Error('Syntax error in OctoSQLX STORE statement.');
  }

  handleOctoMutate(query, params) {
    // MUTATE <table> SET col=val [FILTER cond]
    const match = query.match(/MUTATE\s+([a-zA-Z0-9_]+)\s+SET\s+([\s\S]+?)(?:\s+FILTER\s+([\s\S]+))?$/i);
    if (!match) throw new Error('Syntax error in OctoSQLX MUTATE statement.');

    const tableName = match[1];
    const setClause = match[2];
    const filterClause = match[3] ? match[3].trim() : null;

    let sql = `UPDATE ${tableName} SET ${setClause}`;
    if (filterClause) sql += ` WHERE ${filterClause}`;
    return this.handleUpdate(sql, params);
  }

  handleOctoPurge(query, params) {
    // PURGE FROM <table> [FILTER cond]
    const match = query.match(/PURGE\s+FROM\s+([a-zA-Z0-9_]+)(?:\s+FILTER\s+([\s\S]+))?$/i);
    if (!match) throw new Error('Syntax error in OctoSQLX PURGE statement.');

    const tableName = match[1];
    const filterClause = match[2] ? match[2].trim() : null;

    let sql = `DELETE FROM ${tableName}`;
    if (filterClause) sql += ` WHERE ${filterClause}`;
    return this.handleDelete(sql, params);
  }

  handleOctoSpawn(query) {
    // SPAWN TABLE <table> WITH (col TYPE, ...)
    const match = query.match(/SPAWN\s+TABLE\s+([a-zA-Z0-9_]+)\s+WITH\s*\(([\s\S]+)\)/i);
    if (!match) throw new Error('Syntax error in OctoSQLX SPAWN TABLE statement.');

    const sql = `CREATE TABLE ${match[1]} (${match[2]})`;
    return this.handleCreateTable(sql);
  }

  evaluateCondition(conditionStr, row, params) {
    // Handles AND, OR, =, !=, >, <, >=, <=, LIKE
    const cond = conditionStr.trim();
    if (cond.toUpperCase() === '1=1' || cond === '1') return true;

    // Split on AND
    if (cond.toUpperCase().includes(' AND ')) {
      const parts = cond.split(/\s+AND\s+/i);
      return parts.every(part => this.evaluateCondition(part, row, params));
    }

    // Split on OR
    if (cond.toUpperCase().includes(' OR ')) {
      const parts = cond.split(/\s+OR\s+/i);
      return parts.some(part => this.evaluateCondition(part, row, params));
    }

    // Check single operator
    const ops = ['!=', '<=', '>=', '=', '<', '>', ' LIKE '];
    for (const op of ops) {
      const idx = cond.toUpperCase().indexOf(op);
      if (idx !== -1) {
        const leftCol = cond.substring(0, idx).trim();
        let rightVal = cond.substring(idx + op.length).trim();

        // Parameter substitution
        if (rightVal.startsWith(':') && params && params[rightVal.substring(1)] !== undefined) {
          rightVal = params[rightVal.substring(1)];
        } else if ((rightVal.startsWith("'") && rightVal.endsWith("'")) || (rightVal.startsWith('"') && rightVal.endsWith('"'))) {
          rightVal = rightVal.substring(1, rightVal.length - 1);
        } else if (rightVal === 'true' || rightVal === 'TRUE') rightVal = true;
        else if (rightVal === 'false' || rightVal === 'FALSE') rightVal = false;
        else if (rightVal === 'null' || rightVal === 'NULL') rightVal = null;
        else if (!isNaN(Number(rightVal))) rightVal = Number(rightVal);

        const rowVal = row[leftCol];

        if (op === '=') return rowVal == rightVal;
        if (op === '!=') return rowVal != rightVal;
        if (op === '>') return rowVal > rightVal;
        if (op === '<') return rowVal < rightVal;
        if (op === '>=') return rowVal >= rightVal;
        if (op === '<=') return rowVal <= rightVal;
        if (op === ' LIKE ') {
          const regexStr = String(rightVal).replace(/%/g, '.*').replace(/_/g, '.');
          return new RegExp(`^${regexStr}$`, 'i').test(String(rowVal));
        }
      }
    }

    return true;
  }
}

module.exports = {
  OctoEngine
};