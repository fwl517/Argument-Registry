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
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');

// Ensure the file store exists at startup.
fs.mkdirSync(config.fileStorePath, { recursive: true });

const MIME_TO_EXT = {
  // Documents
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'text/tab-separated-values': '.tsv',
  'application/json': '.json',
  'application/xml': '.xml',
  'text/yaml': '.yaml',
  'text/x-yaml': '.yaml',
  'application/x-yaml': '.yaml',
  
  // Images
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/bmp': '.bmp',

  // Audio / video
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3'
};

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, config.fileStorePath);
  },
  filename(_req, file, cb) {
    // Client-supplied filename is discarded entirely. Extension is derived from
    // the declared MIME type, falling back to the original extension.
    const ext = MIME_TO_EXT[file.mimetype] || path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  if (!config.upload.allowedMime.includes(file.mimetype)) {
    const err = new Error('UNSUPPORTED_FILE_TYPE');
    err.status = 422;
    err.code = 'UNSUPPORTED_FILE_TYPE';
    return cb(err);
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.upload.maxBytes },
});

/** Public-facing path stored in entries.local_path for an uploaded file. */
function publicPathFor(filename) {
  return `/uploads/${filename}`;
}

/** Best-effort removal of an uploaded file (used to clean up after validation errors). */
function removeUploaded(file) {
  if (!file || !file.path) return;
  fs.unlink(file.path, () => {
    /* ignore */
  });
}

module.exports = { upload, publicPathFor, removeUploaded, MIME_TO_EXT };
