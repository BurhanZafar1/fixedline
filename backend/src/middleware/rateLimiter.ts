import rateLimit from 'express-rate-limit';

// General API rate limiter
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Stricter limiter for auth endpoints
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

// Per-phone-number limiter for SMS webhook (prevents DoS via forged requests)
// Key on the From number so one spammer can't block all processing
export const smsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,             // 10 messages per minute per IP (Twilio IPs)
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use Twilio's From number as rate limit key when available
    const body = req.body as { From?: string };
    return body.From ?? req.ip ?? 'unknown';
  },
  message: { error: 'Rate limit exceeded' },
  skip: () => process.env['NODE_ENV'] === 'test',
});
