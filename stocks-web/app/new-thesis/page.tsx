import { Suspense } from 'react';
import NewThesisOnboardingPage from '@/app/components/position-thesis/NewThesisOnboardingPage';

export default function NewThesisPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-600">
          Loading…
        </div>
      }
    >
      <NewThesisOnboardingPage />
    </Suspense>
  );
}
