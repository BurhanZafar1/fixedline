import { createClient } from '@supabase/supabase-js';
import logger from '../utils/logger';

const supabaseUrl = process.env['SUPABASE_URL'];
const supabaseKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!supabaseUrl || !supabaseKey) {
  logger.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Service-role client — bypasses RLS, never exposed to browser
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ──────────────────────────────────────────────────────────────
// Typed query helpers (thin wrappers, not an ORM)
// ──────────────────────────────────────────────────────────────

import type {
  Business,
  Conversation,
  Appointment,
  ConversationMessage,
} from '../types';

// Businesses ──────────────────────────────────────────────────

export async function getBusinessByTwilioNumber(
  twilioNumber: string
): Promise<Business | null> {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('twilio_number', twilioNumber)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data as Business | null;
}

export async function getBusinessById(id: string): Promise<Business | null> {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', id)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data as Business | null;
}

export async function updateBusiness(
  id: string,
  updates: Partial<Business>
): Promise<void> {
  const { error } = await supabase
    .from('businesses')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

// Conversations ───────────────────────────────────────────────

export async function getOrCreateConversation(
  businessId: string,
  customerPhone: string
): Promise<Conversation> {
  // Try to find existing active conversation
  const { data: existing, error: fetchError } = await supabase
    .from('conversations')
    .select('*')
    .eq('business_id', businessId)
    .eq('customer_phone', customerPhone)
    .not('status', 'eq', 'closed')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;
  if (existing) return existing as Conversation;

  // Create new conversation
  const { data: created, error: createError } = await supabase
    .from('conversations')
    .insert({
      business_id: businessId,
      customer_phone: customerPhone,
      messages: [],
      status: 'active',
    })
    .select()
    .single();

  if (createError) throw createError;
  return created as Conversation;
}

export async function appendMessage(
  conversationId: string,
  message: ConversationMessage
): Promise<void> {
  // Use Postgres jsonb_insert for atomic array append
  const { error } = await supabase.rpc('append_conversation_message', {
    p_conversation_id: conversationId,
    p_message: message,
  });

  if (error) {
    // Fallback: read-modify-write (slightly less atomic but fine for our load)
    const { data, error: fetchError } = await supabase
      .from('conversations')
      .select('messages')
      .eq('id', conversationId)
      .single();
    if (fetchError) throw fetchError;
    const messages: ConversationMessage[] = (data as { messages: ConversationMessage[] }).messages ?? [];
    messages.push(message);
    const { error: updateError } = await supabase
      .from('conversations')
      .update({ messages })
      .eq('id', conversationId);
    if (updateError) throw updateError;
  }
}

export async function updateConversation(
  id: string,
  updates: Partial<Conversation>
): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

export async function getConversationsByBusiness(
  businessId: string,
  limit = 50,
  offset = 0
): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('business_id', businessId)
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as Conversation[];
}

// Appointments ────────────────────────────────────────────────

export async function createAppointment(
  appt: Omit<Appointment, 'id' | 'created_at'>
): Promise<Appointment> {
  const { data, error } = await supabase
    .from('appointments')
    .insert(appt)
    .select()
    .single();
  if (error) throw error;
  return data as Appointment;
}

export async function getAppointmentsByBusiness(
  businessId: string,
  from: Date,
  to: Date
): Promise<Appointment[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('business_id', businessId)
    .gte('scheduled_time', from.toISOString())
    .lte('scheduled_time', to.toISOString())
    .order('scheduled_time', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Appointment[];
}

// Webhook idempotency ─────────────────────────────────────────

export async function checkAndMarkWebhookEvent(
  eventId: string,
  eventType: string,
  businessId?: string
): Promise<boolean> {
  // Returns true if already processed (duplicate)
  const { error } = await supabase.from('webhook_events').insert({
    id: eventId,
    event_type: eventType,
    business_id: businessId ?? null,
  });

  if (error?.code === '23505') return true; // unique violation = duplicate
  if (error) throw error;
  return false;
}
