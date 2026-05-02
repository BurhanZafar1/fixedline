import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.middleware';
import { supabase, getBusinessById, updateBusiness } from '../db/supabase';
import { getAuthUrl, exchangeCodeForTokens, disconnectCalendar } from '../services/calendar.service';
import { createStripeCustomer, createCheckoutSession, createBillingPortalSession } from '../services/stripe.service';
import { provisionPhoneNumber } from '../services/twilio.service';
import { encrypt } from '../utils/crypto';
import logger from '../utils/logger';

const router = Router();
router.use(requireAuth);

// ──────────────────────────────────────────────────────────────
// GET /businesses/me  — get the current user's business
// ──────────────────────────────────────────────────────────────
router.get('/me', async (req: Request, res: Response): Promise<void> => {
  const { userEmail } = req as AuthenticatedRequest;

  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('owner_email', userEmail)
    .single();

  if (error && error.code === 'PGRST116') {
    res.status(404).json({ error: 'Business not found' });
    return;
  }
  if (error) throw error;

  // Never expose encrypted tokens to the frontend
  const { google_calendar_token_encrypted: _, ...safe } = data as Record<string, unknown>;
  res.json({ business: { ...safe, google_calendar_connected: !!data.google_calendar_token_encrypted } });
});

// ──────────────────────────────────────────────────────────────
// POST /businesses  — create business during onboarding
// ──────────────────────────────────────────────────────────────
const createBusinessSchema = z.object({
  name: z.string().min(2).max(100),
  owner_name: z.string().min(2).max(100),
  phone_number: z.string().regex(/^\+1\d{10}$/, 'Phone must be E.164 format e.g. +12025551234'),
  timezone: z.string().default('America/New_York'),
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { userEmail } = req as AuthenticatedRequest;

  const parsed = createBusinessSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  // Check if business already exists for this user
  const { data: existing } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_email', userEmail)
    .single();

  if (existing) {
    res.status(409).json({ error: 'Business already exists for this account' });
    return;
  }

  const { data, error } = await supabase
    .from('businesses')
    .insert({ ...parsed.data, owner_email: userEmail })
    .select()
    .single();

  if (error) throw error;

  // Create Stripe customer in background
  createStripeCustomer(data.id, userEmail, parsed.data.owner_name).catch(err =>
    logger.error('Failed to create Stripe customer', { err })
  );

  res.status(201).json({ business: data });
});

// ──────────────────────────────────────────────────────────────
// PATCH /businesses/me  — update business settings
// ──────────────────────────────────────────────────────────────
const updateBusinessSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  owner_name: z.string().min(2).max(100).optional(),
  phone_number: z.string().regex(/^\+1\d{10}$/).optional(),
  services: z.array(z.object({
    name: z.string(),
    description: z.string().default(''),
    price_min: z.number().min(0),
    price_max: z.number().min(0),
  })).optional(),
  working_hours: z.record(z.object({
    enabled: z.boolean(),
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  })).optional(),
  timezone: z.string().optional(),
  ai_enabled: z.boolean().optional(),
  google_calendar_id: z.string().optional(),
});

router.patch('/me', async (req: Request, res: Response): Promise<void> => {
  const { userEmail } = req as AuthenticatedRequest;

  const parsed = updateBusinessSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { data: business } = await supabase
    .from('businesses')
    .select('id, subscription_status')
    .eq('owner_email', userEmail)
    .single();

  if (!business) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }

  // Don't allow re-enabling AI if subscription is not active
  if (parsed.data.ai_enabled === true) {
    const allowed = ['trial', 'active'].includes(business.subscription_status);
    if (!allowed) {
      res.status(402).json({ error: 'Subscription required to enable AI' });
      return;
    }
  }

  await updateBusiness(business.id, parsed.data);
  res.json({ success: true });
});

// ──────────────────────────────────────────────────────────────
// POST /businesses/me/provision-number  — assign Twilio number
// ──────────────────────────────────────────────────────────────
router.post('/me/provision-number', async (req: Request, res: Response): Promise<void> => {
  const { userEmail } = req as AuthenticatedRequest;
  const { area_code } = req.body as { area_code?: string };

  if (!area_code || !/^\d{3}$/.test(area_code)) {
    res.status(400).json({ error: 'area_code must be a 3-digit string' });
    return;
  }

  const { data: business } = await supabase
    .from('businesses')
    .select('id, twilio_number')
    .eq('owner_email', userEmail)
    .single();

  if (!business) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }

  if (business.twilio_number) {
    res.status(409).json({
      error: 'Phone number already provisioned',
      phone_number: business.twilio_number,
    });
    return;
  }

  const webhookBase = process.env['RAILWAY_PUBLIC_DOMAIN']
    ? `https://${process.env['RAILWAY_PUBLIC_DOMAIN']}`
    : process.env['BACKEND_URL'] ?? 'https://api.fixedline.app';

  const phoneNumber = await provisionPhoneNumber(area_code, webhookBase);
  await updateBusiness(business.id, { twilio_number: phoneNumber });

  res.json({ phone_number: phoneNumber });
});

