const octosql = require('./lib/index');
const assert = require('assert');

async function testSqlConnections() {
  console.log('--- Testing SQL-Style Connection Methods End-to-End ---');

  // 1. Test createConnection with URI
  console.log('1. Testing createConnection with URI...');
  const conn = octosql.createConnection('octosql://root:secret@127.0.0.1:8421/octosql_db');
  
  // Handshake / Ping
  const ping = await conn.ping();
  assert.strictEqual(ping.ok, true);
  console.log(`✓ Connected & Ping OK (${ping.latencyMs}ms)`);

  // 2. Test query with array destructuring: const [rows, fields] = await conn.query(...)
  console.log('2. Testing standard SQL query with array destructuring...');
  const [pages, fields] = await conn.query('SELECT id, slug, status FROM pages WHERE status = ? LIMIT 2', ['published']);
  assert(Array.isArray(pages));
  assert(pages.length > 0);
  console.log(`✓ Retrieved ${pages.length} rows, first page ID: ${pages[0].id}`);
  console.log(`✓ Fields metadata:`, fields.map(f => f.name));

  // 3. Test Prepared Statement execution with parameter binding
  console.log('3. Testing execute with parameter binding (? placeholder)...');
  await conn.execute("INSERT INTO locales (code, name, nativeName, isDefault, direction, isActive) VALUES (?, ?, ?, ?, ?, ?)", [
    'es', 'İspan dili', 'Español', false, 'ltr', true
  ]);
  
  // Verify inserted row
  const [locales] = await conn.query('SELECT * FROM locales WHERE code = ?', ['es']);
  assert.strictEqual(locales.length, 1);
  assert.strictEqual(locales[0].nativeName, 'Español');
  console.log('✓ Prepared statement INSERT & SELECT verified');

  // 4. Clean up test locale
  await conn.execute('DELETE FROM locales WHERE code = ?', ['es']);
  console.log('✓ Cleanup DELETE verified');

  // 5. Test Transactions
  console.log('4. Testing Transactions (beginTransaction, commit)...');
  await conn.beginTransaction();
  assert.strictEqual(conn.inTransaction, true);
  await conn.commit();
  assert.strictEqual(conn.inTransaction, false);
  console.log('✓ Transactions (BEGIN / COMMIT) verified');

  // 6. Test Connection Pool (createPool)
  console.log('5. Testing Connection Pool (createPool)...');
  const pool = octosql.createPool({
    host: '127.0.0.1',
    port: 8421,
    database: 'octosql_db',
    connectionLimit: 5
  });

  const [poolRows] = await pool.query('SELECT COUNT(*) AS total FROM pages');
  console.log('✓ Pool query returned total pages:', poolRows.length);

  // Test pool getConnection & release
  const pooledConn = await pool.getConnection();
  assert(typeof pooledConn.release === 'function');
  pooledConn.release();
  console.log('✓ Pool getConnection & release verified');

  await conn.end();
  await pool.end();
  console.log('--- All SQL Connection Method Tests Passed Successfully! ---');
}

testSqlConnections().catch(err => {
  console.error('Connection test failed:', err);
  process.exit(1);
});