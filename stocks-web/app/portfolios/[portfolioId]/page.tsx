'use client';

import { useParams } from 'next/navigation';
import PortfoliosPageShell from '../../components/PortfoliosPageShell';

export default function PortfolioByIdPage() {
  const params = useParams();
  const portfolioId =
    typeof params?.portfolioId === 'string' ? params.portfolioId : undefined;

  return <PortfoliosPageShell portfolioIdFromRoute={portfolioId} />;
}