// ──────────────────────────────────────────────────────────────
// GET /businesses/me/calendar/auth  — start Google OAuth
// ──────────────────────────────────────────────────────────────
router.get('/me/calendar/auth', async (req: Request, res: Response): Promise<void> => {
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

  const authUrl = getAuthUrl(business.id);
  res.json({ auth_url: authUrl });
});

// ──────────────────────────────────────────────────────────────
// GET /businesses/me/calendar/callback  — Google OAuth callback
// (also called from the frontend redirect)
// ──────────────────────────────────────────────────────────────
router.get('/calendar/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state: businessId, error } = req.query as {
    code?: string;
    state?: string;
    error?: string;
  };

  const frontendUrl = process.env['FRONTEND_URL'] ?? 'http://localhost:3000';

  if (error || !code || !businessId) {
    res.redirect(`${frontendUrl}/onboarding?step=4&error=calendar_denied`);
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    await updateBusiness(businessId, {
      google_calendar_token_encrypted: encrypt(JSON.stringify(tokens)),
    });

    res.redirect(`${frontendUrl}/onboarding?step=5&calendar=connected`);
  } catch (err) {
    logger.error('Google Calendar OAuth callback error', { err });
    res.redirect(`${frontendUrl}/onboarding?step=4&error=calendar_failed`);
  }
});

// ──────────────────────────────────────────────────────────────
// DELETE /businesses/me/calendar  — disconnect Google Calendar
// ──────────────────────────────────────────────────────────────
router.delete('/me/calendar', async (req: Request, res: Response): Promise<void> => {
  const { userEmail } = req as AuthenticatedRequest;

  const { data: business } = await supabase
    .from('businesses')
    .select('*')
    .eq('owner_email', userEmail)
    .single();

  if (!business) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }

  await disconnectCalendar(business);
  res.json({ success: true });
});

// ──────────────────────────────────────────────────────────────
// POST /businesses/me/billing/checkout  — start Stripe subscription
// ──────────────────────────────────────────────────────────────
router.post('/me/billing/checkout', async (req: Request, res: Response): Promise<void> => {
  const { userEmail } = req as AuthenticatedRequest;

  const { data: business } = await supabase
    .from('businesses')
    .select('id, stripe_customer_id, owner_name')
    .eq('owner_email', userEmail)
    .single();

  if (!business) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }

  let customerId = business.stripe_customer_id;
  if (!customerId) {
    customerId = await createStripeCustomer(business.id, userEmail, business.owner_name);
  }

  const frontendUrl = process.env['FRONTEND_URL'] ?? 'http://localhost:3000';
  const checkoutUrl = await createCheckoutSession(customerId, business.id, frontendUrl);

  res.json({ checkout_url: checkoutUrl });
});

// ──────────────────────────────────────────────────────────────
// POST /businesses/me/billing/portal  — manage subscription
// ──────────────────────────────────────────────────────────────
router.post('/me/billing/portal', async (req: Request, res: Response): Promise<void> => {
  const { userEmail } = req as AuthenticatedRequest;

  const { data: business } = await supabase
    .from('businesses')
    .select('stripe_customer_id')
    .eq('owner_email', userEmail)
    .single();

  if (!business?.stripe_customer_id) {
    res.status(404).json({ error: 'No billing account found' });
    return;
  }

  const frontendUrl = process.env['FRONTEND_URL'] ?? 'http://localhost:3000';
  const portalUrl = await createBillingPortalSession(business.stripe_customer_id, `${frontendUrl}/settings`);

  res.json({ portal_url: portalUrl });
});

// ──────────────────────────────────────────────────────────────
// POST /businesses/me/complete-onboarding
// ──────────────────────────────────────────────────────────────
router.post('/me/complete-onboarding', async (req: Request, res: Response): Promise<void> => {
  const { userEmail } = req as AuthenticatedRequest;

  const { data: business } = await supabase
    .from('businesses')
    .select('id, name, twilio_number, services')
    .eq('owner_email', userEmail)
    .single();

  if (!business) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }

  if (!business.twilio_number) {
    res.status(400).json({ error: 'Phone number must be provisioned before completing onboarding' });
    return;
  }

  await updateBusiness(business.id, { onboarding_complete: true });
  res.json({ success: true });
});

export default router;
