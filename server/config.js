/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */
'use strict';

require('dotenv').config();

const path = require('path');

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

// In production the Secure cookie flag is always on. In development it can be
// disabled via COOKIE_SECURE=false to allow plain-HTTP localhost testing.
const cookieSecure = isProduction
  ? true
  : String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true';

const config = {
  nodeEnv: NODE_ENV,
  isProduction,
  port: parseInt(process.env.PORT || '3000', 10),

  databaseUrl: required('DATABASE_URL'),
  fileStorePath: path.resolve(required('FILE_STORE_PATH')),

  // Session lifetimes
  sessionTtlMs: 8 * 60 * 60 * 1000, // 8 hours
  resetTtlMs: 30 * 60 * 1000, // 30 minutes

  cookie: {
    fullName: 'sid',
    resetName: 'sid_reset',
    secure: cookieSecure,
    sameSite: 'strict',
    httpOnly: true,
    path: '/',
  },

  // Argon2id parameters (see 04_security_implementation.md §1)
  argon2: {
    type: 'argon2id', // resolved to the numeric constant in utils/password.js
    memoryCost: 65536, // KiB
    timeCost: 3,
    parallelism: 4,
  },

  upload: {
    maxBytes: 100 * 1024 * 1024, // 100 MB
    allowedMime: ['application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'text/tab-separated-values', 'application/json', 'application/xml', 'text/yaml', 'application/x-yaml', 'image/jpeg', 'image/gif', 'image/bmp', 'image/avif', 'image/webp', 'image/png', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp3'],
    allowedExt: ['.pdf', '.txt', '.md', '.csv', '.tsv', '.json', '.xml', '.yaml', '.png', '.jpg', '.gif', '.webp', '.bmp', '.avif', '.mp4', '.webm', '.mp3'],
  },

  passwordMinLength: 12,
  loginRateLimit: { windowMs: 60 * 1000, max: 10 }, // 10 attempts / IP / minute
};

module.exports = config;
