'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppNavigation from '../../components/AppNavigation';
import CompanyInfoCard from '../../components/CompanyInfoCard';
import TerminologyPromptEditor from '../../components/TerminologyPromptEditor';

interface KPIDefinition {
  id: string;
  name: string;
  unit?: string;
  multiplier?: string;
  value_type?: string;
  summary?: string;
  source?: string;
  group?: string;
  other_names?: string[];
  semantic_interpretation?: {
    measure_kind?: string;
    subject?: string;
    subject_axis?: string;
    unit_family?: string;
    qualifiers?: Array<{ key: string; value: string }> | Record<string, string>; // Support both array and object formats
  };
}

interface RawKPI {
  name: string;
  value?: {
    number?: number;
    unit?: string;
    multiplier?: string;
  };
  value_type?: string;
  summary?: string;
  source?: string;
  other_names?: string[];
  semantic_interpretation?: {
    measure_kind?: string;
    subject?: string;
    subject_axis?: string;
    unit_family?: string;
    qualifiers?: Array<{ key: string; value: string }> | Record<string, string>; // Support both array and object formats
  };
  definition_id?: string;
  linked_at?: string;
}

interface RawKPIData {
  quarterKey: string;
  fiscal_year?: number;
  fiscal_quarter?: number;
  raw_kpis?: RawKPI[];
  source_documents?: string[];
  num_kpis?: number;
  created_at?: string;
}

