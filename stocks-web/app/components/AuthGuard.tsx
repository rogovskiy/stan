'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/app/lib/authContext';

export default function AuthGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Routes that don't require authentication
  const publicRoutes = ['/login'];

  const isPublicRoute = publicRoutes.includes(pathname);

  useEffect(() => {
    if (!loading) {
      // If user is not authenticated and trying to access a protected route
      if (!user && !isPublicRoute) {
        router.push('/login');
      }
      // If user is authenticated and trying to access login page, redirect to home
      if (user && pathname === '/login') {
        router.push('/');
      }
    }
  }, [user, loading, isPublicRoute, pathname, router]);

  // Show loading state while checking authentication
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // If not authenticated and trying to access protected route, show nothing (will redirect)
  if (!user && !isPublicRoute) {
    return null;
  }

  // If authenticated and on login page, show nothing (will redirect)
  if (user && pathname === '/login') {
    return null;
  }

  return <>{children}</>;
}
