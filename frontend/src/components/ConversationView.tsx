import React, { useRef, useEffect, useState } from 'react';
import { format } from 'date-fns';
import clsx from 'clsx';
import type { Conversation, ConversationMessage } from '@/lib/api';

interface ConversationViewProps {
  conversation: Conversation;
  onSendMessage?: (message: string) => Promise<void>;
  onTakeover?: () => Promise<void>;
  onHandback?: () => Promise<void>;
  isSending?: boolean;
}

export default function ConversationView({
  conversation,
  onSendMessage,
  onTakeover,
  onHandback,
  isSending = false,
}: ConversationViewProps) {
  const [replyText, setReplyText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation.messages]);

  const handleSend = async () => {
    const text = replyText.trim();
    if (!text || isSending || !onSendMessage) return;
    setReplyText('');
    await onSendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const statusConfig = {
    active: { label: 'AI Active', color: 'bg-green-100 text-green-700' },
    booked: { label: 'Booked', color: 'bg-brand-100 text-brand-700' },
    closed: { label: 'Closed', color: 'bg-gray-100 text-gray-600' },
    human_takeover: { label: 'You\'re in control', color: 'bg-yellow-100 text-yellow-700' },
  } as const;

  const statusInfo = statusConfig[conversation.status] ?? statusConfig.active;

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {conversation.customer_name ?? conversation.customer_phone}
          </p>
          {conversation.customer_name && (
            <p className="text-xs text-gray-500">{conversation.customer_phone}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', statusInfo.color)}>
            {statusInfo.label}
          </span>
          {conversation.status === 'active' && onTakeover && (
            <button
              onClick={() => void onTakeover()}
              className="text-xs px-3 py-1 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors font-medium"
            >
              Take over
            </button>
          )}
          {conversation.status === 'human_takeover' && onHandback && (
            <button
              onClick={() => void onHandback()}
              className="text-xs px-3 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
            >
              Hand back to AI
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {conversation.messages.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-8">No messages yet</p>
        )}
        {conversation.messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply box — only show when human has taken over or always for owner */}
      {(conversation.status === 'human_takeover' || conversation.status === 'active') &&
        onSendMessage && (
          <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
            <div className="flex gap-2">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message and press Enter to send..."
                rows={2}
                className="flex-1 input resize-none text-sm"
                disabled={isSending}
              />
              <button
                onClick={() => void handleSend()}
                disabled={!replyText.trim() || isSending}
                className="btn-primary self-end"
              >
                {isSending ? '…' : 'Send'}
              </button>
            </div>
            {conversation.status === 'active' && (
              <p className="text-xs text-gray-400 mt-1">
                Sending a message will not disable AI — use "Take over" to pause it.
              </p>
            )}
          </div>
        )}
    </div>
  );
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  const isCustomer = message.role === 'customer';
  const isHuman = message.role === 'human';

  const timestamp = (() => {
    try {
      return format(new Date(message.timestamp), 'MMM d, h:mm a');
    } catch {
      return '';
    }
  })();

  return (
    <div className={clsx('flex', isCustomer ? 'justify-start' : 'justify-end')}>
      <div className={clsx('max-w-xs lg:max-w-md xl:max-w-lg', isCustomer ? 'items-start' : 'items-end')}>
        <div
          className={clsx(
            'px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed',
            isCustomer
              ? 'bg-gray-100 text-gray-900 rounded-tl-sm'
              : isHuman
              ? 'bg-yellow-500 text-white rounded-tr-sm'
              : 'bg-brand-600 text-white rounded-tr-sm'
          )}
        >
          {message.content}
        </div>
        <div className={clsx('flex items-center gap-1 mt-1', isCustomer ? 'justify-start' : 'justify-end')}>
          <span className="text-[10px] text-gray-400">{timestamp}</span>
          {!isCustomer && (
            <span className="text-[10px] text-gray-400">
              · {isHuman ? 'You' : 'AI'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
