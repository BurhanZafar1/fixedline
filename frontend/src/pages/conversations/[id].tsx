import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import Layout from '@/components/Layout';
import ConversationView from '@/components/ConversationView';
import AppointmentCard from '@/components/AppointmentCard';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';

export default function ConversationDetailPage() {
  const router = useRouter();
  const { id } = router.query as { id?: string };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) void router.replace('/login');
    });
  }, [router]);

  const { data, mutate, isLoading } = useSWR(
    id ? `/api/conversations/${id}` : null,
    () => api.conversations.get(id!)
  );

  // Fetch appointments linked to this customer/conversation
  const { data: apptData } = useSWR(
    data?.conversation ? `/api/appointments?from=2020-01-01` : null,
    () => api.appointments.list()
  );

  const conversation = data?.conversation;
  const linkedAppt = apptData?.appointments.find(
    a => a.customer_phone === conversation?.customer_phone
  );

  const handleSendMessage = async (message: string) => {
    if (!id) return;
    try {
      await api.conversations.reply(id, message);
      await mutate();
    } catch {
      toast.error('Failed to send message');
    }
  };

  const handleTakeover = async () => {
    if (!id) return;
    try {
      await api.conversations.takeover(id);
      await mutate();
      toast.success('You\'re now in control of this conversation');
    } catch {
      toast.error('Failed to take over');
    }
  };

  const handleHandback = async () => {
    if (!id) return;
    try {
      await api.conversations.handback(id);
      await mutate();
      toast.success('AI is back in control');
    } catch {
      toast.error('Failed to hand back');
    }
  };

  if (isLoading) {
    return (
      <Layout title="Conversation — FixedLine">
        <div className="flex items-center justify-center h-full">
          <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!conversation) {
    return (
      <Layout title="Conversation — FixedLine">
        <div className="p-6">
          <p className="text-gray-600">Conversation not found.</p>
          <a href="/conversations" className="text-brand-600 hover:underline text-sm mt-2 block">
            Back to conversations
          </a>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={`${conversation.customer_name ?? conversation.customer_phone} — FixedLine`}>
      <div className="p-6 max-w-5xl mx-auto h-[calc(100vh-0px)]">
        {/* Back button */}
        <a
          href="/conversations"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-4 group"
        >
          <ArrowLeftIcon className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          All conversations
        </a>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-140px)]">
          {/* Conversation thread */}
          <div className="lg:col-span-2 h-full">
            <ConversationView
              conversation={conversation}
              onSendMessage={handleSendMessage}
              onTakeover={handleTakeover}
              onHandback={handleHandback}
            />
          </div>

          {/* Sidebar info */}
          <div className="space-y-4">
            {/* Customer info */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Customer</h3>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-gray-400 uppercase tracking-wide">Phone</dt>
                  <dd className="text-gray-900 font-medium">
                    <a href={`tel:${conversation.customer_phone}`} className="hover:text-brand-600">
                      {conversation.customer_phone}
                    </a>
                  </dd>
                </div>
                {conversation.customer_name && (
                  <div>
                    <dt className="text-xs text-gray-400 uppercase tracking-wide">Name</dt>
                    <dd className="text-gray-900 font-medium">{conversation.customer_name}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-gray-400 uppercase tracking-wide">Started</dt>
                  <dd className="text-gray-900">
                    {new Date(conversation.created_at).toLocaleDateString('en-US', {
                      month: 'long', day: 'numeric', year: 'numeric',
                    })}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-400 uppercase tracking-wide">Messages</dt>
                  <dd className="text-gray-900">{conversation.messages.length}</dd>
                </div>
              </dl>
            </div>

            {/* Linked appointment */}
            {linkedAppt && (
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Appointment</h3>
                <AppointmentCard appointment={linkedAppt} />
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