export default function KPIMatchPage() {
  const params = useParams();
  const router = useRouter();
  const ticker = (params?.ticker as string) || 'ARMN';
  
  const [kpiDefinitions, setKpiDefinitions] = useState<KPIDefinition[]>([]);
  const [rawKpisData, setRawKpisData] = useState<RawKPIData[]>([]);
  const [selectedQuarter, setSelectedQuarter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filter states
  const [filterMeasureKind, setFilterMeasureKind] = useState<string>('');
  const [filterSubject, setFilterSubject] = useState<string>('');
  const [filterSubjectAxis, setFilterSubjectAxis] = useState<string>('');
  const [filterUnitFamily, setFilterUnitFamily] = useState<string>('');
  const [linkingKpi, setLinkingKpi] = useState<{kpi: RawKPI, quarterKey: string} | null>(null);
  const [showLinkModal, setShowLinkModal] = useState<boolean>(false);

  useEffect(() => {
    fetchData();
  }, [ticker]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Fetch KPI definitions
      const definitionsResponse = await fetch(`/api/kpi-definitions/${ticker}`);
      if (!definitionsResponse.ok) {
        throw new Error('Failed to fetch KPI definitions');
      }
      const definitionsData = await definitionsResponse.json();
      setKpiDefinitions(definitionsData.data || []);

      // Fetch all raw KPIs
      const rawKpisResponse = await fetch(`/api/raw-kpis/${ticker}`);
      if (!rawKpisResponse.ok) {
        throw new Error('Failed to fetch raw KPIs');
      }
      const rawKpisData = await rawKpisResponse.json();
      const quarters = rawKpisData.data || [];
      setRawKpisData(quarters);
      
      // Auto-select the first quarter if available
      if (quarters.length > 0 && !selectedQuarter) {
        setSelectedQuarter(quarters[0].quarterKey);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  const selectedRawKpis = rawKpisData.find(q => q.quarterKey === selectedQuarter);

  // Helper function to normalize qualifiers to object format for comparison
  const normalizeQualifiers = (qualifiers?: Array<{ key: string; value: string }> | Record<string, string>): Record<string, string> => {
    if (!qualifiers) return {};
    if (Array.isArray(qualifiers)) {
      const result: Record<string, string> = {};
      qualifiers.forEach(q => {
        if (q.key && q.value) {
          result[q.key] = q.value;
        }
      });
      return result;
    }
    return qualifiers;
  };

  // Helper function to compare qualifiers
  const qualifiersMatch = (qualifiers1?: Array<{ key: string; value: string }> | Record<string, string>, qualifiers2?: Array<{ key: string; value: string }> | Record<string, string>): boolean => {
    const norm1 = normalizeQualifiers(qualifiers1);
    const norm2 = normalizeQualifiers(qualifiers2);
    
    if (Object.keys(norm1).length === 0 && Object.keys(norm2).length === 0) return true;
    if (Object.keys(norm1).length === 0 || Object.keys(norm2).length === 0) return false;
    
    const keys1 = Object.keys(norm1).sort();
    const keys2 = Object.keys(norm2).sort();
    
    if (keys1.length !== keys2.length) return false;
    
    return keys1.every(key => norm1[key] === norm2[key]);
  };

  // Get linked definition for a raw KPI
  const getLinkedDefinition = (kpi: RawKPI): KPIDefinition | null => {
    if (!kpi.definition_id) return null;
    return kpiDefinitions.find(def => def.id === kpi.definition_id) || null;
  };

  // Get all raw KPIs linked to a definition
  const getLinkedRawKPIs = (definitionId: string): { kpi: RawKPI; quarterKey: string }[] => {
    const linked: { kpi: RawKPI; quarterKey: string }[] = [];
    
    rawKpisData.forEach(quarter => {
      quarter.raw_kpis?.forEach(kpi => {
        if (kpi.definition_id === definitionId) {
          linked.push({ kpi, quarterKey: quarter.quarterKey });
        }
      });
    });
    
    return linked;
  };

  // Analyze KPI definition quality and return 'good', 'bad', or 'neutral'
  const analyzeKPIDefinitionQuality = (def: KPIDefinition): 'good' | 'bad' | 'neutral' => {
    const linkedRawKPIs = getLinkedRawKPIs(def.id);
    
    if (linkedRawKPIs.length === 0) {
      return 'neutral'; // No data yet
    }
    
    // Group by quarter and count readings per quarter
    const quarterCounts = new Map<string, number>();
    linkedRawKPIs.forEach(({ quarterKey }) => {
      quarterCounts.set(quarterKey, (quarterCounts.get(quarterKey) || 0) + 1);
    });
    
    const quarters = Array.from(quarterCounts.keys()).sort();
    const readingsPerQuarter = Array.from(quarterCounts.values());
    
    // Neutral: Only 1 value total
    if (linkedRawKPIs.length === 1) {
      return 'neutral';
    }
    
    // Bad: More than 1 reading per quarter (any quarter has duplicates)
    if (readingsPerQuarter.some(count => count > 1)) {
      return 'bad';
    }
    
    // Good: Has consecutive quarters and only 1 reading per quarter
    if (quarters.length >= 2) {
      // Check if quarters are consecutive
      let isConsecutive = true;
      for (let i = 1; i < quarters.length; i++) {
        const prev = quarters[i - 1];
        const curr = quarters[i];
        
        // Parse quarter keys (format: YYYYQN)
        const prevMatch = prev.match(/^(\d{4})Q([1-4])$/);
        const currMatch = curr.match(/^(\d{4})Q([1-4])$/);
        
        if (!prevMatch || !currMatch) {
          isConsecutive = false;
          break;
        }
        
        const prevYear = parseInt(prevMatch[1]);
        const prevQuarter = parseInt(prevMatch[2]);
        const currYear = parseInt(currMatch[1]);
        const currQuarter = parseInt(currMatch[2]);
        
        // Calculate expected next quarter
        let expectedYear = prevYear;
        let expectedQuarter = prevQuarter + 1;
        
        if (expectedQuarter > 4) {
          expectedQuarter = 1;
          expectedYear += 1;
        }
        
        if (currYear !== expectedYear || currQuarter !== expectedQuarter) {
          isConsecutive = false;
          break;
        }
      }
      
      if (isConsecutive && readingsPerQuarter.every(count => count === 1)) {
        return 'good';
      }
    }
    
    // Neutral: Everything else
    return 'neutral';
  };

  // Create definition from raw KPI
  const handleCreateDefinition = async (kpi: RawKPI, quarterKey: string) => {
    try {
      const response = await fetch(`/api/kpi-definitions/${ticker}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawKpi: kpi, quarterKey })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create definition');
      }
      
      // Refresh data
      await fetchData();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to create definition');
    }
  };

  // Link raw KPI to existing definition
  const handleLinkDefinition = async (kpi: RawKPI, definitionId: string, quarterKey: string) => {
    try {
      const response = await fetch(`/api/kpi-definitions/${ticker}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawKpi: kpi, definitionId, quarterKey })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to link definition');
      }
      
      // Refresh data
      await fetchData();
      setShowLinkModal(false);
      setLinkingKpi(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to link definition');
    }
  };

  // Extract unique values for filter options
  const getUniqueValues = (field: 'measure_kind' | 'subject' | 'subject_axis' | 'unit_family') => {
    const values = new Set<string>();
    
    // From KPI definitions
    kpiDefinitions.forEach(def => {
      const value = def.semantic_interpretation?.[field];
      if (value) values.add(value);
    });
    
    // From raw KPIs
    rawKpisData.forEach(quarter => {
      quarter.raw_kpis?.forEach(kpi => {
        const value = kpi.semantic_interpretation?.[field];
        if (value) values.add(value);
      });
    });
    
    return Array.from(values).sort();
  };

  // Filter KPI definitions
  const filteredDefinitions = kpiDefinitions
    .filter(def => {
      const semantic = def.semantic_interpretation;
      if (!semantic) return false;
      
      if (filterMeasureKind && semantic.measure_kind !== filterMeasureKind) return false;
      if (filterSubject && semantic.subject !== filterSubject) return false;
      if (filterSubjectAxis && semantic.subject_axis !== filterSubjectAxis) return false;
      if (filterUnitFamily && semantic.unit_family !== filterUnitFamily) return false;
      
      return true;
    })
    .sort((a, b) => {
      // Sort by quality: good first, then neutral, then bad
      const qualityOrder = { 'good': 0, 'neutral': 1, 'bad': 2 };
      const qualityA = analyzeKPIDefinitionQuality(a);
      const qualityB = analyzeKPIDefinitionQuality(b);
      return qualityOrder[qualityA] - qualityOrder[qualityB];
    });

  // Calculate quality counts for filtered definitions
  const qualityCounts = filteredDefinitions.reduce((acc, def) => {
    const quality = analyzeKPIDefinitionQuality(def);
    acc[quality] = (acc[quality] || 0) + 1;
    return acc;
  }, { good: 0, neutral: 0, bad: 0 } as { good: number; neutral: number; bad: number });

  // Filter raw KPIs
  const filteredRawKpis = selectedRawKpis?.raw_kpis?.filter(kpi => {
    const semantic = kpi.semantic_interpretation;
    if (!semantic) return false;
    
    if (filterMeasureKind && semantic.measure_kind !== filterMeasureKind) return false;
    if (filterSubject && semantic.subject !== filterSubject) return false;
    if (filterSubjectAxis && semantic.subject_axis !== filterSubjectAxis) return false;
    if (filterUnitFamily && semantic.unit_family !== filterUnitFamily) return false;
    
    return true;
  }) || [];

  // Calculate brand new raw KPIs count
  // A raw KPI is "new" if:
  // 1. It doesn't reference a KPI definition (no definition_id), OR
  // 2. It references a KPI definition that has only 1 linked raw KPI total
  const brandNewCount = filteredRawKpis.filter(kpi => {
    if (!kpi.definition_id) return true; // No definition reference = new
    
    // Check if linked definition has only 1 linked raw KPI
    const linkedDef = getLinkedDefinition(kpi);
    if (linkedDef) {
      const linkedRawKPIs = getLinkedRawKPIs(linkedDef.id);
      return linkedRawKPIs.length === 1; // Only 1 linked raw KPI = new
    }
    
    return false;
  }).length;

  const clearFilters = () => {
    setFilterMeasureKind('');
    setFilterSubject('');
    setFilterSubjectAxis('');
    setFilterUnitFamily('');
  };

  const hasActiveFilters = filterMeasureKind || filterSubject || filterSubjectAxis || filterUnitFamily;

  const formatValue = (kpi: RawKPI): string => {
    if (!kpi.value) return 'N/A';
    const { number, unit, multiplier } = kpi.value;
    if (number === undefined || number === null) return 'N/A';
    
    let formatted = number.toString();
    if (multiplier) {
      formatted = `${formatted} ${multiplier}`;
    }
    if (unit) {
      formatted = `${formatted} ${unit}`;
    }
    return formatted;
  };

  // Helper function to render semantic tag
  const renderSemanticTag = (
    label: string,
    value: string,
    filterType: 'measure_kind' | 'subject' | 'subject_axis' | 'unit_family',
    currentFilter: string
  ) => {
    const isActive = currentFilter === value;
    const handleClick = () => {
      switch (filterType) {
        case 'measure_kind':
          setFilterMeasureKind(isActive ? '' : value);
          break;
        case 'subject':
          setFilterSubject(isActive ? '' : value);
          break;
        case 'subject_axis':
          setFilterSubjectAxis(isActive ? '' : value);
          break;
        case 'unit_family':
          setFilterUnitFamily(isActive ? '' : value);
          break;
      }
    };

    return (
      <button
        onClick={handleClick}
        className={`
          inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all
          ${isActive
            ? 'bg-blue-600 text-white shadow-sm'
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200 hover:shadow-sm'
          }
          cursor-pointer
        `}
        title={`Click to ${isActive ? 'clear' : 'filter by'} ${label}: ${value}`}
      >
        <span className="text-[10px] opacity-75">{label}:</span>
        <span>{value}</span>
        {isActive && (
          <span className="ml-1 text-[10px]">×</span>
        )}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans antialiased">
      <AppNavigation 
        selectedTicker={ticker}
        onTickerChange={(newTicker) => {
          router.push(`/${newTicker}/kpi-match`);
        }}
      />

      <div className="w-full max-w-none px-6 py-6">
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
          {/* Main Content Area - 3/4 width */}
          <div className="xl:col-span-3">
            {/* Page Title */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">
                KPI Matching Prototype
              </h1>
              <p className="text-gray-600">
                Compare KPI definitions with raw KPIs for {ticker}
              </p>
            </div>

            {/* Semantic Interpretation Filters */}
            <div className="mb-6">
              <div className="bg-white rounded-lg shadow-sm p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-900">Semantic Filters</h3>
                  {hasActiveFilters && (
                    <button
                      onClick={clearFilters}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Clear All
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Measure Kind Filter */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Measure Kind
                    </label>
                    <select
                      value={filterMeasureKind}
                      onChange={(e) => setFilterMeasureKind(e.target.value)}
                      className="block w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">All</option>
                      {getUniqueValues('measure_kind').map(value => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                  </div>

                  {/* Subject Filter */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Subject
                    </label>
                    <select
                      value={filterSubject}
                      onChange={(e) => setFilterSubject(e.target.value)}
                      className="block w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">All</option>
                      {getUniqueValues('subject').map(value => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                  </div>

                  {/* Subject Axis Filter */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Subject Axis
                    </label>
                    <select
                      value={filterSubjectAxis}
                      onChange={(e) => setFilterSubjectAxis(e.target.value)}
                      className="block w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">All</option>
                      {getUniqueValues('subject_axis').map(value => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                  </div>

                  {/* Unit Family Filter */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Unit Family
                    </label>
                    <select
                      value={filterUnitFamily}
                      onChange={(e) => setFilterUnitFamily(e.target.value)}
                      className="block w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">All</option>
                      {getUniqueValues('unit_family').map(value => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {hasActiveFilters && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs text-gray-600">
                      Showing {filteredDefinitions.length} definition{filteredDefinitions.length !== 1 ? 's' : ''} and {filteredRawKpis.length} raw KPI{filteredRawKpis.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Loading State */}
            {loading && (
              <div className="bg-white rounded-lg shadow-sm p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Loading data...</p>
              </div>
            )}

            {/* Error State */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-6">
                <p className="text-red-800 font-medium">Error: {error}</p>
              </div>
            )}

            {/* Terminology Prompt Editor */}
            {!loading && (
              <div className="mb-6">
                <TerminologyPromptEditor ticker={ticker} showFullPrompt={false} />
              </div>
            )}

            {/* Side-by-side Comparison */}
            {!loading && !error && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* KPI Definitions Column */}
                <div className="bg-white rounded-lg shadow-sm">
                  <div className="bg-blue-50 border-b border-blue-200 rounded-t-lg p-4">
                    <h2 className="text-lg font-semibold text-gray-900">
                      KPI Definitions
                    </h2>
                    <p className="text-sm text-gray-600 mt-1">
                      {hasActiveFilters ? (
                        <>
                          {filteredDefinitions.length} of {kpiDefinitions.length} definition{kpiDefinitions.length !== 1 ? 's' : ''}
                        </>
                      ) : (
                        <>
                          {kpiDefinitions.length} definition{kpiDefinitions.length !== 1 ? 's' : ''}
                        </>
                      )}
                    </p>
                    {filteredDefinitions.length > 0 && (
                      <div className="flex items-center gap-4 mt-2 text-xs">
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-green-500"></span>
                          <span className="text-gray-700 font-medium">{qualityCounts.good}</span>
                          <span className="text-gray-500">good</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                          <span className="text-gray-700 font-medium">{qualityCounts.neutral}</span>
                          <span className="text-gray-500">neutral</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-red-500"></span>
                          <span className="text-gray-700 font-medium">{qualityCounts.bad}</span>
                          <span className="text-gray-500">bad</span>
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="p-4 max-h-[800px] overflow-y-auto">
                    {kpiDefinitions.length === 0 ? (
                      <p className="text-gray-500 text-center py-8">No KPI definitions found</p>
                    ) : filteredDefinitions.length === 0 ? (
                      <p className="text-gray-500 text-center py-8">No KPI definitions match the selected filters</p>
                    ) : (
                      <div className="space-y-4">
                        {filteredDefinitions.map((def) => (
                          <div
                            key={def.id}
                            className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <h3 className="font-semibold text-gray-900">{def.name}</h3>
                                  {(() => {
                                    const quality = analyzeKPIDefinitionQuality(def);
                                    return (
                                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                                        quality === 'good'
                                          ? 'bg-green-100 text-green-700'
                                          : quality === 'bad'
                                          ? 'bg-red-100 text-red-700'
                                          : 'bg-gray-100 text-gray-700'
                                      }`} title={
                                        quality === 'good'
                                          ? 'Good: Has consecutive quarters with 1 reading per quarter'
                                          : quality === 'bad'
                                          ? 'Bad: Has multiple readings per quarter or only 1 value'
                                          : 'Neutral: Other cases'
                                      }>
                                        {quality === 'good' ? '✓ Good' : quality === 'bad' ? '✗ Bad' : '○ Neutral'}
                                      </span>
                                    );
                                  })()}
                                  {def.group && (
                                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                                      {def.group}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            
                            {def.summary && (
                              <p className="text-sm text-gray-600 mb-2">{def.summary}</p>
                            )}
                            
                            <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 mt-3">
                              {def.unit && (
                                <div>
                                  <span className="font-medium">Unit:</span> {def.unit}
                                </div>
                              )}
                              {def.multiplier && (
                                <div>
                                  <span className="font-medium">Multiplier:</span> {def.multiplier}
                                </div>
                              )}
                              {def.value_type && (
                                <div>
                                  <span className="font-medium">Type:</span> {def.value_type}
                                </div>
                              )}
                            </div>
                            
                            {def.semantic_interpretation && (
                              <div className="mt-3 pt-3 border-t border-gray-100">
                                <div className="flex flex-wrap gap-2">
                                  {def.semantic_interpretation.measure_kind && (
                                    renderSemanticTag(
                                      'Measure',
                                      def.semantic_interpretation.measure_kind,
                                      'measure_kind',
                                      filterMeasureKind
                                    )
                                  )}
                                  {def.semantic_interpretation.subject && (
                                    renderSemanticTag(
                                      'Subject',
                                      def.semantic_interpretation.subject,
                                      'subject',
                                      filterSubject
                                    )
                                  )}
                                  {def.semantic_interpretation.subject_axis && (
                                    renderSemanticTag(
                                      'Axis',
                                      def.semantic_interpretation.subject_axis,
                                      'subject_axis',
                                      filterSubjectAxis
                                    )
                                  )}
                                  {def.semantic_interpretation.unit_family && (
                                    renderSemanticTag(
                                      'Unit',
                                      def.semantic_interpretation.unit_family,
                                      'unit_family',
                                      filterUnitFamily
                                    )
                                  )}
                                </div>
                                {(() => {
                                  const normalizedQualifiers = normalizeQualifiers(def.semantic_interpretation.qualifiers);
                                  return Object.keys(normalizedQualifiers).length > 0 && (
                                    <div className="mt-2 pt-2 border-t border-gray-100">
                                      <p className="text-xs font-medium text-gray-700 mb-1">Qualifiers:</p>
                                      <div className="flex flex-wrap gap-1">
                                        {Object.entries(normalizedQualifiers).map(([key, value]) => (
                                          <span
                                            key={key}
                                            className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded"
                                            title={`${key}: ${value}`}
                                          >
                                            {key}: {value}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                            
                            {def.other_names && def.other_names.length > 0 && (
                              <div className="mt-2">
                                <p className="text-xs text-gray-500">
                                  Also known as: {def.other_names.join(', ')}
                                </p>
                              </div>
                            )}
                            
                            {/* Linked Raw KPIs Information */}
                            {(() => {
                              const linkedRawKPIs = getLinkedRawKPIs(def.id);
                              if (linkedRawKPIs.length > 0) {
                                const quarters = [...new Set(linkedRawKPIs.map(l => l.quarterKey))].sort();
                                return (
                                  <div className="mt-3 pt-3 border-t border-gray-100">
                                    <div className="flex items-center justify-between mb-2">
                                      <p className="text-xs font-medium text-gray-700">
                                        Linked Raw KPIs: {linkedRawKPIs.length}
                                      </p>
                                      <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded">
                                        {quarters.length} quarter{quarters.length !== 1 ? 's' : ''}
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap gap-1 mt-2">
                                      {quarters.map(quarter => {
                                        const count = linkedRawKPIs.filter(l => l.quarterKey === quarter).length;
                                        return (
                                          <span
                                            key={quarter}
                                            className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded"
                                            title={`${count} KPI${count !== 1 ? 's' : ''} in ${quarter}`}
                                          >
                                            {quarter} ({count})
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Raw KPIs Column */}
                <div className="bg-white rounded-lg shadow-sm">
                  <div className="bg-green-50 border-b border-green-200 rounded-t-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h2 className="text-lg font-semibold text-gray-900">
                        Raw KPIs
                      </h2>
                      {rawKpisData.length > 0 && (
                        <select
                          value={selectedQuarter || ''}
                          onChange={(e) => setSelectedQuarter(e.target.value)}
                          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white"
                        >
                          {rawKpisData.map((quarter) => (
                            <option key={quarter.quarterKey} value={quarter.quarterKey}>
                              {quarter.quarterKey} 
                              {quarter.num_kpis !== undefined && ` (${quarter.num_kpis} KPIs)`}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div className="text-sm text-gray-600 space-y-1">
                      {selectedRawKpis ? (
                        <>
                          <p>
                            {hasActiveFilters ? (
                              <>
                                {filteredRawKpis.length} of {selectedRawKpis.raw_kpis?.length || 0} KPI{(selectedRawKpis.raw_kpis?.length || 0) !== 1 ? 's' : ''}
                              </>
                            ) : selectedRawKpis.num_kpis !== undefined && (
                              <>{selectedRawKpis.num_kpis} KPI{selectedRawKpis.num_kpis !== 1 ? 's' : ''}</>
                            )}
                          </p>
                          {selectedRawKpis.raw_kpis && filteredRawKpis.length > 0 && brandNewCount > 0 && (
                            <div className="flex items-center gap-2 text-xs mt-1">
                              <span className="text-blue-700 font-semibold">
                                {brandNewCount} new definition{brandNewCount !== 1 ? 's' : ''} needed
                              </span>
                            </div>
                          )}
                        </>
                      ) : (
                        <p>No quarter selected</p>
                      )}
                    </div>
                  </div>
                  <div className="p-4 max-h-[800px] overflow-y-auto">
                    {!selectedQuarter ? (
                      <p className="text-gray-500 text-center py-8">Please select a quarter</p>
                    ) : !selectedRawKpis ? (
                      <p className="text-gray-500 text-center py-8">No raw KPIs found for this quarter</p>
                    ) : !selectedRawKpis.raw_kpis || selectedRawKpis.raw_kpis.length === 0 ? (
                      <p className="text-gray-500 text-center py-8">No raw KPIs in this quarter</p>
                    ) : filteredRawKpis.length === 0 ? (
                      <p className="text-gray-500 text-center py-8">No raw KPIs match the selected filters</p>
                    ) : (
                      <div className="space-y-4">
                        {filteredRawKpis.map((kpi, index) => {
                          return (
                            <div
                              key={index}
                              className="border border-gray-200 rounded-lg p-4 transition-colors hover:border-green-300"
                            >
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <h3 className="font-semibold text-gray-900">{kpi.name}</h3>
                                    {(() => {
                                      const linkedDef = getLinkedDefinition(kpi);
                                      if (linkedDef) {
                                        const quality = analyzeKPIDefinitionQuality(linkedDef);
                                        return (
                                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                                            quality === 'good'
                                              ? 'bg-green-100 text-green-700'
                                              : quality === 'bad'
                                              ? 'bg-red-100 text-red-700'
                                              : 'bg-gray-100 text-gray-700'
                                          }`} title={
                                            quality === 'good'
                                              ? 'Good: Has consecutive quarters with 1 reading per quarter'
                                              : quality === 'bad'
                                              ? 'Bad: Has multiple readings per quarter'
                                              : 'Neutral: Other cases'
                                          }>
                                            {quality === 'good' ? '✓ Good' : quality === 'bad' ? '✗ Bad' : '○ Neutral'}
                                          </span>
                                        );
                                      }
                                      return null;
                                    })()}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {kpi.value && (
                                    <span className="text-sm font-medium text-green-700 bg-green-50 px-2 py-1 rounded">
                                      {formatValue(kpi)}
                                    </span>
                                  )}
                                  {(() => {
                                    // Only show create/link buttons if KPI is not linked to an existing definition
                                    const linkedDef = getLinkedDefinition(kpi);
                                    if (!linkedDef) {
                                      return (
                                        <div className="flex gap-1">
                                          <button
                                            onClick={() => handleCreateDefinition(kpi, selectedQuarter!)}
                                            className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                                            title="Create definition from this KPI"
                                          >
                                            Create
                                          </button>
                                          <button
                                            onClick={() => {
                                              setLinkingKpi({ kpi, quarterKey: selectedQuarter! });
                                              setShowLinkModal(true);
                                            }}
                                            className="text-xs px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors"
                                            title="Link to existing definition"
                                          >
                                            Link
                                          </button>
                                        </div>
                                      );
                                    }
                                    return null;
                                  })()}
                                </div>
                              </div>
                            
                            {kpi.summary && (
                              <p className="text-sm text-gray-600 mb-2">{kpi.summary}</p>
                            )}
                            
                            {kpi.source && (
                              <p className="text-xs text-gray-500 mb-2">
                                <span className="font-medium">Source:</span> {kpi.source}
                              </p>
                            )}
                            
                            <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 mt-3">
                              {kpi.value_type && (
                                <div>
                                  <span className="font-medium">Type:</span> {kpi.value_type}
                                </div>
                              )}
                              {kpi.value?.unit && (
                                <div>
                                  <span className="font-medium">Unit:</span> {kpi.value.unit}
                                </div>
                              )}
                              {kpi.value?.multiplier && (
                                <div>
                                  <span className="font-medium">Multiplier:</span> {kpi.value.multiplier}
                                </div>
                              )}
                            </div>
                            
                            {kpi.semantic_interpretation && (
                              <div className="mt-3 pt-3 border-t border-gray-100">
                                <div className="flex flex-wrap gap-2">
                                  {kpi.semantic_interpretation.measure_kind && (
                                    renderSemanticTag(
                                      'Measure',
                                      kpi.semantic_interpretation.measure_kind,
                                      'measure_kind',
                                      filterMeasureKind
                                    )
                                  )}
                                  {kpi.semantic_interpretation.subject && (
                                    renderSemanticTag(
                                      'Subject',
                                      kpi.semantic_interpretation.subject,
                                      'subject',
                                      filterSubject
                                    )
                                  )}
                                  {kpi.semantic_interpretation.subject_axis && (
                                    renderSemanticTag(
                                      'Axis',
                                      kpi.semantic_interpretation.subject_axis,
                                      'subject_axis',
                                      filterSubjectAxis
                                    )
                                  )}
                                  {kpi.semantic_interpretation.unit_family && (
                                    renderSemanticTag(
                                      'Unit',
                                      kpi.semantic_interpretation.unit_family,
                                      'unit_family',
                                      filterUnitFamily
                                    )
                                  )}
                                </div>
                                {(() => {
                                  const normalizedQualifiers = normalizeQualifiers(kpi.semantic_interpretation.qualifiers);
                                  return Object.keys(normalizedQualifiers).length > 0 && (
                                    <div className="mt-2 pt-2 border-t border-gray-100">
                                      <p className="text-xs font-medium text-gray-700 mb-1">Qualifiers:</p>
                                      <div className="flex flex-wrap gap-1">
                                        {Object.entries(normalizedQualifiers).map(([key, value]) => (
                                          <span
                                            key={key}
                                            className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded"
                                            title={`${key}: ${value}`}
                                          >
                                            {key}: {value}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                            
                            {kpi.other_names && kpi.other_names.length > 0 && (
                              <div className="mt-2">
                                <p className="text-xs text-gray-500">
                                  Also known as: {kpi.other_names.join(', ')}
                                </p>
                              </div>
                            )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Sidebar - 1/4 width */}
          <div className="xl:col-span-1">
            <div className="sticky top-6 space-y-6">
              <CompanyInfoCard ticker={ticker} showPrice={true} />
            </div>
          </div>
        </div>
      </div>

      {/* Link Definition Modal */}
      {showLinkModal && linkingKpi && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Link KPI to Definition
              </h3>
              <p className="text-sm text-gray-600">
                Select a definition to link: <strong>{linkingKpi.kpi.name}</strong>
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {(() => {
                // Filter definitions to only show those with matching semantic fields (including qualifiers)
                const rawKpiSemantic = linkingKpi.kpi.semantic_interpretation;
                const matchingDefinitions = kpiDefinitions.filter(def => {
                  if (!rawKpiSemantic || !def.semantic_interpretation) return false;
                  
                  const defSemantic = def.semantic_interpretation;
                  return (
                    defSemantic.measure_kind === rawKpiSemantic.measure_kind &&
                    defSemantic.subject === rawKpiSemantic.subject &&
                    defSemantic.subject_axis === rawKpiSemantic.subject_axis &&
                    defSemantic.unit_family === rawKpiSemantic.unit_family &&
                    qualifiersMatch(defSemantic.qualifiers, rawKpiSemantic.qualifiers)
                  );
                });
                
                if (matchingDefinitions.length === 0) {
                  return (
                    <div className="text-center py-8">
                      <p className="text-gray-500 mb-2">No definitions with matching semantic fields</p>
                      <p className="text-xs text-gray-400">
                        All semantic fields (measure_kind, subject, subject_axis, unit_family) must match
                      </p>
                    </div>
                  );
                }
                
                return (
                  <div className="space-y-2">
                    {matchingDefinitions.map((def) => (
                    <button
                      key={def.id}
                      onClick={() => handleLinkDefinition(linkingKpi.kpi, def.id, linkingKpi.quarterKey)}
                      className="w-full text-left p-4 border border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="font-semibold text-gray-900">{def.name}</h4>
                          {def.summary && (
                            <p className="text-sm text-gray-600 mt-1">{def.summary}</p>
                          )}
                          {def.semantic_interpretation && (
                            <div className="mt-2 space-y-1">
                              <div className="flex flex-wrap gap-1">
                                {def.semantic_interpretation.measure_kind && (
                                  <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                                    {def.semantic_interpretation.measure_kind}
                                  </span>
                                )}
                                {def.semantic_interpretation.subject && (
                                  <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                                    {def.semantic_interpretation.subject}
                                  </span>
                                )}
                                {def.semantic_interpretation.subject_axis && (
                                  <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                                    {def.semantic_interpretation.subject_axis}
                                  </span>
                                )}
                              </div>
                              {(() => {
                                const normalizedQualifiers = normalizeQualifiers(def.semantic_interpretation.qualifiers);
                                return Object.keys(normalizedQualifiers).length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {Object.entries(normalizedQualifiers).map(([key, value]) => (
                                      <span
                                        key={key}
                                        className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded"
                                        title={`${key}: ${value}`}
                                      >
                                        {key}: {value}
                                      </span>
                                    ))}
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                    ))}
                  </div>
                );
              })()}
            </div>
            <div className="p-6 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => {
                  setShowLinkModal(false);
                  setLinkingKpi(null);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

