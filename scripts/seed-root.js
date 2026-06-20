/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */
'use strict';

/**
 * Seed the single Root account.
 *
 *   node scripts/seed-root.js [username]
 *
 * Generates a random temporary password, hashes it with Argon2id, inserts the
 * Root user (permission Root, society_role President, force_reset = TRUE) and
 * prints the temporary password to stdout exactly once. Re-running is a no-op
 * if a Root account already exists (the schema enforces a Root singleton).
 */

const config = require('../server/config');
const db = require('../server/db');
const { hashPassword, generateTempPassword } = require('../server/utils/password');

async function main() {
  const username = (process.argv[2] || 'root').trim();
  if (!username) {
    console.error('A username is required.');
    process.exit(1);
  }

  // Abort if a Root already exists — the crown is transferred, never re-seeded.
  const existing = await db.query(
    "SELECT username FROM users WHERE permission = 'Root' LIMIT 1"
  );
  if (existing.rows.length > 0) {
    console.error(
      `A Root account already exists ("${existing.rows[0].username}"). ` +
        'Use Transfer Crown to move it; nothing was changed.'
    );
    process.exit(1);
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  try {
    await db.query(
      `INSERT INTO users (username, password_hash, permission, society_role, group_id, is_active, force_reset)
       VALUES ($1, $2, 'Root', 'President', (SELECT id FROM groups WHERE is_home = TRUE), TRUE, TRUE)`,
      [username, passwordHash]
    );
  } catch (err) {
    if (err && err.code === '23505') {
      console.error(`A user named "${username}" already exists.`);
      process.exit(1);
    }
    throw err;
  }

  const rule = '='.repeat(60);
  console.log(`\n${rule}`);
  console.log('  ROOT ACCOUNT CREATED');
  console.log(rule);
  console.log(`  Username:           ${username}`);
  console.log(`  Temporary password: ${tempPassword}`);
  console.log(rule);
  console.log('  This password is shown ONCE. Log in now and you will be');
  console.log('  required to set a new password immediately (force reset).');
  console.log(`${rule}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed to seed root account:', err.message);
    process.exit(1);
  });
