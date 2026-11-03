import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { format } from 'date-fns';
import {
  ChatBubbleLeftRightIcon,
  CalendarDaysIcon,
  BoltIcon,
  BoltSlashIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import Layout from '@/components/Layout';
import AppointmentCard from '@/components/AppointmentCard';
import { api, ApiError, type Appointment, type Conversation } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import clsx from 'clsx';

export default function DashboardPage() {
  const router = useRouter();

  // Auth guard
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) void router.replace('/login');
    });
  }, [router]);

  const { data: bizData, mutate: mutateBiz } = useSWR('/api/businesses/me', () =>
    api.businesses.me().catch((e) => {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    })
  );

  const { data: todayData } = useSWR('/api/appointments/today', () =>
    api.appointments.today()
  );

  const { data: convData } = useSWR('/api/conversations?page=1&limit=5', () =>
    api.conversations.list(1, 5)
  );

  const business = bizData?.business;
  const todayAppts: Appointment[] = todayData?.appointments ?? [];
  const recentConvs: Conversation[] = convData?.conversations ?? [];

  // Show trial warning banner
  const showTrialBanner =
    business?.subscription_status === 'trial' &&
    new Date(business.trial_ends_at) > new Date() &&
    (new Date(business.trial_ends_at).getTime() - Date.now()) < 5 * 24 * 60 * 60 * 1000; // < 5 days

  const handleToggleAI = async () => {
    if (!business) return;
    const next = !business.ai_enabled;

    if (next && !['trial', 'active'].includes(business.subscription_status)) {
      toast.error('Your subscription is not active. Please update billing first.');
      return;
    }

    try {
      await api.businesses.update({ ai_enabled: next });
      await mutateBiz();
      toast.success(next ? 'AI enabled: responding to customers' : "AI paused: you're in control");
    } catch {
      toast.error('Failed to update AI status');
    }
  };

  if (!business) {
    return (
      <Layout title="Dashboard — FixedLine">
        <div className="flex items-center justify-center h-full">
          <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Dashboard — FixedLine">
      <div className="p-6 max-w-5xl mx-auto">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Good {getTimeOfDay()}, {business.owner_name.split(' ')[0]}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">{format(new Date(), 'EEEE, MMMM d')}</p>
          </div>

          {/* AI toggle */}
          <button
            onClick={() => void handleToggleAI()}
            className={clsx(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border',
              business.ai_enabled
                ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
            )}
          >
            {business.ai_enabled ? (
              <><BoltIcon className="w-4 h-4" /> AI On</>
            ) : (
              <><BoltSlashIcon className="w-4 h-4" /> AI Off</>
            )}
          </button>
        </div>

        {/* Trial warning banner */}
        {showTrialBanner && (
          <div className="flex items-center gap-3 p-4 mb-6 bg-amber-50 border border-amber-200 rounded-xl">
            <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-800">
              Your free trial ends on{' '}
              <strong>{format(new Date(business.trial_ends_at), 'MMMM d')}</strong>.{' '}
              <button
                onClick={() => void handleUpgrade()}
                className="underline font-medium"
              >
                Add a card to keep AI running
              </button>
            </p>
          </div>
        )}

        {/* Subscription paused banner */}
        {['past_due', 'paused', 'cancelled'].includes(business.subscription_status) && (
          <div className="flex items-center gap-3 p-4 mb-6 bg-red-50 border border-red-200 rounded-xl">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-600 flex-shrink-0" />
            <p className="text-sm text-red-800">
              AI is paused — your subscription needs attention.{' '}
              <button
                onClick={() => void handleUpgrade()}
                className="underline font-medium"
              >
                Fix billing
              </button>
            </p>
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <StatCard
            label="Today's jobs"
            value={String(todayAppts.length)}
            icon={<CalendarDaysIcon className="w-5 h-5 text-brand-600" />}
            bg="bg-brand-50"
          />
          <StatCard
            label="Open conversations"
            value={String(recentConvs.filter(c => c.status === 'active').length)}
            icon={<ChatBubbleLeftRightIcon className="w-5 h-5 text-green-600" />}
            bg="bg-green-50"
          />
          <StatCard
            label="AI status"
            value={business.ai_enabled ? 'Active' : 'Paused'}
            icon={<BoltIcon className={clsx('w-5 h-5', business.ai_enabled ? 'text-green-600' : 'text-gray-400')} />}
            bg={business.ai_enabled ? 'bg-green-50' : 'bg-gray-50'}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Today's appointments */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-900">Today&apos;s appointments</h2>
              <a href="/dashboard" className="text-xs text-brand-600 hover:underline">View all</a>
            </div>
            {todayAppts.length === 0 ? (
              <div className="card p-6 text-center">
                <CalendarDaysIcon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No appointments today</p>
              </div>
            ) : (
              <div className="space-y-3">
                {todayAppts.map(appt => (
                  <AppointmentCard key={appt.id} appointment={appt} />
                ))}
              </div>
            )}
          </section>

          {/* Recent conversations */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-900">Recent conversations</h2>
              <a href="/conversations" className="text-xs text-brand-600 hover:underline">View all</a>
            </div>
            {recentConvs.length === 0 ? (
              <div className="card p-6 text-center">
                <ChatBubbleLeftRightIcon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No conversations yet</p>
                <p className="text-xs text-gray-400 mt-1">
                  Customers will appear here when they text your number
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentConvs.map(conv => (
                  <ConversationRow key={conv.id} conversation={conv} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </Layout>
  );

  async function handleUpgrade() {
    try {
      const { checkout_url } = await api.businesses.checkoutUrl();
      window.location.href = checkout_url;
    } catch {
      toast.error('Failed to open billing page');
    }
  }
}

function StatCard({
  label, value, icon, bg,
}: {
  label: string; value: string; icon: React.ReactNode; bg: string;
}) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className={clsx('flex items-center justify-center w-10 h-10 rounded-lg', bg)}>
        {icon}
      </div>
      <div>
        <p className="text-xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </div>
  );
}

function ConversationRow({ conversation }: { conversation: Conversation }) {
  const lastMsg = conversation.messages[conversation.messages.length - 1];
  const statusColors = {
    active: 'bg-green-400',
    booked: 'bg-brand-400',
    closed: 'bg-gray-300',
    human_takeover: 'bg-yellow-400',
  } as const;

  return (
    <a
      href={`/conversations/${conversation.id}`}
      className="flex items-center gap-3 p-3 card hover:bg-gray-50 transition-colors"
    >
      <span
        className={clsx(
          'w-2 h-2 rounded-full flex-shrink-0',
          statusColors[conversation.status] ?? 'bg-gray-300'
        )}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {conversation.customer_name ?? conversation.customer_phone}
        </p>
        <p className="text-xs text-gray-500 truncate">
          {lastMsg?.content ?? 'No messages'}
        </p>
      </div>
      <span className="text-xs text-gray-400 flex-shrink-0">
        {format(new Date(conversation.updated_at), 'h:mm a')}
      </span>
    </a>
  );
}

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}
