export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'paused' | 'cancelled';
export type ConversationStatus = 'active' | 'booked' | 'closed' | 'human_takeover';
export type MessageRole = 'customer' | 'assistant' | 'human';

export interface DayHours {
  enabled: boolean;
  start: string; // "09:00"
  end: string;   // "17:00"
}

export interface WorkingHours {
  monday: DayHours;
  tuesday: DayHours;
  wednesday: DayHours;
  thursday: DayHours;
  friday: DayHours;
  saturday: DayHours;
  sunday: DayHours;
}

export interface ServiceOffering {
  name: string;
  description: string;
  price_min: number;
  price_max: number;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

export interface Business {
  id: string;
  name: string;
  owner_name: string;
  owner_email: string;
  phone_number: string;        // owner personal phone for notifications
  twilio_number: string;       // the number customers text to
  services: ServiceOffering[];
  working_hours: WorkingHours;
  timezone: string;
  ai_enabled: boolean;
  onboarding_complete: boolean;
  google_calendar_token_encrypted: string | null; // AES-256 encrypted JSON
  google_calendar_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: SubscriptionStatus;
  trial_ends_at: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string; // ISO 8601
}

export interface Conversation {
  id: string;
  business_id: string;
  customer_phone: string;
  customer_name: string | null;
  messages: ConversationMessage[];
  status: ConversationStatus;
  appointment_booked: boolean;
  created_at: string;
  updated_at: string;
}

export interface Appointment {
  id: string;
  business_id: string;
  conversation_id: string;
  customer_phone: string;
  customer_name: string;
  service_type: string;
  address: string;
  scheduled_time: string;  // ISO 8601
  end_time: string;        // ISO 8601
  google_event_id: string | null;
  confirmed: boolean;
  notes: string | null;
  price_range: string | null;
  created_at: string;
}

// Returned from OpenAI function call when booking is ready
export interface BookingDetails {
  customer_name: string;
  service_type: string;
  address: string;
  scheduled_time_iso: string;
  duration_minutes: number;
  notes?: string;
  price_range?: string;
}

// Twilio webhook body (inbound SMS)
export interface TwilioSmsWebhookBody {
  MessageSid: string;
  AccountSid: string;
  From: string;       // customer phone
  To: string;         // our twilio number
  Body: string;
  NumMedia?: string;
}

// Twilio voice webhook body (missed call)
export interface TwilioVoiceWebhookBody {
  CallSid: string;
  From: string;
  To: string;
  CallStatus: string;
}

// Used for available time slot calculation
export interface TimeSlot {
  start: Date;
  end: Date;
  label: string; // "tomorrow morning (9am–11am)"
}
