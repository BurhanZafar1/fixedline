import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import toast from 'react-hot-toast';
import {
  BoltIcon,
  CheckCircleIcon,
  ArrowRightIcon,
} from '@heroicons/react/24/outline';
import { api, type ServiceOffering } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import clsx from 'clsx';

// Default HVAC services so the owner barely has to type anything
const HVAC_DEFAULTS: ServiceOffering[] = [
  { name: 'AC Repair', description: '', price_min: 150, price_max: 500 },
  { name: 'AC Maintenance', description: '', price_min: 89, price_max: 149 },
  { name: 'Furnace Repair', description: '', price_min: 150, price_max: 600 },
  { name: 'Furnace Tune-Up', description: '', price_min: 89, price_max: 149 },
  { name: 'New System Install', description: '', price_min: 3500, price_max: 12000 },
];

const STEPS = [
  { id: 1, label: 'Business info' },
  { id: 2, label: 'Services' },
  { id: 3, label: 'Hours' },
  { id: 4, label: 'Calendar' },
  { id: 5, label: 'Get your number' },
];

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Phoenix', label: 'Arizona (no DST)' },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1 fields
  const [bizName, setBizName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [timezone, setTimezone] = useState('America/New_York');
  const [businessId, setBusinessId] = useState<string | null>(null);

  // Step 2 fields
  const [services, setServices] = useState<ServiceOffering[]>(HVAC_DEFAULTS);

  // Step 3 fields
  const [workingHours, setWorkingHours] = useState<Record<string, { enabled: boolean; start: string; end: string }>>({
    monday: { enabled: true, start: '08:00', end: '18:00' },
    tuesday: { enabled: true, start: '08:00', end: '18:00' },
    wednesday: { enabled: true, start: '08:00', end: '18:00' },
    thursday: { enabled: true, start: '08:00', end: '18:00' },
    friday: { enabled: true, start: '08:00', end: '18:00' },
    saturday: { enabled: false, start: '09:00', end: '13:00' },
    sunday: { enabled: false, start: '09:00', end: '13:00' },
  });

  // Step 5 fields
  const [areaCode, setAreaCode] = useState('');
  const [provisionedNumber, setProvisionedNumber] = useState<string | null>(null);

  // Read query params (e.g., after Google OAuth callback)
  useEffect(() => {
    const urlStep = router.query['step'];
    const calendarConnected = router.query['calendar'];
    const error = router.query['error'];

    if (urlStep) setStep(parseInt(urlStep as string, 10));
    if (calendarConnected === 'connected') {
      toast.success('Google Calendar connected!');
    }
    if (error === 'calendar_denied') {
      toast('Calendar connection skipped — you can connect later in Settings.', { icon: 'ℹ️' });
    }
  }, [router.query]);

  // Auth guard + pre-fill name from existing business
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        void router.replace('/login');
        return;
      }

      // Pre-fill owner name from auth metadata
      const user = session.user;
      if (user.user_metadata?.['name'] && !ownerName) {
        setOwnerName(user.user_metadata['name'] as string);
      }

      // Check if business already exists (resuming onboarding)
      try {
        const { business } = await api.businesses.me();
        if (business.onboarding_complete) {
          void router.replace('/dashboard');
          return;
        }
        setBusinessId(business.id);
        setBizName(business.name || bizName);
        setOwnerName(business.owner_name || ownerName);
        setPhone(business.phone_number || phone);
        setTimezone(business.timezone || timezone);
        if (business.services?.length) setServices(business.services);
        if (business.working_hours) setWorkingHours(business.working_hours);
        if (business.twilio_number) setProvisionedNumber(business.twilio_number);
      } catch {
        // No business yet — stay at step 1
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Step handlers ─────────────────────────────────────────────

  const handleStep1 = async () => {
    if (!bizName.trim() || !ownerName.trim() || !phone.trim()) {
      toast.error('Please fill in all fields');
      return;
    }
    if (!/^\+1\d{10}$/.test(phone)) {
      toast.error('Phone must be in format +12025551234');
      return;
    }
    setLoading(true);
    try {
      if (businessId) {
        await api.businesses.update({ name: bizName, owner_name: ownerName, phone_number: phone, timezone });
      } else {
        const { business } = await api.businesses.create({
          name: bizName,
          owner_name: ownerName,
          phone_number: phone,
          timezone,
        });
        setBusinessId(business.id);
      }
      setStep(2);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setLoading(false);
    }
  };

  const handleStep2 = async () => {
    const valid = services.every(s => s.name.trim());
    if (!valid) {
      toast.error('Please give each service a name');
      return;
    }
    setLoading(true);
    try {
      await api.businesses.update({ services });
      setStep(3);
    } catch {
      toast.error('Failed to save services');
    } finally {
      setLoading(false);
    }
  };

  const handleStep3 = async () => {
    setLoading(true);
    try {
      await api.businesses.update({ working_hours: workingHours });
      setStep(4);
    } catch {
      toast.error('Failed to save hours');
    } finally {
      setLoading(false);
    }
  };

  const handleCalendarConnect = async () => {
    try {
      const { auth_url } = await api.businesses.calendarAuthUrl();
      window.location.href = auth_url;
    } catch {
      toast.error('Failed to start Google Calendar connection');
    }
  };

  const handleStep5 = async () => {
    if (!areaCode || !/^\d{3}$/.test(areaCode)) {
      toast.error('Enter a 3-digit area code');
      return;
    }
    setLoading(true);
    try {
      const { phone_number } = await api.businesses.provisionNumber(areaCode);
      setProvisionedNumber(phone_number);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to provision number');
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      await api.businesses.completeOnboarding();
      toast.success('You\'re all set! Welcome to FixedLine 🎉');
      void router.push('/dashboard');
    } catch {
      toast.error('Failed to complete setup');
    } finally {
      setLoading(false);
    }
  };

  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const DAY_LABELS: Record<string, string> = {
    monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
    friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
  };

  return (
    <>
      <Head>
        <title>Set up FixedLine</title>
      </Head>
      <div className="min-h-screen bg-gray-50 px-4 py-10">
        <div className="max-w-lg mx-auto">
          {/* Logo */}
          <div className="flex items-center gap-2 mb-8">
            <div className="flex items-center justify-center w-8 h-8 bg-brand-600 rounded-lg">
              <BoltIcon className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">FixedLine</span>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-1 mb-8">
            {STEPS.map((s, i) => (
              <React.Fragment key={s.id}>
                <div className="flex items-center gap-1.5">
                  <div
                    className={clsx(
                      'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
                      step > s.id
                        ? 'bg-green-500 text-white'
                        : step === s.id
                        ? 'bg-brand-600 text-white'
                        : 'bg-gray-200 text-gray-500'
                    )}
                  >
                    {step > s.id ? <CheckCircleIcon className="w-4 h-4" /> : s.id}
                  </div>
                  <span
                    className={clsx(
                      'text-xs font-medium hidden sm:block',
                      step === s.id ? 'text-gray-900' : 'text-gray-400'
                    )}
                  >
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={clsx('flex-1 h-0.5 mx-1', step > s.id ? 'bg-green-400' : 'bg-gray-200')} />
                )}
              </React.Fragment>
            ))}
          </div>

          <div className="card p-6">
            {/* ── Step 1: Business info ── */}
            {step === 1 && (
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-1">Tell us about your business</h2>
                <p className="text-sm text-gray-500 mb-5">Takes about 2 minutes.</p>
                <div className="space-y-4">
                  <div>
                    <label className="label">Business name</label>
                    <input
                      className="input"
                      value={bizName}
                      onChange={e => setBizName(e.target.value)}
                      placeholder="Smith HVAC Services"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="label">Your name</label>
                    <input
                      className="input"
                      value={ownerName}
                      onChange={e => setOwnerName(e.target.value)}
                      placeholder="John Smith"
                    />
                  </div>
                  <div>
                    <label className="label">Your cell phone (for job notifications)</label>
                    <input
                      className="input"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="+12025551234"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      We&apos;ll text you when a new job is booked. Format: +1 then 10 digits.
                    </p>
                  </div>
                  <div>
                    <label className="label">Your timezone</label>
                    <select className="input" value={timezone} onChange={e => setTimezone(e.target.value)}>
                      {TIMEZONES.map(tz => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  onClick={() => void handleStep1()}
                  disabled={loading}
                  className="btn-primary w-full mt-6 py-3"
                >
                  {loading ? 'Saving…' : 'Next →'}
                </button>
              </div>
            )}

            {/* ── Step 2: Services ── */}
            {step === 2 && (
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-1">Your services & pricing</h2>
                <p className="text-sm text-gray-500 mb-5">
                  We&apos;ve pre-filled common HVAC services — adjust the prices and remove what you don&apos;t offer.
                </p>
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {services.map((svc, i) => (
                    <div key={i} className="flex gap-2 items-end">
                      <div className="flex-1">
                        {i === 0 && <label className="label">Service</label>}
                        <input
                          className="input text-sm"
                          value={svc.name}
                          onChange={e => setServices(prev =>
                            prev.map((s, idx) => idx === i ? { ...s, name: e.target.value } : s)
                          )}
                          placeholder="Service name"
                        />
                      </div>
                      <div className="w-20">
                        {i === 0 && <label className="label">Min $</label>}
                        <input
                          className="input text-sm"
                          type="number"
                          min={0}
                          value={svc.price_min}
                          onChange={e => setServices(prev =>
                            prev.map((s, idx) => idx === i ? { ...s, price_min: parseInt(e.target.value, 10) || 0 } : s)
                          )}
                        />
                      </div>
                      <div className="w-20">
                        {i === 0 && <label className="label">Max $</label>}
                        <input
                          className="input text-sm"
                          type="number"
                          min={0}
                          value={svc.price_max}
                          onChange={e => setServices(prev =>
                            prev.map((s, idx) => idx === i ? { ...s, price_max: parseInt(e.target.value, 10) || 0 } : s)
                          )}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setServices(prev => prev.filter((_, idx) => idx !== i))}
                        className="text-red-400 hover:text-red-600 pb-2 flex-shrink-0"
                        aria-label="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setServices(prev => [...prev, { name: '', description: '', price_min: 0, price_max: 0 }])}
                  className="text-sm text-brand-600 hover:underline mt-3 block"
                >
                  + Add another service
                </button>
                <button
                  onClick={() => void handleStep2()}
                  disabled={loading}
                  className="btn-primary w-full mt-6 py-3"
                >
                  {loading ? 'Saving…' : 'Next →'}
                </button>
              </div>
            )}

            {/* ── Step 3: Working hours ── */}
            {step === 3 && (
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-1">When do you work?</h2>
                <p className="text-sm text-gray-500 mb-5">
                  AI will only offer slots during your working hours.
                </p>
                <div className="space-y-2">
                  {DAYS.map(day => {
                    const dh = workingHours[day] ?? { enabled: false, start: '09:00', end: '17:00' };
                    return (
                      <div key={day} className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setWorkingHours(prev => ({
                            ...prev,
                            [day]: { ...dh, enabled: !dh.enabled },
                          }))}
                          className={clsx(
                            'w-16 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0',
                            dh.enabled ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-400'
                          )}
                        >
                          {DAY_LABELS[day]}
                        </button>
                        {dh.enabled ? (
                          <>
                            <input
                              type="time"
                              value={dh.start}
                              onChange={e => setWorkingHours(prev => ({
                                ...prev,
                                [day]: { ...dh, start: e.target.value },
                              }))}
                              className="input w-28 text-sm"
                            />
                            <span className="text-gray-400 text-sm">–</span>
                            <input
                              type="time"
                              value={dh.end}
                              onChange={e => setWorkingHours(prev => ({
                                ...prev,
                                [day]: { ...dh, end: e.target.value },
                              }))}
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
                <button
                  onClick={() => void handleStep3()}
                  disabled={loading}
                  className="btn-primary w-full mt-6 py-3"
                >
                  {loading ? 'Saving…' : 'Next →'}
                </button>
              </div>
            )}

            {/* ── Step 4: Google Calendar ── */}
            {step === 4 && (
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-1">Connect your calendar</h2>
                <p className="text-sm text-gray-500 mb-5">
                  Bookings will appear automatically in Google Calendar — no manual entry needed.
                </p>
                <div className="border border-gray-200 rounded-xl p-4 mb-5 bg-gray-50">
                  <p className="text-sm text-gray-700 font-medium mb-2">What happens when you connect:</p>
                  <ul className="text-sm text-gray-600 space-y-1.5">
                    {[
                      'New appointments auto-appear in your calendar',
                      'AI checks your calendar before offering time slots',
                      'You get a Google Calendar reminder 1 hour before each job',
                    ].map(item => (
                      <li key={item} className="flex items-center gap-2">
                        <CheckCircleIcon className="w-4 h-4 text-green-500 flex-shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <button
                  onClick={() => void handleCalendarConnect()}
                  className="btn-primary w-full py-3 mb-3"
                >
                  Connect Google Calendar
                </button>
                <button
                  onClick={() => setStep(5)}
                  className="w-full text-center text-sm text-gray-400 hover:text-gray-600"
                >
                  Skip for now →
                </button>
              </div>
            )}

            {/* ── Step 5: Phone number ── */}
            {step === 5 && (
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-1">Get your FixedLine number</h2>
                <p className="text-sm text-gray-500 mb-5">
                  This is the number customers will text. Pick a local area code.
                </p>

                {provisionedNumber ? (
                  <div>
                    <div className="text-center py-6">
                      <CheckCircleIcon className="w-12 h-12 text-green-500 mx-auto mb-3" />
                      <p className="text-2xl font-bold font-mono text-gray-900">{provisionedNumber}</p>
                      <p className="text-sm text-gray-500 mt-2">Your FixedLine number is ready!</p>
                    </div>
                    <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 mb-4 text-sm text-brand-800">
                      <p className="font-medium mb-1">To use your existing number:</p>
                      <p>Call your carrier and ask them to forward calls and texts from your current number to <strong>{provisionedNumber}</strong>. This usually takes under 10 minutes.</p>
                    </div>
                    <button
                      onClick={() => void handleComplete()}
                      disabled={loading}
                      className="btn-primary w-full py-3"
                    >
                      {loading ? 'Setting up…' : "I'm ready — go to dashboard"}
                      <ArrowRightIcon className="w-4 h-4 ml-2" />
                    </button>
                  </div>
                ) : (
                  <div>
                    <div>
                      <label className="label">Area code</label>
                      <input
                        className="input text-xl font-mono tracking-widest"
                        value={areaCode}
                        onChange={e => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
                        placeholder="202"
                        maxLength={3}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        Enter the area code for your city (e.g., 312 for Chicago, 310 for LA)
                      </p>
                    </div>
                    <button
                      onClick={() => void handleStep5()}
                      disabled={loading || areaCode.length !== 3}
                      className="btn-primary w-full mt-4 py-3"
                    >
                      {loading ? 'Finding a number…' : 'Get my number'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
