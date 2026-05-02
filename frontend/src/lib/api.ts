import { supabase } from './supabase';

const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, (body as { error?: string }).error ?? 'Request failed');
  }

  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// ──────────────────────────────────────────────────────────────
// Business
// ──────────────────────────────────────────────────────────────
export const api = {
  businesses: {
    me: () => request<{ business: Business }>('/api/businesses/me'),
    create: (data: CreateBusinessData) =>
      request<{ business: Business }>('/api/businesses', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (data: Partial<Business>) =>
      request<{ success: boolean }>('/api/businesses/me', {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    provisionNumber: (areaCode: string) =>
      request<{ phone_number: string }>('/api/businesses/me/provision-number', {
        method: 'POST',
        body: JSON.stringify({ area_code: areaCode }),
      }),
    calendarAuthUrl: () =>
      request<{ auth_url: string }>('/api/businesses/me/calendar/auth'),
    disconnectCalendar: () =>
      request<{ success: boolean }>('/api/businesses/me/calendar', { method: 'DELETE' }),
    checkoutUrl: () =>
      request<{ checkout_url: string }>('/api/businesses/me/billing/checkout', { method: 'POST' }),
    billingPortalUrl: () =>
      request<{ portal_url: string }>('/api/businesses/me/billing/portal', { method: 'POST' }),
    completeOnboarding: () =>
      request<{ success: boolean }>('/api/businesses/me/complete-onboarding', { method: 'POST' }),
  },

  conversations: {
    list: (page = 1, limit = 25) =>
      request<ConversationsResponse>(`/api/conversations?page=${page}&limit=${limit}`),
    get: (id: string) =>
      request<{ conversation: Conversation }>(`/api/conversations/${id}`),
    takeover: (id: string) =>
      request<{ success: boolean }>(`/api/conversations/${id}/takeover`, { method: 'POST' }),
    handback: (id: string) =>
      request<{ success: boolean }>(`/api/conversations/${id}/handback`, { method: 'POST' }),
    reply: (id: string, message: string) =>
      request<{ success: boolean }>(`/api/conversations/${id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      }),
    close: (id: string) =>
      request<{ success: boolean }>(`/api/conversations/${id}/close`, { method: 'PATCH' }),
  },

  appointments: {
    today: () => request<{ appointments: Appointment[] }>('/api/appointments/today'),
    list: (from?: string, to?: string) => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return request<{ appointments: Appointment[] }>(`/api/appointments?${params}`);
    },
    get: (id: string) => request<{ appointment: Appointment }>(`/api/appointments/${id}`),
    update: (id: string, data: Partial<Appointment>) =>
      request<{ success: boolean }>(`/api/appointments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
  },

  auth: {
    signup: (email: string, password: string, name: string) =>
      request<{ user: { id: string; email: string } }>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      }),
  },
};

// ──────────────────────────────────────────────────────────────
// Shared types (mirrors backend types)
// ──────────────────────────────────────────────────────────────
export interface Business {
  id: string;
  name: string;
  owner_name: string;
  owner_email: string;
  phone_number: string;
  twilio_number: string | null;
  services: ServiceOffering[];
  working_hours: WorkingHours;
  timezone: string;
  ai_enabled: boolean;
  onboarding_complete: boolean;
  google_calendar_connected: boolean;
  google_calendar_id: string | null;
  stripe_customer_id: string | null;
  subscription_status: 'trial' | 'active' | 'past_due' | 'paused' | 'cancelled';
  trial_ends_at: string;
  created_at: string;
}

export interface ServiceOffering {
  name: string;
  description: string;
  price_min: number;
  price_max: number;
}

export interface WorkingHours {
  [day: string]: { enabled: boolean; start: string; end: string };
}

export interface ConversationMessage {
  id: string;
  role: 'customer' | 'assistant' | 'human';
  content: string;
  timestamp: string;
}

export interface Conversation {
  id: string;
  business_id: string;
  customer_phone: string;
  customer_name: string | null;
  messages: ConversationMessage[];
  status: 'active' | 'booked' | 'closed' | 'human_takeover';
  appointment_booked: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConversationsResponse {
  conversations: Conversation[];
  total: number;
  page: number;
  limit: number;
}

export interface Appointment {
  id: string;
  business_id: string;
  customer_phone: string;
  customer_name: string;
  service_type: string;
  address: string;
  scheduled_time: string;
  end_time: string;
  confirmed: boolean;
  notes: string | null;
  price_range: string | null;
  created_at: string;
}

export interface CreateBusinessData {
  name: string;
  owner_name: string;
  phone_number: string;
  timezone: string;
}
