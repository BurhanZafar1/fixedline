// Load env vars first — before any imports that read process.env
import 'dotenv/config';
// Make async errors in Express route handlers propagate to the error handler
import 'express-async-errors';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { apiLimiter } from './middleware/rateLimiter';
import webhookRouter from './routes/webhook';
import businessesRouter from './routes/businesses';
import conversationsRouter from './routes/conversations';
import appointmentsRouter from './routes/appointments';
import authRouter, { healthRouter } from './routes/auth';
import logger from './utils/logger';

// ──────────────────────────────────────────────────────────────
// Validate required env vars on startup (fail fast)
// ──────────────────────────────────────────────────────────────
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'ENCRYPTION_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

if ((process.env['ENCRYPTION_KEY'] ?? '').length !== 64) {
  logger.error('ENCRYPTION_KEY must be exactly 64 hex characters');
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────
// App setup
// ──────────────────────────────────────────────────────────────
const app = express();
const PORT = parseInt(process.env['PORT'] ?? '3001', 10);

// ── Security headers ──────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false, // Frontend handled separately
  })
);

// ── CORS ──────────────────────────────────────────────────────
// FRONTEND_URL may hold one origin or a comma-separated list
const allowedOrigins = (process.env['FRONTEND_URL'] ?? 'http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow no-origin (mobile apps, Postman, curl) and allowlisted origins
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
  })
);

// ── Logging ───────────────────────────────────────────────────
app.use(
  morgan(process.env['NODE_ENV'] === 'production' ? 'combined' : 'dev', {
    stream: { write: (msg) => logger.http(msg.trim()) },
  })
);

// ── Raw body for Stripe webhook (MUST come before express.json) ──
// Stripe signature verification requires the raw Buffer
app.use('/webhook/stripe', express.raw({ type: 'application/json' }));

// ── Body parsers ──────────────────────────────────────────────
// Twilio posts url-encoded form data
app.use('/webhook/sms', express.urlencoded({ extended: false }));
app.use('/webhook/voice', express.urlencoded({ extended: false }));
// Everything else is JSON
app.use(express.json({ limit: '512kb' }));

// ── Rate limiting ─────────────────────────────────────────────
app.use('/api', apiLimiter);

// ── Trust proxy (Railway/Vercel put real IPs in X-Forwarded-For) ──
app.set('trust proxy', 1);

// ──────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────
app.use(healthRouter());

// Twilio webhooks (no auth — validated by Twilio signature)
app.use('/webhook', webhookRouter);

// Google Calendar OAuth callback (no auth — state param carries businessId)
// Mounted directly so it doesn't require Bearer token
app.use('/api/businesses', businessesRouter);

// Authenticated API routes
app.use('/api/auth', authRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/appointments', appointmentsRouter);

// ──────────────────────────────────────────────────────────────
// 404 handler
// ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ──────────────────────────────────────────────────────────────
// Global error handler
// ──────────────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Don't leak stack traces to clients in production
  logger.error('Unhandled error', { message: err.message, stack: err.stack });

  if (process.env['NODE_ENV'] === 'production') {
    res.status(500).json({ error: 'An unexpected error occurred' });
  } else {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// ──────────────────────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`FixedLine backend running on port ${PORT}`, {
    env: process.env['NODE_ENV'],
    port: PORT,
  });
});

// Graceful shutdown
const shutdown = (signal: string) => {
  logger.info(`${signal} received — shutting down gracefully`);
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
