import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '@/lib/supabase';

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        void router.replace('/dashboard');
      } else {
        void router.replace('/login');
      }
    });
  }, [router]);

  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
