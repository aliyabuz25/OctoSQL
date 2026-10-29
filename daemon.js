const express = require('express');
const path = require('path');
const fs = require('fs');
const { OctoStorageEngine } = require('./lib/storage');
const { OctoEngine } = require('./lib/engine');
const cache = require('./lib/cache');
const { systemIpOnlyMiddleware, getClientIp } = require('./lib/firewall');
const { sanitizeXss } = require('./lib/crypto');

const app = express();
const PORT = process.env.OCTOSQL_PORT || 8421;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Initialize Storage and Query Engine
const storage = new OctoStorageEngine();
const engine = new OctoEngine(storage);

// Seed tables from OctoControl db.json if not already present
function seedInitialData() {
  const legacyDbFile = path.join(__dirname, '..', 'octocontrol', 'data', 'db.json');
  if (!fs.existsSync(legacyDbFile)) return;

  try {
    const raw = fs.readFileSync(legacyDbFile, 'utf8');
    const db = JSON.parse(raw);

    // 1. system_settings
    if (!storage.getTable('system_settings')) {
      storage.createTable('system_settings', {
        id: 'INTEGER',
        key: 'TEXT',
        value: 'TEXT',
        updatedAt: 'DATETIME'
      }, 'id');

      const settings = db.settings || {};
      for (const [key, val] of Object.entries(settings)) {
        engine.executeSql(`INSERT INTO system_settings (key, value, updatedAt) VALUES ('${key}', '${String(val).replace(/'/g, "''")}', '${new Date().toISOString()}')`);
      }
      console.log('[OctoSQL] Initialized table: system_settings');
    }

    // 2. locales
    if (!storage.getTable('locales')) {
      storage.createTable('locales', {
        id: 'INTEGER',
        code: 'TEXT',
        name: 'TEXT',
        nativeName: 'TEXT',
        isDefault: 'BOOLEAN',
        direction: 'TEXT',
        isActive: 'BOOLEAN'
      }, 'id');

      const locales = db.locales || [];
      for (const loc of locales) {
        engine.executeSql(`INSERT INTO locales (code, name, nativeName, isDefault, direction, isActive) VALUES ('${loc.code}', '${loc.name}', '${loc.nativeName}', ${loc.isDefault ? true : false}, '${loc.direction || 'ltr'}', ${loc.isActive !== false ? true : false})`);
      }
      console.log('[OctoSQL] Initialized table: locales');
    }

    // 3. pages
    if (!storage.getTable('pages')) {
      storage.createTable('pages', {
        id: 'TEXT',
        slug: 'TEXT',
        template: 'TEXT',
        status: 'TEXT',
        translations: 'JSON',
        updatedAt: 'DATETIME'
      }, 'id');

      const pages = db.pages || [];
      for (const p of pages) {
        const transJson = JSON.stringify(p.translations || {}).replace(/'/g, "''");
        engine.executeSql(`INSERT INTO pages (id, slug, template, status, translations, updatedAt) VALUES ('${p.id}', '${p.slug}', '${p.template || 'standard'}', '${p.status || 'published'}', '${transJson}', '${p.updatedAt || new Date().toISOString()}')`);
      }
      console.log('[OctoSQL] Initialized table: pages');
    }

    // 4. audit_logs
    if (!storage.getTable('audit_logs')) {
      storage.createTable('audit_logs', {
        id: 'UUID',
        event: 'TEXT',
        details: 'TEXT',
        ip: 'TEXT',
        createdAt: 'DATETIME'
      }, 'id');
      console.log('[OctoSQL] Initialized table: audit_logs');
    }

  } catch (err) {
    console.error('[OctoSQL] Error seeding initial tables:', err.message);
  }
}

seedInitialData();

// --- Firewalled phpMyAdmin-Themed Web Studio (System IPs Only) ---
app.get(['/', '/admin', '/studio'], systemIpOnlyMiddleware, async (req, res) => {
  const tables = storage.listTables();
  const activeTableName = req.query.table || (tables.length > 0 ? tables[0].name : null);
  const activeTab = req.query.tab || 'browse'; // browse, structure, sql, insert, edit, operations
  const activeTableData = activeTableName ? storage.getTable(activeTableName) : null;
  const clientIp = getClientIp(req);

  // Sorting
  const sortBy = req.query.sort || (activeTableData ? activeTableData.primaryKey : null);
  const sortDir = (req.query.dir || 'ASC').toUpperCase();

  // If in edit mode, fetch row to edit
  let editRow = null;
  if (activeTab === 'edit' && activeTableData && req.query.pk) {
    const pkVal = req.query.pk;
    editRow = activeTableData.records.find(r => String(r[activeTableData.primaryKey]) === String(pkVal)) || null;
  }

  // Browse rows
  let displayRows = [];
  let queryTime = '0.0001';
  let executedQuery = '';

  if (activeTableData) {
    executedQuery = `SELECT * FROM ${activeTableName}`;
    if (sortBy && activeTableData.schema[sortBy]) {
      executedQuery += ` ORDER BY ${sortBy} ${sortDir}`;
    }
    executedQuery += ' LIMIT 50;';

    try {
      const qRes = await engine.execute(executedQuery);
      displayRows = qRes.rows || [];
      queryTime = (qRes.executionTimeMs / 1000).toFixed(4);
    } catch {
      displayRows = [...activeTableData.records];
    }
  }

  res.render('studio', {
    tables,
    activeTable: activeTableName,
    activeTableData,
    activeTab,
    displayRows,
    editRow,
    executedQuery,
    queryTime,
    sortBy,
    sortDir,
    cacheStats: cache.getStats(),
    clientIp,
    message: req.query.msg || null,
    error: req.query.err || null
  });
});

// Manual Row Insert / Update (Elle Yönetim)
app.post('/admin/row/save', systemIpOnlyMiddleware, (req, res) => {
  const { table_name, is_edit, pk_val, ...formData } = req.body;
  const table = storage.getTable(table_name);
  if (!table) {
    return res.redirect(`/admin?err=Cədvəl tapılmadı`);
  }

  try {
    const record = {};
    for (const [col, colType] of Object.entries(table.schema)) {
      if (formData[col] !== undefined) {
        let rawVal = formData[col];
        if (colType === 'JSON') {
          try { rawVal = JSON.parse(rawVal); } catch { /* keep raw string or empty */ }
        }
        record[col] = storage.castValue(rawVal, colType);
      }
    }

    if (is_edit === 'true') {
      // Update existing row
      const idx = table.records.findIndex(r => String(r[table.primaryKey]) === String(pk_val));
      if (idx !== -1) {
        table.records[idx] = { ...table.records[idx], ...record };
        storage.persistTable(table_name);
        cache.invalidateTable(table_name);
      }
      return res.redirect(`/admin?table=${table_name}&tab=browse&msg=Sətir uğurla redaktə edildi.`);
    } else {
      // Insert new row
      if (!record[table.primaryKey]) {
        if (table.schema[table.primaryKey] === 'UUID') {
          record[table.primaryKey] = require('./lib/crypto').uuid();
        } else {
          record[table.primaryKey] = table.autoIncrement++;
        }
      }
      table.records.push(record);
      storage.persistTable(table_name);
      cache.invalidateTable(table_name);
      return res.redirect(`/admin?table=${table_name}&tab=browse&msg=Yeni sətir uğurla əlavə edildi.`);
    }
  } catch (err) {
    return res.redirect(`/admin?table=${table_name}&tab=insert&err=${encodeURIComponent(err.message)}`);
  }
});

// Manual Row Delete
app.post('/admin/row/delete', systemIpOnlyMiddleware, (req, res) => {
  const { table_name, pk_val } = req.body;
  const table = storage.getTable(table_name);
  if (!table) return res.redirect('/admin?err=Cədvəl tapılmadı');

  table.records = table.records.filter(r => String(r[table.primaryKey]) !== String(pk_val));
  storage.persistTable(table_name);
  cache.invalidateTable(table_name);
  res.redirect(`/admin?table=${table_name}&tab=browse&msg=Sətir silindi.`);
});

// Manual Table Operations: Truncate
app.post('/admin/table/truncate', systemIpOnlyMiddleware, (req, res) => {
  const { table_name } = req.body;
  try {
    engine.executeSql(`TRUNCATE TABLE ${table_name}`);
    res.redirect(`/admin?table=${table_name}&tab=browse&msg=Cədvəl boşaldıldı (TRUNCATE).`);
  } catch (err) {
    res.redirect(`/admin?table=${table_name}&tab=operations&err=${encodeURIComponent(err.message)}`);
  }
});

// Manual Table Operations: Drop
app.post('/admin/table/drop', systemIpOnlyMiddleware, (req, res) => {
  const { table_name } = req.body;
  try {
    engine.executeSql(`DROP TABLE ${table_name}`);
    res.redirect(`/admin?msg=Cədvəl silindi (DROP).`);
  } catch (err) {
    res.redirect(`/admin?table=${table_name}&tab=operations&err=${encodeURIComponent(err.message)}`);
  }
});

// Manual Table Create
app.post('/admin/table/create', systemIpOnlyMiddleware, (req, res) => {
  const { new_table_name, columns_str, primary_key } = req.body;
  const cleanName = (new_table_name || '').trim();
  if (!cleanName) return res.redirect('/admin?err=Cədvəl adı boş ola bilməz');

  try {
    const schema = {};
    const cols = columns_str.split(',').map(s => s.trim()).filter(Boolean);
    for (const c of cols) {
      const parts = c.split(':');
      const cName = parts[0].trim();
      const cType = (parts[1] || 'TEXT').trim().toUpperCase();
      schema[cName] = cType;
    }

    storage.createTable(cleanName, schema, primary_key || 'id');
    res.redirect(`/admin?table=${cleanName}&tab=structure&msg=Yeni cədvəl yaradıldı.`);
  } catch (err) {
    res.redirect(`/admin?err=${encodeURIComponent(err.message)}`);
  }
});

// --- REST APIs ---
// Execute Query
app.post('/api/query', systemIpOnlyMiddleware, async (req, res) => {
  const { query, params } = req.body;
  if (!query) return res.status(400).json({ error: 'Missing query in request body' });

  try {
    const result = await engine.execute(query, params);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message, query });
  }
});

// List tables
app.get('/api/tables', systemIpOnlyMiddleware, (req, res) => {
  res.json({ tables: storage.listTables(), count: storage.tables.size });
});

// Status
app.get('/api/status', systemIpOnlyMiddleware, (req, res) => {
  res.json({
    status: 'ONLINE',
    engine: 'OctoSQL',
    port: PORT,
    clientIp: getClientIp(req),
    tablesCount: storage.tables.size,
    memoryUsage: process.memoryUsage(),
    cache: cache.getStats(),
    uptimeSeconds: Math.floor(process.uptime())
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`OctoSQL Server running on port ${PORT}`);
  console.log(`OctoAdminer: http://localhost:${PORT}/admin`);
});