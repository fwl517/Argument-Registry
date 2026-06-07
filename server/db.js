/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */
'use strict';

const { Pool } = require('pg');
const config = require('./config');

// Single shared connection pool for the whole process.
const pool = new Pool({ connectionString: config.databaseUrl });

pool.on('error', (err) => {
  // An idle client emitted an error. Log and let the pool recover; never crash.
  // eslint-disable-next-line no-console
  console.error('[db] idle client error:', err.message);
});

/**
 * Run a parameterised query. Always pass parameters as the second argument —
 * never interpolate user data into the SQL string.
 *
 * @param {string} text  SQL with $1, $2 placeholders
 * @param {Array}  params
 * @returns {Promise<import('pg').QueryResult>}
 */
function query(text, params) {
  return pool.query(text, params);
}

/**
 * Check out a dedicated client for an explicit transaction (BEGIN/COMMIT).
 * Caller MUST release the client in a finally block.
 */
function getClient() {
  return pool.connect();
}

/**
 * Convenience helper that runs `fn` inside a BEGIN/COMMIT block, rolling back
 * on any thrown error.
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback failure */
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, getClient, withTransaction };
