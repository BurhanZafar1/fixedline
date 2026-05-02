import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { format } from 'date-fns';
import {
  ChatBubbleLeftRightIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import Layout from '@/components/Layout';
import { api, type Conversation } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import clsx from 'clsx';

type FilterStatus = 'all' | 'active' | 'booked' | 'human_takeover' | 'closed';

export default function ConversationsPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) void router.replace('/login');
    });
  }, [router]);

  const { data, mutate } = useSWR(
    ['/api/conversations', page],
    () => api.conversations.list(page, 50)
  );

  const conversations: Conversation[] = data?.conversations ?? [];
  const total = data?.total ?? 0;

  const filtered = conversations.filter(conv => {
    if (filter !== 'all' && conv.status !== filter) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        conv.customer_phone.includes(s) ||
        (conv.customer_name ?? '').toLowerCase().includes(s)
      );
    }
    return true;
  });

  const handleTakeover = async (id: string) => {
    try {
      await api.conversations.takeover(id);
      await mutate();
      toast.success('You\'re now in control of this conversation');
    } catch {
      toast.error('Failed to take over conversation');
    }
  };

  const filterOptions: { value: FilterStatus; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'booked', label: 'Booked' },
    { value: 'human_takeover', label: 'Needs you' },
    { value: 'closed', label: 'Closed' },
  ];

  return (
    <Layout title="Conversations — FixedLine">
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Conversations</h1>
            <p className="text-sm text-gray-500 mt-0.5">{total} total</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or phone…"
              className="input pl-9"
            />
          </div>
          <div className="flex gap-1">
            {filterOptions.map(opt => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  filter === opt.value
                    ? 'bg-brand-600 text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="card p-12 text-center">
            <ChatBubbleLeftRightIcon className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-600">No conversations found</p>
            <p className="text-xs text-gray-400 mt-1">
              Customers will appear here when they text your number
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(conv => (
              <ConversationListItem
                key={conv.id}
                conversation={conv}
                onTakeover={() => void handleTakeover(conv.id)}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {total > 50 && (
          <div className="flex justify-center gap-2 mt-6">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-secondary"
            >
              Previous
            </button>
            <span className="px-3 py-2 text-sm text-gray-600">
              Page {page} of {Math.ceil(total / 50)}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= Math.ceil(total / 50)}
              className="btn-secondary"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}

function ConversationListItem({
  conversation,
  onTakeover,
}: {
  conversation: Conversation;
  onTakeover: () => void;
}) {
  const lastMsg = conversation.messages[conversation.messages.length - 1];

  const statusConfig = {
    active: { label: 'AI Active', dot: 'bg-green-400' },
    booked: { label: 'Booked ✓', dot: 'bg-brand-500' },
    closed: { label: 'Closed', dot: 'bg-gray-300' },
    human_takeover: { label: 'Needs you', dot: 'bg-yellow-400' },
  } as const;

  const config = statusConfig[conversation.status] ?? statusConfig.active;

  return (
    <div className="card p-4 hover:border-gray-300 transition-colors">
      <div className="flex items-start gap-3">
        <span className={clsx('w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0', config.dot)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <a
              href={`/conversations/${conversation.id}`}
              className="text-sm font-semibold text-gray-900 hover:text-brand-600 truncate"
            >
              {conversation.customer_name ?? conversation.customer_phone}
            </a>
            <span className="text-xs text-gray-400 flex-shrink-0">
              {format(new Date(conversation.updated_at), 'MMM d, h:mm a')}
            </span>
          </div>
          {conversation.customer_name && (
            <p className="text-xs text-gray-400">{conversation.customer_phone}</p>
          )}
          {lastMsg && (
            <p className="text-sm text-gray-600 mt-1 truncate">
              <span className="text-gray-400">
                {lastMsg.role === 'customer' ? 'Customer' : 'AI'}: {' '}
              </span>
              {lastMsg.content}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {config.label}
          </span>
          <a
            href={`/conversations/${conversation.id}`}
            className="btn-secondary text-xs py-1 px-2.5"
          >
            View
          </a>
          {conversation.status === 'active' && (
            <button
              onClick={onTakeover}
              className="text-xs py-1 px-2.5 bg-yellow-100 text-yellow-700 rounded-lg hover:bg-yellow-200 transition-colors font-medium"
            >
              Take over
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
