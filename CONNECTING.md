# Connecting Node.js Applications to OctoSQL

This guide provides end-to-end instructions for connecting any Node.js application (Express, Fastify, NestJS, Next.js, Koa, or background workers) to the **OctoSQL** database engine.

---

## 1. Installation & Import

Install the OctoSQL client driver in your project:

```bash
# If using a local workspace or linked package:
npm install ../octosql

# Or install from npm (if published):
npm install octosql
```

Import the driver in your code:

```javascript
// CommonJS
const octosql = require('octosql');
// or destructure methods
const { createPool, createConnection } = require('octosql');
```

```typescript
// ES Modules / TypeScript
import { createPool, createConnection, OctoPool, OctoConnection } from 'octosql';
```

---

## 2. Connection Methods

OctoSQL provides two standard SQL connection paradigms: **Connection Pool** (recommended for web applications) and **Single Connection**.

### A. Connection Pool (`createPool`) — Recommended
A connection pool manages multiple reusable database connections, handles spikes in traffic, and automatically reconnects on failures.

```javascript
const { createPool } = require('octosql');

const pool = createPool({
  host: process.env.OCTOSQL_HOST || '127.0.0.1',
  port: parseInt(process.env.OCTOSQL_PORT, 10) || 8421,
  database: 'octosql_db',
  connectionLimit: 10 // Max concurrent connections
});
```

### B. Single Connection (`createConnection`)
Best for migration scripts, background workers, or single-threaded CLI commands.

```javascript
const { createConnection } = require('octosql');

// 1. Using an options object:
const conn = createConnection({
  host: '127.0.0.1',
  port: 8421,
  database: 'octosql_db'
});

// 2. Or using a standard SQL Connection URI:
const conn = createConnection('octosql://root:password@127.0.0.1:8421/octosql_db');

await conn.connect();
```

---

## 3. Querying & Parameter Binding

OctoSQL supports array destructuring identical to `mysql2` and `pg`, as well as parameterized queries to protect against SQL injection.

### Standard SELECT with `?` Placeholders
```javascript
// Positional parameters
const [users, fields] = await pool.query(
  'SELECT id, username, email FROM users WHERE status = ? AND age >= ?',
  ['active', 18]
);

console.log(`Found ${users.length} active users.`);
console.log(users[0].username);
```

### INSERT with Prepared Statements (`execute`)
```javascript
const [result] = await pool.execute(
  'INSERT INTO pages (id, slug, template, status, translations, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
  ['page-about', '/about', 'standard', 'published', { en: { title: 'About Us' } }, new Date().toISOString()]
);

console.log('Inserted ID:', result.insertId);
console.log('Affected rows:', result.affectedRows);
```

### UPDATE and DELETE
```javascript
// Update
await pool.execute(
  'UPDATE pages SET status = ?, updatedAt = ? WHERE id = ?',
  ['draft', new Date().toISOString(), 'page-about']
);

// Delete
await pool.execute(
  'DELETE FROM pages WHERE id = ?',
  ['page-about']
);
```

---

## 4. Using the OctoSQLX Dialect

In addition to ANSI SQL, you can use OctoSQL's custom high-efficiency dialect via `.octo()`:

```javascript
// 1. FETCH (Select with intuitive filtering & sorting)
const [articles] = await pool.octo(
  'FETCH id, title, category FROM articles FILTER category = ? SORT id DESC RANGE 10 SKIP 0',
  ['tech']
);

// 2. STORE (Object-oriented insert)
await pool.octo(
  'STORE IN locales OBJECT {"code": "fr", "name": "French", "isDefault": false}'
);

// 3. MUTATE (Targeted update)
await pool.octo(
  'MUTATE articles SET views = views + 1 FILTER id = ?',
  ['art-101']
);

// 4. PURGE (Clean deletion)
await pool.octo(
  'PURGE FROM articles FILTER category = ?',
  ['deprecated']
);
```

---

## 5. Transactions (`BEGIN`, `COMMIT`, `ROLLBACK`)

For operations that require atomic all-or-nothing execution, acquire a dedicated connection from the pool:

