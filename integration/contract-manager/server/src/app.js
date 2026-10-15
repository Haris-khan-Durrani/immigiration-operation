/**
 * app.js — Main Express Application
 *
 * Registers all middleware, routes, and starts background workers.
 */
require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');

const path          = require('path');
const db            = require('./config/db');

const webhookRoutes   = require('./routes/webhook');
const authRoutes      = require('./routes/auth');
const contractRoutes  = require('./routes/contracts');
const templateRoutes  = require('./routes/templates');
const formRoutes      = require('./routes/forms');
const ghlRoutes       = require('./routes/ghl');
const signRoutes      = require('./routes/sign');
const verifyRoutes    = require('./routes/verify');
const settingsRoutes  = require('./routes/settings');
const clientSummaryRoutes = require('./routes/clientSummary');
const settingsService = require('./services/settingsService');

// Background workers
const expiryWorker = require('./services/expiryWorker');
const retryWorker  = require('./services/retryWorker');
const operationsHandoff = require('./services/operationsHandoff');

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure local uploads folder exists for permanent static serving
const uploadsDir = path.resolve(__dirname, '../uploads/branding');
const fs = require('fs');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

// Trust reverse proxies (Nginx 1-hop on VPS) for accurate client IP resolution
app.set('trust proxy', 1);

// ─── Security ────────────────────────────────────────────────────────────────
// Allow embedding in GoHighLevel Custom Menu Link iframes
app.use(helmet({
  frameguard: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'https://services.leadconnectorhq.com', 'http://localhost:*', 'ws://localhost:*'],
      frameAncestors: ["'self'", 'https://*.gohighlevel.com', 'https://*.leadconnectorhq.com', 'https://*.highlevel.com', '*'],
    },
  },
}));
app.use(cors({
  origin:      true, // Allow requests from embedded iframe context
  credentials: true,
}));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max:      200,
  standardHeaders: true,
  legacyHeaders:   false,
  validate: {
    trustProxy: false,
    xForwardedForHeader: false,
  },
}));

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Routes ───────────────────────────────────────────────────────────────────

// Auth verification: GHL Signed Context → app_user_access check
app.use('/api/auth', authRoutes);

// Webhook: authenticated by webhook secret (NOT GHL Signed Context)
app.use('/api/webhooks/ghl', webhookRoutes);

// Public signing portal & QR Verification — no GHL auth (publicly accessible)
app.use('/api/sign',   signRoutes);
app.use('/api/verify', verifyRoutes);

// Contract API: authenticated by GHL Signed Context + RBAC
app.use('/api/contracts', contractRoutes);
app.use('/api/client-summary', clientSummaryRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/forms',     formRoutes);
app.use('/api/ghl',       ghlRoutes);
app.use('/api/settings',  settingsRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[App] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, async () => {
  console.log(`\n🚀 Contract Manager Server running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Initialize and verify database connection & migrations first
  await db.init();

  // Preload dynamic settings from MySQL
  await settingsService.init();

  console.log(`   GHL API:     ${settingsService.get('GHL_API_BASE_URL', 'https://services.leadconnectorhq.com')}\n`);

  // Start background workers
  expiryWorker.start();
  retryWorker.start();
  await operationsHandoff.start();
});

// Graceful shutdown
const pdfService = require('./services/pdfService');
async function gracefulShutdown(signal) {
  console.log(`\n[Server] ${signal} received — shutting down gracefully…`);
  operationsHandoff.stop();
  await pdfService.closeBrowser();
  server.close(() => {
    console.log('[Server] HTTP server closed.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

module.exports = app;

