import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import logger from '../utils/logger';

// Anon key for verifying JWT tokens from the frontend
const supabaseUrl = process.env['SUPABASE_URL'] ?? '';
const supabaseAnonKey = process.env['SUPABASE_ANON_KEY'] ?? process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';

const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export interface AuthenticatedRequest extends Request {
  userId: string;
  userEmail: string;
}

/**
 * Verifies the Supabase JWT in the Authorization header.
 * Attaches userId and userEmail to the request.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const { data: { user }, error } = await authClient.auth.getUser(token);
    if (error || !user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    (req as AuthenticatedRequest).userId = user.id;
    (req as AuthenticatedRequest).userEmail = user.email ?? '';
    next();
  } catch (err) {
    logger.error('Auth middleware error', { err });
    res.status(500).json({ error: 'Authentication failed' });
  }
}
