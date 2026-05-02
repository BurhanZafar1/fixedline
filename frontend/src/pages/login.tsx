import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import toast from 'react-hot-toast';
import { BoltIcon } from '@heroicons/react/24/outline';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';

type Mode = 'login' | 'signup';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    try {
      if (mode === 'signup') {
        // Create account via backend (handles Stripe customer creation)
        await api.auth.signup(email.trim(), password, name.trim());
        toast.success('Account created! Signing you in…');
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        toast.error(error.message === 'Invalid login credentials'
          ? 'Incorrect email or password'
          : error.message
        );
        return;
      }

      // Redirect to onboarding if new user, otherwise dashboard
      if (mode === 'signup') {
        void router.push('/onboarding');
      } else {
        void router.push('/dashboard');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>{mode === 'login' ? 'Sign in' : 'Create account'} — FixedLine</title>
      </Head>
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="flex justify-center mb-8">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-10 h-10 bg-brand-600 rounded-xl">
                <BoltIcon className="w-6 h-6 text-white" />
              </div>
              <span className="text-2xl font-bold text-gray-900">FixedLine</span>
            </div>
          </div>

          <div className="card p-8">
            <h1 className="text-xl font-semibold text-gray-900 mb-1">
              {mode === 'login' ? 'Welcome back' : 'Start your free trial'}
            </h1>
            <p className="text-sm text-gray-500 mb-6">
              {mode === 'login'
                ? 'Sign in to your FixedLine account'
                : '14 days free — no credit card required'}
            </p>

            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              {mode === 'signup' && (
                <div>
                  <label htmlFor="name" className="label">Your name</label>
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="input"
                    placeholder="John Smith"
                    required
                    autoComplete="name"
                  />
                </div>
              )}

              <div>
                <label htmlFor="email" className="label">Email address</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input"
                  placeholder="john@smithhvac.com"
                  required
                  autoComplete="email"
                />
              </div>

              <div>
                <label htmlFor="password" className="label">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                  placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
                  required
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  minLength={mode === 'signup' ? 8 : undefined}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-2.5"
              >
                {loading
                  ? 'Please wait…'
                  : mode === 'login'
                  ? 'Sign in'
                  : 'Create account'}
              </button>
            </form>

            <p className="text-center text-sm text-gray-500 mt-5">
              {mode === 'login' ? (
                <>
                  Don&apos;t have an account?{' '}
                  <button
                    className="text-brand-600 font-medium hover:underline"
                    onClick={() => setMode('signup')}
                  >
                    Start free trial
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button
                    className="text-brand-600 font-medium hover:underline"
                    onClick={() => setMode('login')}
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>
          </div>

          <p className="text-center text-xs text-gray-400 mt-6">
            $79/month after trial · Cancel anytime
          </p>
        </div>
      </div>
    </>
  );
}
