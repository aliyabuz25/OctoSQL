const { OctoStorageEngine, OctoEngine, cache, isSystemIp } = require('./lib/index');
const assert = require('assert');

async function runTests() {
  console.log('--- Starting OctoSQL Engine Unit Tests ---');

  const storage = new OctoStorageEngine();
  const engine = new OctoEngine(storage);

  // 1. Test SQL CREATE TABLE
  console.log('1. Testing CREATE TABLE...');
  await engine.execute('CREATE TABLE IF NOT EXISTS test_users (id INTEGER PRIMARY KEY, username TEXT, score FLOAT, isActive BOOLEAN)');
  
  // 2. Test SQL INSERT
  console.log('2. Testing INSERT INTO...');
  await engine.execute("INSERT INTO test_users (username, score, isActive) VALUES ('developer', 98.5, true)");
  await engine.execute("INSERT INTO test_users (username, score, isActive) VALUES ('admin', 100.0, true)");

  // 3. Test SQL SELECT
  console.log('3. Testing SELECT...');
  const selectRes = await engine.execute('SELECT * FROM test_users WHERE isActive = true ORDER BY score DESC');
  assert.strictEqual(selectRes.rowCount, 2);
  assert.strictEqual(selectRes.rows[0].username, 'admin');
  console.log('✓ SQL SELECT passed, rows:', selectRes.rowCount);

  // 4. Test OctoSQLX Syntax
  console.log('4. Testing OctoSQLX FETCH...');
  const fetchRes = await engine.execute('FETCH username, score FROM test_users FILTER score >= 99 SORT score DESC');
  assert.strictEqual(fetchRes.rowCount, 1);
  assert.strictEqual(fetchRes.rows[0].username, 'admin');
  console.log('✓ OctoSQLX FETCH passed');

  console.log('5. Testing OctoSQLX MUTATE...');
  await engine.execute("MUTATE test_users SET score = 99.9 FILTER username = 'developer'");
  const updated = await engine.execute("SELECT * FROM test_users WHERE username = 'developer'");
  assert.strictEqual(updated.rows[0].score, 99.9);
  console.log('✓ OctoSQLX MUTATE passed');

  console.log('6. Testing OctoSQLX PURGE...');
  await engine.execute("PURGE FROM test_users FILTER username = 'developer'");
  const afterPurge = await engine.execute('SELECT * FROM test_users');
  assert.strictEqual(afterPurge.rowCount, 1);
  console.log('✓ OctoSQLX PURGE passed');

  // 7. Test IP Firewall
  console.log('7. Testing System IP Firewall...');
  assert.strictEqual(isSystemIp('127.0.0.1'), true);
  assert.strictEqual(isSystemIp('::1'), true);
  assert.strictEqual(isSystemIp('::ffff:127.0.0.1'), true);
  assert.strictEqual(isSystemIp('203.0.113.195'), false); // Remote untrusted IP
  console.log('✓ IP Firewall validation passed');

  // Clean up test table
  await engine.execute('DROP TABLE test_users');
  console.log('--- All OctoSQL Unit Tests Passed Successfully! ---');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});