-- FixedLine Database Schema
-- Run in Supabase SQL editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ──────────────────────────────────────
-- BUSINESSES
-- ──────────────────────────────────────
CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  owner_email TEXT NOT NULL UNIQUE,
  phone_number TEXT NOT NULL,          -- owner's cell for notifications
  twilio_number TEXT UNIQUE,           -- the number customers text
  services JSONB NOT NULL DEFAULT '[]',
  working_hours JSONB NOT NULL DEFAULT '{
    "monday":    {"enabled": true,  "start": "08:00", "end": "18:00"},
    "tuesday":   {"enabled": true,  "start": "08:00", "end": "18:00"},
    "wednesday": {"enabled": true,  "start": "08:00", "end": "18:00"},
    "thursday":  {"enabled": true,  "start": "08:00", "end": "18:00"},
    "friday":    {"enabled": true,  "start": "08:00", "end": "18:00"},
    "saturday":  {"enabled": false, "start": "09:00", "end": "13:00"},
    "sunday":    {"enabled": false, "start": "09:00", "end": "13:00"}
  }',
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  ai_enabled BOOLEAN NOT NULL DEFAULT true,
  onboarding_complete BOOLEAN NOT NULL DEFAULT false,
  google_calendar_token_encrypted TEXT,  -- AES-256 encrypted
  google_calendar_id TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'trial'
    CHECK (subscription_status IN ('trial', 'active', 'past_due', 'paused', 'cancelled')),
  trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────
-- CONVERSATIONS
-- ──────────────────────────────────────
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  messages JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'booked', 'closed', 'human_takeover')),
  appointment_booked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, customer_phone)  -- one active thread per customer per business
);

CREATE INDEX idx_conversations_business_id ON conversations(business_id);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_conversations_updated_at ON conversations(updated_at DESC);

-- ──────────────────────────────────────
-- APPOINTMENTS
-- ──────────────────────────────────────
CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  customer_phone TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  service_type TEXT NOT NULL,
  address TEXT NOT NULL,
  scheduled_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  google_event_id TEXT,
  confirmed BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  price_range TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_appointments_business_id ON appointments(business_id);
CREATE INDEX idx_appointments_scheduled_time ON appointments(scheduled_time);

-- ──────────────────────────────────────
-- WEBHOOK EVENTS (idempotency)
-- ──────────────────────────────────────
CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,           -- Twilio MessageSid or Stripe event ID
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,      -- 'sms', 'voice', 'stripe'
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_events_processed_at ON webhook_events(processed_at);

-- Auto-cleanup webhook events older than 7 days (prevent table bloat)
-- Run this as a scheduled job in Supabase or pg_cron:
-- DELETE FROM webhook_events WHERE processed_at < NOW() - INTERVAL '7 days';

-- ──────────────────────────────────────
-- AUTO-UPDATE updated_at
-- ──────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_businesses
  BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_conversations
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ──────────────────────────────────────
-- ROW LEVEL SECURITY
-- ──────────────────────────────────────
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- Businesses: owner can only see their own row
CREATE POLICY "businesses_owner_only"
  ON businesses FOR ALL
  USING (owner_email = auth.jwt() ->> 'email');

-- Conversations: business owner sees only their conversations
CREATE POLICY "conversations_owner_only"
  ON conversations FOR ALL
  USING (
    business_id IN (
      SELECT id FROM businesses WHERE owner_email = auth.jwt() ->> 'email'
    )
  );

-- Appointments: business owner sees only their appointments
CREATE POLICY "appointments_owner_only"
  ON appointments FOR ALL
  USING (
    business_id IN (
      SELECT id FROM businesses WHERE owner_email = auth.jwt() ->> 'email'
    )
  );

-- Backend service role bypasses RLS (used by server with service role key)
-- This is fine — the service role key is never exposed to the browser.
