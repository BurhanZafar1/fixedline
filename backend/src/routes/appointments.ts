import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.middleware';
import { supabase, getAppointmentsByBusiness } from '../db/supabase';

const router = Router();
router.use(requireAuth);

// ──────────────────────────────────────────────────────────────
// GET /appointments  — list appointments for this business
// ──────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const { userEmail } = req as AuthenticatedRequest;

  const { data: business } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_email', userEmail)
    .single();

  if (!business) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }

  // Default to today and next 30 days
  const from = new Date((req.query['from'] as string) ?? new Date().toISOString());
  const to = new Date(
    (req.query['to'] as string) ??
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  );

  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);

  const appointments = await getAppointmentsByBusiness(business.id, from, to);
  res.json({ appointments });
});

// ──────────────────────────────────────────────────────────────
// GET /appointments/today  — today's appointments
// ──────────────────────────────────────────────────────────────
router.get('/today', async (req: Request, res: Response): Promise<void> => {
  const { userEmail } = req as AuthenticatedRequest;

  const { data: business } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_email', userEmail)
    .single();

  if (!business) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const appointments = await getAppointmentsByBusiness(business.id, today, tomorrow);
  res.json({ appointments });
});

// ──────────────────────────────────────────────────────────────
// GET /appointments/:id  — single appointment
// ──────────────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const { userEmail } = req as AuthenticatedRequest;
  const { id } = req.params as { id: string };

  const { data: business } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_email', userEmail)
    .single();

  if (!business) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }

  const { data: appt, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', id)
    .eq('business_id', business.id)
    .single();

  if (error || !appt) {
    res.status(404).json({ error: 'Appointment not found' });
    return;
  }

  res.json({ appointment: appt });
});

// ──────────────────────────────────────────────────────────────
// PATCH /appointments/:id  — update appointment (confirm, reschedule)
// ──────────────────────────────────────────────────────────────
const updateApptSchema = z.object({
  confirmed: z.boolean().optional(),
  scheduled_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  const { userEmail } = req as AuthenticatedRequest;
  const { id } = req.params as { id: string };

  const parsed = updateApptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { data: business } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_email', userEmail)
    .single();

  if (!business) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }

  const { data: appt } = await supabase
    .from('appointments')
    .select('id, business_id')
    .eq('id', id)
    .eq('business_id', business.id)
    .single();

  if (!appt) {
    res.status(404).json({ error: 'Appointment not found' });
    return;
  }

  const { error } = await supabase
    .from('appointments')
    .update(parsed.data)
    .eq('id', id);

  if (error) throw error;
  res.json({ success: true });
});

export default router;
