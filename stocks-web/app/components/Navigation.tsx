'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Navigation() {
  const pathname = usePathname();

  const navItems = [
    { href: '/', label: 'Value' },
    { href: '/kpi', label: 'KPI' },
  ];

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="w-full max-w-none px-6 py-3">
        <div className="flex items-center gap-8">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`pb-2 px-1 border-b-2 transition-colors font-semibold text-base ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
