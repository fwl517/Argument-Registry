/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */
'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { attachSession, attachResetSession } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const sourceRoutes = require('./routes/sources');
const entryRoutes = require('./routes/entries');
const { router: keywordRoutes } = require('./routes/keywords');
const relationRoutes = require('./routes/relations');
const fileRoutes = require('./routes/files');
const healthRoutes = require('./routes/health');

const app = express();
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Behind a TLS-terminating proxy in production; required for Secure cookies and
// for express-rate-limit to read the real client IP.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// --- Security headers (see 04_security_implementation.md §4) --------------
const CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self'; " +
  "img-src 'self' data:; " +
  "font-src 'self'; " +
  "connect-src 'self'; " +
  "frame-src 'self'; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'; " +
  "frame-ancestors 'self'";

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (config.isProduction) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }
  next();
});

// --- Core middleware ------------------------------------------------------
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Populate req.user / req.session (full) and req.resetUser / req.resetSession
// (restricted force-reset pre-session). Both are cheap no-ops when their cookie
// is absent.
app.use(attachSession);
app.use(attachResetSession);

// --- Rate limiting --------------------------------------------------------
// Login is the only brute-forceable surface; limit it per IP.
const loginLimiter = rateLimit({
  windowMs: config.loginRateLimit.windowMs,
  max: config.loginRateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many login attempts. Please try again shortly.',
    },
  },
});
app.use('/api/auth/login', loginLimiter);

// --- API routes -----------------------------------------------------------
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sources', sourceRoutes);
app.use('/api/entries', entryRoutes);
app.use('/api/keywords', keywordRoutes);
app.use('/api/relations', relationRoutes);
app.use('/api/files', fileRoutes);

// Any unmatched /api path is a JSON 404 (never falls through to static).
app.use('/api', notFound);

// --- Static frontend ------------------------------------------------------
// Served after the API so a stray /api path can never resolve to a file.
app.use(
  express.static(PUBLIC_DIR, {
    extensions: ['html'],
    setHeaders(res, filePath) {
      // Belt-and-braces clickjacking protection on served HTML.
      if (filePath.endsWith('.html')) {
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

// SPA-style fallback is intentionally NOT used: each page is its own HTML file.
// A non-API, non-file GET returns the public index so deep links degrade gracefully.
app.get('*', (req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), (err) => {
    if (err) next();
  });
});

// --- Error handling -------------------------------------------------------
app.use(errorHandler);

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `Political Society DB API listening on port ${config.port} (${config.nodeEnv})`
  );
});

function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`\n${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
