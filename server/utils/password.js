/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */
'use strict';

const crypto = require('crypto');
const argon2 = require('argon2');
const config = require('../config');

const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: config.argon2.memoryCost,
  timeCost: config.argon2.timeCost,
  parallelism: config.argon2.parallelism,
  // 16-byte salt is auto-generated per hash by the argon2 library.
};

/**
 * Hash a plaintext password with Argon2id using the project parameters.
 * @param {string} plaintext
 * @returns {Promise<string>} encoded hash string (includes algorithm + salt)
 */
function hashPassword(plaintext) {
  return argon2.hash(plaintext, HASH_OPTIONS);
}

/**
 * Verify a submitted password against a stored hash. Returns false on any
 * malformed-hash error rather than throwing, so callers can treat all
 * failures identically (prevents user enumeration via error differences).
 * @param {string} storedHash
 * @param {string} submitted
 * @returns {Promise<boolean>}
 */
async function verifyPassword(storedHash, submitted) {
  try {
    return await argon2.verify(storedHash, submitted);
  } catch {
    return false;
  }
}

/**
 * Generate a cryptographically random temporary password.
 * 16 random bytes encoded base64url → ~22 URL-safe characters.
 * @returns {string}
 */
function generateTempPassword() {
  return crypto.randomBytes(16).toString('base64url');
}

module.exports = { hashPassword, verifyPassword, generateTempPassword };
