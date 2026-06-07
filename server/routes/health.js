/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */
'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// GET /api/health — liveness plus a database connectivity check.
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    let dbStatus = 'connected';
    try {
      await db.query('SELECT 1');
    } catch (_err) {
      dbStatus = 'disconnected';
    }

    const ok = dbStatus === 'connected';
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      db: dbStatus,
      time: new Date().toISOString(),
    });
  })
);

module.exports = router;
