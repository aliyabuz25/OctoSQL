const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;

// Master Key - In production can be provided by OCTOSQL_MASTER_KEY
const MASTER_SECRET = process.env.OCTOSQL_MASTER_KEY || 'OctoSQL-Secure-Database-Engine-Master-Key-2026';
const SALT = crypto.createHash('sha256').update(MASTER_SECRET + '-salt').digest().subarray(0, SALT_LENGTH);
const DERIVED_KEY = crypto.pbkdf2Sync(MASTER_SECRET, SALT, 100000, 32, 'sha256');

/**
 * Encrypt a string or JSON object using AES-256-GCM with authentication tag
 */
function encrypt(data) {
  const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, DERIVED_KEY, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag();

  // Format: iv:tag:encryptedData
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt an AES-256-GCM encrypted payload, verifying authenticity tag
 */
function decrypt(payload, asJson = true) {
  if (!payload || typeof payload !== 'string' || !payload.includes(':')) {
    return payload;
  }

  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const encryptedText = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, DERIVED_KEY, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  if (asJson) {
    try {
      return JSON.parse(decrypted);
    } catch {
      return decrypted;
    }
  }
  return decrypted;
}

/**
 * SHA-256 Checksum for data blocks
 */
function checksum(content) {
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * XSS Sanitization utility to sanitize strings before display
 */
function sanitizeXss(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Generate cryptographic UUID v4
 */
function uuid() {
  return crypto.randomUUID();
}

module.exports = {
  encrypt,
  decrypt,
  checksum,
  sanitizeXss,
  uuid
};