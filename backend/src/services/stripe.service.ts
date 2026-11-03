import Stripe from 'stripe';
import { supabase } from '../db/supabase';
import logger from '../utils/logger';

const stripe = new Stripe(process.env['STRIPE_SECRET_KEY'] ?? '', {
  apiVersion: '2025-02-24.acacia',
  typescript: true,
});

// ──────────────────────────────────────────────────────────────
// Create a Stripe customer for a new business
// ──────────────────────────────────────────────────────────────

export async function createStripeCustomer(
  businessId: string,
  email: string,
  name: string
): Promise<string> {
  const customer = await stripe.customers.create({
    email,
    name,
    metadata: { businessId },
  });

  await supabase
    .from('businesses')
    .update({ stripe_customer_id: customer.id })
    .eq('id', businessId);

  return customer.id;
}

// ──────────────────────────────────────────────────────────────
// Create a Stripe Checkout Session (subscription)
// ──────────────────────────────────────────────────────────────

export async function createCheckoutSession(
  customerId: string,
  businessId: string,
  returnUrl: string
): Promise<string> {
  const priceId = process.env['STRIPE_SOLO_PRICE_ID'];
  if (!priceId) throw new Error('STRIPE_SOLO_PRICE_ID not configured');

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: 14,
      metadata: { businessId },
    },
    success_url: `${returnUrl}/dashboard?payment=success`,
    cancel_url: `${returnUrl}/settings?payment=cancelled`,
    metadata: { businessId },
  });

  if (!session.url) throw new Error('Stripe did not return a session URL');
  return session.url;
}

// ──────────────────────────────────────────────────────────────
// Create a billing portal session (manage subscription)
// ──────────────────────────────────────────────────────────────

export async function createBillingPortalSession(
  customerId: string,
  returnUrl: string
): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url;
}

// ──────────────────────────────────────────────────────────────
// Handle Stripe webhook events
// ──────────────────────────────────────────────────────────────

export async function handleStripeWebhook(
  rawBody: Buffer,
  signature: string
): Promise<void> {
  const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    throw new Error(`Stripe webhook signature invalid: ${(err as Error).message}`);
  }

  logger.info('Stripe webhook received', { type: event.type });

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      await updateSubscriptionStatus(sub);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await setSubscriptionStatus(sub.metadata['businessId'], 'cancelled', sub.id);
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id;
      if (subId) {
        const sub = await stripe.subscriptions.retrieve(subId);
        await setSubscriptionStatus(sub.metadata['businessId'], 'past_due', sub.id);
      }
      break;
    }
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id;
      if (subId) {
        const sub = await stripe.subscriptions.retrieve(subId);
        await setSubscriptionStatus(sub.metadata['businessId'], 'active', sub.id);
      }
      break;
    }
    default:
      // Ignore unhandled events — don't throw
      break;
  }
}

async function updateSubscriptionStatus(sub: Stripe.Subscription): Promise<void> {
  const statusMap: Record<string, string> = {
    active: 'active',
    trialing: 'trial',
    past_due: 'past_due',
    canceled: 'cancelled',
    unpaid: 'paused',
    incomplete: 'paused',
    incomplete_expired: 'cancelled',
    paused: 'paused',
  };

  const mappedStatus = statusMap[sub.status] ?? 'paused';
  const businessId = sub.metadata['businessId'];
  if (!businessId) {
    logger.warn('Stripe subscription missing businessId metadata', { subId: sub.id });
    return;
  }

  // Pause AI when payment fails or subscription is not active
  const aiEnabled = ['active', 'trial'].includes(mappedStatus);

  await supabase
    .from('businesses')
    .update({
      subscription_status: mappedStatus,
      stripe_subscription_id: sub.id,
      ai_enabled: aiEnabled,
    })
    .eq('id', businessId);
}

async function setSubscriptionStatus(
  businessId: string | undefined,
  status: string,
  subId: string
): Promise<void> {
  if (!businessId) return;
  const aiEnabled = ['active', 'trial'].includes(status);
  await supabase
    .from('businesses')
    .update({
      subscription_status: status,
      stripe_subscription_id: subId,
      ai_enabled: aiEnabled,
    })
    .eq('id', businessId);
}
