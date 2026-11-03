import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import toast from 'react-hot-toast';
import {
  PhoneIcon,
  CalendarDaysIcon,
  CreditCardIcon,
  UserIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import Layout from '@/components/Layout';
import { api, type ServiceOffering, type WorkingHours } from '@/lib/api';
import { supabase } from '@/lib/supabase';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DEFAULT_HOURS: WorkingHours = {
  monday: { enabled: true, start: '08:00', end: '18:00' },
  tuesday: { enabled: true, start: '08:00', end: '18:00' },
  wednesday: { enabled: true, start: '08:00', end: '18:00' },
  thursday: { enabled: true, start: '08:00', end: '18:00' },
  friday: { enabled: true, start: '08:00', end: '18:00' },
  saturday: { enabled: false, start: '09:00', end: '13:00' },
  sunday: { enabled: false, start: '09:00', end: '13:00' },
};
const DAY_LABELS: Record<string, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
  friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
};

export default function SettingsPage() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) void router.replace('/login');
    });
  }, [router]);

  const { data, mutate } = useSWR('/api/businesses/me', () => api.businesses.me());
  const business = data?.business;

  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [timezone, setTimezone] = useState('America/New_York');
  const [services, setServices] = useState<ServiceOffering[]>([]);
  const [workingHours, setWorkingHours] = useState<WorkingHours>(DEFAULT_HOURS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (business) {
      setName(business.name);
      setOwnerName(business.owner_name);
      setPhone(business.phone_number);
      setTimezone(business.timezone);
      setServices(business.services ?? []);
      setWorkingHours({ ...DEFAULT_HOURS, ...(business.working_hours ?? {}) });
    }
  }, [business]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.businesses.update({
        name,
        owner_name: ownerName,
        phone_number: phone,
        timezone,
        services,
        working_hours: workingHours,
      });
      await mutate();
      toast.success('Settings saved');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const addService = () => {
    setServices(prev => [
      ...prev,
      { name: '', description: '', price_min: 0, price_max: 0 },
    ]);
  };

  const removeService = (i: number) => {
    setServices(prev => prev.filter((_, idx) => idx !== i));
  };

  const updateService = (i: number, field: keyof ServiceOffering, value: string | number) => {
    setServices(prev =>
      prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s))
    );
  };

  const toggleDay = (day: string) => {
    setWorkingHours(prev => ({
      ...prev,
      [day]: { ...(prev[day] ?? { start: '09:00', end: '17:00' }), enabled: !prev[day]?.enabled },
    }));
  };

  const updateHours = (day: string, field: 'start' | 'end', value: string) => {
    setWorkingHours(prev => ({
      ...prev,
      [day]: { ...(prev[day] ?? { enabled: true, start: '09:00', end: '17:00' }), [field]: value },
    }));
  };

  const handleConnectCalendar = async () => {
    try {
      const { auth_url } = await api.businesses.calendarAuthUrl();
      window.location.href = auth_url;
    } catch {
      toast.error('Failed to start calendar connection');
    }
  };

  const handleDisconnectCalendar = async () => {
    if (!confirm('Disconnect Google Calendar? Appointments will still be saved but not added to your calendar.')) return;
    try {
      await api.businesses.disconnectCalendar();
      await mutate();
      toast.success('Calendar disconnected');
    } catch {
      toast.error('Failed to disconnect calendar');
    }
  };

  const handleBillingPortal = async () => {
    try {
      const { portal_url } = await api.businesses.billingPortalUrl();
      window.location.href = portal_url;
    } catch {
      toast.error('Failed to open billing portal');
    }
  };

  if (!business) {
    return (
      <Layout title="Settings — FixedLine">
        <div className="flex items-center justify-center h-full">
          <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Settings — FixedLine">
      <div className="p-6 max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

        <form onSubmit={(e) => void handleSave(e)} className="space-y-6">
          {/* Business info */}
          <section className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <UserIcon className="w-5 h-5 text-gray-500" />
              <h2 className="text-base font-semibold text-gray-900">Business info</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Business name</label>
                <input className="input" value={name} onChange={e => setName(e.target.value)} required />
              </div>
              <div>
                <label className="label">Your name</label>
                <input className="input" value={ownerName} onChange={e => setOwnerName(e.target.value)} required />
              </div>
              <div>
                <label className="label">Your cell number (for job notifications)</label>
                <input
                  className="input"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+12025550123"
                  required
                />
              </div>
              <div>
                <label className="label">Timezone</label>
                <select className="input" value={timezone} onChange={e => setTimezone(e.target.value)}>
                  <option value="America/New_York">Eastern</option>
                  <option value="America/Chicago">Central</option>
                  <option value="America/Denver">Mountain</option>
                  <option value="America/Los_Angeles">Pacific</option>
                  <option value="America/Phoenix">Arizona</option>
                </select>
              </div>
            </div>
          </section>

          {/* Services */}
          <section className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <WrenchScrewdriverIcon className="w-5 h-5 text-gray-500" />
                <h2 className="text-base font-semibold text-gray-900">Services & pricing</h2>
              </div>
              <button type="button" onClick={addService} className="btn-secondary text-xs py-1">
                + Add service
              </button>
            </div>
            <div className="space-y-3">
              {services.length === 0 && (
                <p className="text-sm text-gray-400">No services added yet.</p>
              )}
              {services.map((svc, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-4">
                    {i === 0 && <label className="label">Service name</label>}
                    <input
                      className="input"
                      placeholder="AC repair"
                      value={svc.name}
                      onChange={e => updateService(i, 'name', e.target.value)}
                    />
                  </div>
                  <div className="col-span-3">
                    {i === 0 && <label className="label">Min price ($)</label>}
                    <input
                      className="input"
                      type="number"
                      min={0}
                      value={svc.price_min}
                      onChange={e => updateService(i, 'price_min', parseInt(e.target.value, 10) || 0)}
                    />
                  </div>
                  <div className="col-span-3">
                    {i === 0 && <label className="label">Max price ($)</label>}
                    <input
                      className="input"
                      type="number"
                      min={0}
                      value={svc.price_max}
                      onChange={e => updateService(i, 'price_max', parseInt(e.target.value, 10) || 0)}
                    />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <div className="label">&nbsp;</div>}
                    <button
                      type="button"
                      onClick={() => removeService(i)}
                      className="w-full btn-secondary text-red-500 border-red-200 hover:bg-red-50 text-xs py-2"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Working hours */}
          <section className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <PhoneIcon className="w-5 h-5 text-gray-500" />
              <h2 className="text-base font-semibold text-gray-900">Working hours</h2>
            </div>
            <div className="space-y-2">
              {DAYS.map(day => {
                const dh = workingHours[day] ?? { enabled: false, start: '09:00', end: '17:00' };
                return (
                  <div key={day} className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={`w-16 py-1 rounded text-xs font-medium transition-colors ${
                        dh.enabled ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {DAY_LABELS[day]}
                    </button>
                    {dh.enabled ? (
                      <>
                        <input
                          type="time"
                          value={dh.start}
                          onChange={e => updateHours(day, 'start', e.target.value)}
                          className="input w-28 text-sm"
                        />
                        <span className="text-gray-400 text-sm">to</span>
                        <input
                          type="time"
                          value={dh.end}
                          onChange={e => updateHours(day, 'end', e.target.value)}
                          className="input w-28 text-sm"
                        />
                      </>
                    ) : (
                      <span className="text-sm text-gray-400">Closed</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <div className="flex justify-end">
            <button type="submit" className="btn-primary px-6" disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>

        {/* Calendar integration */}
        <section className="card p-5 mt-6">
          <div className="flex items-center gap-2 mb-4">
            <CalendarDaysIcon className="w-5 h-5 text-gray-500" />
            <h2 className="text-base font-semibold text-gray-900">Google Calendar</h2>
          </div>
          {business.google_calendar_connected ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg">
                ✓ Calendar connected — appointments auto-sync
              </p>
              <button
                onClick={() => void handleDisconnectCalendar()}
                className="btn-secondary text-red-500 border-red-200 hover:bg-red-50 text-sm"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">Connect your Google Calendar so bookings appear automatically.</p>
              <button onClick={() => void handleConnectCalendar()} className="btn-primary text-sm">
                Connect Google Calendar
              </button>
            </div>
          )}
        </section>

        {/* Phone number */}
        <section className="card p-5 mt-4">
          <div className="flex items-center gap-2 mb-2">
            <PhoneIcon className="w-5 h-5 text-gray-500" />
            <h2 className="text-base font-semibold text-gray-900">Your FixedLine number</h2>
          </div>
          {business.twilio_number ? (
            <div>
              <p className="text-lg font-mono font-bold text-gray-900">{business.twilio_number}</p>
              <p className="text-xs text-gray-500 mt-1">
                Forward your existing business number to this number, or share it directly with customers.
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No number provisioned yet. Complete onboarding to get your number.</p>
          )}
        </section>

        {/* Billing */}
        <section className="card p-5 mt-4">
          <div className="flex items-center gap-2 mb-4">
            <CreditCardIcon className="w-5 h-5 text-gray-500" />
            <h2 className="text-base font-semibold text-gray-900">Billing</h2>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">
                Solo Plan · $79/month
              </p>
              <p className="text-xs text-gray-500 mt-0.5 capitalize">
                Status: {business.subscription_status.replace('_', ' ')}
              </p>
            </div>
            <button onClick={() => void handleBillingPortal()} className="btn-secondary text-sm">
              Manage billing
            </button>
          </div>
        </section>
      </div>
    </Layout>
  );
}
