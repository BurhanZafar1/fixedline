import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { authLimiter } from '../middleware/rateLimiter';
import logger from '../utils/logger';

const router = Router();

const supabase = createClient(
  process.env['SUPABASE_URL'] ?? '',
  process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? ''
);

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(2).max(100),
});

// ──────────────────────────────────────────────────────────────
// POST /auth/signup
// ──────────────────────────────────────────────────────────────
router.post('/signup', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // auto-confirm for MVP (add email verification later)
    user_metadata: { name: parsed.data.name },
  });

  if (error) {
    if (error.message.includes('already registered')) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }
    logger.error('Signup error', { error });
    res.status(500).json({ error: 'Failed to create account' });
    return;
  }

  res.status(201).json({ user: { id: data.user.id, email: data.user.email } });
});

// ──────────────────────────────────────────────────────────────
// Health check  GET /health
// (mounted at root, not under /auth — kept here for simplicity)
// ──────────────────────────────────────────────────────────────
export function healthRouter(): Router {
  const r = Router();
  r.get('/health', (_req, res) => {
    res.json({ status: 'ok', ts: new Date().toISOString() });
  });
  return r;
}

export default router;
