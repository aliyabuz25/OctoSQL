const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'data', 'security_audit.log');

// Allowed System IPs (Localhost, internal loopback, private container IPs if configured)
const DEFAULT_ALLOWED = ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost', '::ffff:127.0.0.0/104'];
const customIps = (process.env.OCTOSQL_ALLOWED_IPS || '')
  .split(',')
  .map(ip => ip.trim())
  .filter(Boolean);

const ALLOWED_SET = new Set([...DEFAULT_ALLOWED, ...customIps]);

function getClientIp(req) {
  let ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '';
  if (typeof ip === 'string' && ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  return ip;
}

function isSystemIp(ip) {
  if (!ip) return false;
  if (ALLOWED_SET.has(ip)) return true;
  // Handle IPv4 mapped IPv6 e.g. ::ffff:127.0.0.1
  if (ip.startsWith('::ffff:')) {
    const rawIpv4 = ip.replace('::ffff:', '');
    if (ALLOWED_SET.has(rawIpv4)) return true;
  }
  return false;
}

function logSecurityEvent(type, ip, path, details = '') {
  const logEntry = `[${new Date().toISOString()}] [${type}] IP: ${ip} | Path: ${path} | ${details}\n`;
  try {
    fs.appendFileSync(LOG_FILE, logEntry, 'utf8');
  } catch (err) {
    console.error('Failed to write security log:', err.message);
  }
}

/**
 * Express middleware for restricting web studio and administrative APIs to system IPs only
 */
function systemIpOnlyMiddleware(req, res, next) {
  const ip = getClientIp(req);
  if (isSystemIp(ip)) {
    return next();
  }

  logSecurityEvent('BLOCKED_UNAUTHORIZED_IP', ip, req.originalUrl, `Headers: ${JSON.stringify(req.headers['user-agent'] || '')}`);
  
  return res.status(403).json({
    status: 403,
    error: 'Access Denied: OctoSQL Studio is restricted strictly to verified System IPs.',
    clientIp: ip,
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  getClientIp,
  isSystemIp,
  logSecurityEvent,
  systemIpOnlyMiddleware
};