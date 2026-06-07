/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('../db');
const config = require('../config');
const { requirePermission } = require('../middleware/auth');
const { asyncHandler, HttpError } = require('../middleware/errorHandler');
const { upload, publicPathFor, MIME_TO_EXT } = require('../middleware/upload');

const router = express.Router();

const EXT_TO_MIME = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.yaml': 'text/plain; charset=utf-8',
  '.yml': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
};

// POST /api/files  (Write or above)
// Stores an uploaded PDF/TXT and returns the public path that callers persist in
// entries.local_path. Multer enforces the type and size limits (see middleware).
router.post(
  '/',
  requirePermission('Write'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new HttpError(422, 'VALIDATION', {
        fields: { file: 'A file is required.' },
      });
    }
    res.status(201).json({ local_path: publicPathFor(req.file.filename) });
  })
);

// GET /api/files/:filename
// Streams a stored file inline. Access mirrors entry visibility: a file attached
// to a private entry is only served to an authenticated session. Files are read
// from FILE_STORE_PATH (outside the web root) with a path-traversal guard.
router.get(
  '/:filename',
  asyncHandler(async (req, res) => {
    const { filename } = req.params;

    // Reject anything that is not a bare filename before touching the disk.
    if (filename !== path.basename(filename)) {
      throw new HttpError(400, 'BAD_REQUEST');
    }

    const candidatePath = publicPathFor(filename);

    // The file must belong to a known entry; this is also our authority on
    // whether the entry (and therefore the file) is private.
    const { rows } = await db.query(
      'SELECT is_private FROM entries WHERE local_path = $1 LIMIT 1',
      [candidatePath]
    );
    if (rows.length === 0) {
      throw new HttpError(404, 'NOT_FOUND');
    }
    if (rows[0].is_private && !req.user) {
      throw new HttpError(401, 'UNAUTHENTICATED');
    }

    // Resolve and confirm the path stays within the file store.
    const resolved = path.resolve(config.fileStorePath, filename);
    if (
      resolved !== path.join(config.fileStorePath, filename) ||
      !resolved.startsWith(config.fileStorePath + path.sep)
    ) {
      throw new HttpError(400, 'BAD_REQUEST');
    }

    if (!fs.existsSync(resolved)) {
      throw new HttpError(404, 'NOT_FOUND');
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType = EXT_TO_MIME[ext] || 'application/octet-stream';
    // Known (previewable) types are shown inline; anything else downloads.
    const disposition = EXT_TO_MIME[ext] ? 'inline' : 'attachment';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const stream = fs.createReadStream(resolved);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json({
          error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not read file.' },
        });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  })
);

// Referenced to keep the MIME map in one place; harmless if unused elsewhere.
void MIME_TO_EXT;

module.exports = router;
