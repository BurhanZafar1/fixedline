import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  ChatBubbleLeftRightIcon,
  CalendarDaysIcon,
  Cog6ToothIcon,
  ArrowRightOnRectangleIcon,
  Bars3Icon,
  XMarkIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '@/lib/supabase';
import clsx from 'clsx';

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: CalendarDaysIcon },
  { href: '/conversations', label: 'Conversations', icon: ChatBubbleLeftRightIcon },
  { href: '/settings', label: 'Settings', icon: Cog6ToothIcon },
];

export default function Sidebar() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    void router.push('/login');
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-2 px-6 py-5 border-b border-gray-200">
        <div className="flex items-center justify-center w-8 h-8 bg-brand-600 rounded-lg">
          <BoltIcon className="w-5 h-5 text-white" />
        </div>
        <span className="text-lg font-bold text-gray-900">FixedLine</span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = router.pathname === href || router.pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                active
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Sign out */}
      <div className="px-3 py-4 border-t border-gray-200">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 w-full px-3 py-2.5 text-sm font-medium text-gray-600 rounded-lg hover:bg-gray-100 hover:text-gray-900 transition-colors"
        >
          <ArrowRightOnRectangleIcon className="w-5 h-5" />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col w-56 bg-white border-r border-gray-200 flex-shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile: hamburger button */}
      <button
        className="md:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-lg border border-gray-200 shadow-sm"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
      >
        <Bars3Icon className="w-5 h-5 text-gray-600" />
      </button>

      {/* Mobile: drawer overlay */}
      {open && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="fixed inset-0 bg-black/30"
            onClick={() => setOpen(false)}
          />
          <aside className="relative flex flex-col w-64 bg-white shadow-xl">
            <button
              className="absolute top-4 right-4 p-1 text-gray-500 hover:text-gray-700"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}
    </>
  );
}