```javascript
async function transferAccountOwnership(userId, newOwnerId) {
  // Acquire a dedicated connection from the pool
  const conn = await pool.getConnection();

  try {
    // 1. Begin transaction
    await conn.beginTransaction();

    // 2. Step 1: Update original record
    await conn.execute(
      'UPDATE accounts SET owner_id = ?, updated_at = ? WHERE owner_id = ?',
      [newOwnerId, new Date().toISOString(), userId]
    );

    // 3. Step 2: Audit the transaction
    await conn.execute(
      'INSERT INTO audit_logs (id, event, details, created_at) VALUES (?, ?, ?, ?)',
      [require('crypto').randomUUID(), 'OWNERSHIP_TRANSFER', `Transferred to ${newOwnerId}`, new Date().toISOString()]
    );

    // 4. Commit transaction
    await conn.commit();
    console.log('Transaction successfully committed.');
  } catch (err) {
    // Rollback changes on any error
    await conn.rollback();
    console.error('Transaction failed and was rolled back:', err.message);
    throw err;
  } finally {
    // Always release connection back to the pool
    conn.release();
  }
}
```

---

## 6. Real-World Framework Integration Examples

### Express.js Integration
```javascript
const express = require('express');
const { createPool } = require('octosql');

const app = express();
app.use(express.json());

// Initialize database pool
const db = createPool({
  host: process.env.OCTOSQL_HOST || '127.0.0.1',
  port: 8421,
  database: 'octosql_db',
  connectionLimit: 10
});

// GET /api/pages
app.get('/api/pages', async (req, res) => {
  try {
    const [pages] = await db.query('SELECT * FROM pages WHERE status = ?', ['published']);
    res.json(pages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pages
app.post('/api/pages', async (req, res) => {
  const { id, slug, title } = req.body;
  try {
    await db.execute(
      'INSERT INTO pages (id, slug, template, status, translations, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
      [id, slug, 'standard', 'published', { az: { title } }, new Date().toISOString()]
    );
    res.status(201).json({ success: true, id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.listen(3000, () => console.log('App running on http://localhost:3000'));
```

### Next.js Route Handler (App Router)
```typescript
// app/api/locales/route.ts
import { NextResponse } from 'next/server';
import { createPool } from 'octosql';

const db = createPool({
  host: process.env.OCTOSQL_HOST || '127.0.0.1',
  port: 8421,
  database: 'octosql_db'
});

export async function GET() {
  try {
    const [locales] = await db.query('SELECT * FROM locales ORDER BY id ASC');
    return NextResponse.json({ locales });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

### Fastify Integration
```javascript
const fastify = require('fastify')({ logger: true });
const { createPool } = require('octosql');

const db = createPool({ host: '127.0.0.1', port: 8421 });

fastify.get('/products', async (request, reply) => {
  const [products] = await db.query('SELECT * FROM products LIMIT 50');
  return products;
});

fastify.listen({ port: 3000 });
```

---

## 7. Error Handling & Diagnostics

The OctoSQL driver surfaces standard error codes to facilitate reliable error handling:

```javascript
try {
  const [data] = await pool.query('SELECT * FROM non_existing_table');
} catch (err) {
  if (err.code === 'ECONNREFUSED') {
    console.error('Could not connect to OctoSQL server. Is the daemon running?');
  } else if (err.code === 'OCTOSQL_ERROR') {
    console.error('SQL Syntax or Execution Error:', err.message);
  } else {
    console.error('Unexpected error:', err);
  }
}
```

To test connectivity at startup:
```javascript
const { createConnection } = require('octosql');

async function verifyDatabase() {
  const conn = createConnection({ host: '127.0.0.1', port: 8421 });
  try {
    const ping = await conn.ping();
    console.log(`✓ OctoSQL Server connected in ${ping.latencyMs}ms`);
  } catch (err) {
    console.error('✕ Failed to reach OctoSQL Server:', err.message);
    process.exit(1);
  }
}

verifyDatabase();
```

---

## 8. Summary Checklist

- [x] Use `createPool()` for multi-user web servers and REST APIs.
- [x] Use `?` parameter placeholders to prevent SQL injection.
- [x] Destructure query results with `const [rows, fields] = await pool.query(...)`.
- [x] Use `await conn.beginTransaction()` / `commit()` / `rollback()` for multi-step mutations.
- [x] Manage your tables and test queries visually via OctoAdminer at `http://127.0.0.1:8421/admin`.
