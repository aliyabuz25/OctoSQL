#!/usr/bin/env node

const path = require('path');
const { spawn } = require('child_process');
const { OctoSQLClient, createConnection } = require('../lib/client');

const command = process.argv[2] || 'start';

if (command === 'start' || command === 'daemon') {
  console.log('Starting OctoSQL Database Daemon...');
  const daemonPath = path.join(__dirname, '..', 'daemon.js');
  const child = spawn(process.execPath, [daemonPath], {
    stdio: 'inherit',
    env: process.env
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
} else if (command === 'ping' || command === 'status') {
  const host = process.env.OCTOSQL_HOST || '127.0.0.1';
  const port = parseInt(process.env.OCTOSQL_PORT, 10) || 8421;
  const conn = createConnection({ host, port });

  conn.ping()
    .then((res) => {
      console.log(`OctoSQL Server is ONLINE at ${host}:${port} (Latency: ${res.latencyMs}ms)`);
      console.log('Status Details:', JSON.stringify(res.status, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(`OctoSQL Server is OFFLINE: ${err.message}`);
      process.exit(1);
    });
} else if (command === 'version' || command === '-v') {
  const pkg = require('../package.json');
  console.log(`OctoSQL Engine version ${pkg.version}`);
  process.exit(0);
} else {
  console.log(`
OctoSQL Database Engine CLI

Usage:
  octosql start      Start the database daemon and OctoAdminer
  octosql status     Check database daemon connectivity and health
  octosql version    Display version information

Environment Variables:
  OCTOSQL_PORT        Port to listen on (default: 8421)
  OCTOSQL_HOST        Host to bind to (default: 0.0.0.0)
  OCTOSQL_MASTER_KEY  Master encryption key for AES-256-GCM storage
  OCTOSQL_ALLOWED_IPS Comma-separated list of allowed system IPs
  REDIS_HOST          Redis host for caching layer (default: 127.0.0.1)
  REDIS_PORT          Redis port (default: 6379)
`);
  process.exit(0);
}