'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useParams, useRouter } from 'next/navigation';
import TickerSearch from '../../components/TickerSearch';
import CompanyInfoCard from '../../components/CompanyInfoCard';

interface Document {
  document_id: string;
  title?: string;
  url?: string;
  document_type?: string;
  fiscal_year?: number;
  fiscal_quarter?: number;
  quarter_key?: string;
  release_date?: string;
  document_download_url?: string;
  document_storage_ref?: string;
  scanned_at?: string;
}

interface DocumentsByQuarter {
  [quarterKey: string]: Document[];
}

interface DocumentsResponse {
  success: boolean;
  ticker: string;
  documentsByQuarter: DocumentsByQuarter;
  totalDocuments: number;
  quarters: string[];
}

interface IRUrl {
  id: string;
  url: string;
  last_scanned: string | null;
  created_at: string;
  updated_at: string;
}

const getDocumentTypeLabel = (type?: string): string => {
  if (!type) return 'Document';
  
  const typeMap: Record<string, string> = {
    'earnings_release': 'Earnings Release',
    'presentation': 'Presentation',
    'sec_filing_10k': '10-K Filing',
    'sec_filing_10q': '10-Q Filing',
    'sec_filing_8k': '8-K Filing',
    'annual_report': 'Annual Report',
    'proxy_statement': 'Proxy Statement',
    'other': 'Other Document'
  };
  
  return typeMap[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

const formatQuarter = (quarterKey: string): string => {
  const match = quarterKey.match(/(\d{4})Q(\d)/);
  if (!match) return quarterKey;
  
  const year = match[1];
  const quarter = match[2];
  return `FY${year} Q${quarter}`;
};

export default function DocumentsPage() {
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();
  const ticker = (params?.ticker as string) || 'AAPL';
  const [data, setData] = useState<DocumentsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [irUrls, setIrUrls] = useState<IRUrl[]>([]);
  const [irUrlsLoading, setIrUrlsLoading] = useState(false);
  const [isEditingUrls, setIsEditingUrls] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [addingUrl, setAddingUrl] = useState(false);
  const [editingUrlId, setEditingUrlId] = useState<string | null>(null);
  const [editingUrlValue, setEditingUrlValue] = useState('');
  const [deletingUrlId, setDeletingUrlId] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  const fetchDocuments = async (tickerSymbol: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/documents/${tickerSymbol}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.message || `Failed to fetch: ${response.status}`);
      }
      
      const documentsData: DocumentsResponse = await response.json();
      setData(documentsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch documents');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchIrUrls = async (tickerSymbol: string) => {
    setIrUrlsLoading(true);
    try {
      const response = await fetch(`/api/ir-urls/${tickerSymbol}`);
      if (response.ok) {
        const data = await response.json();
        setIrUrls(data.urls || []);
      }
    } catch (err) {
      console.error('Error fetching IR URLs:', err);
    } finally {
      setIrUrlsLoading(false);
    }
  };

  useEffect(() => {
    if (ticker) {
      fetchDocuments(ticker);
      fetchIrUrls(ticker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const formatDate = (dateString?: string): string => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return dateString;
    }
  };

  const formatLastScanned = (dateString: string | null): string => {
    if (!dateString) return 'Never';
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays} days ago`;
      if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return dateString || 'Never';
    }
  };

  const handleAddUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl.trim()) {
      setUrlError('Please enter a URL');
      return;
    }

    try {
      setAddingUrl(true);
      setUrlError(null);
      const response = await fetch(`/api/ir-urls/${ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: newUrl.trim() }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to add URL');
      }

      const data = await response.json();
      setIrUrls([data, ...irUrls]);
      setNewUrl('');
    } catch (err: any) {
      setUrlError(err.message || 'Failed to add URL');
      console.error('Error adding URL:', err);
    } finally {
      setAddingUrl(false);
    }
  };

  const handleStartEdit = (url: IRUrl) => {
    setEditingUrlId(url.id);
    setEditingUrlValue(url.url);
    setUrlError(null);
  };

  const handleCancelEdit = () => {
    setEditingUrlId(null);
    setEditingUrlValue('');
    setUrlError(null);
  };

  const handleSaveEdit = async (urlId: string) => {
    if (!editingUrlValue.trim()) {
      setUrlError('Please enter a URL');
      return;
    }

    try {
      setUrlError(null);
      // For now, we'll delete and recreate since we don't have an UPDATE endpoint
      // In a production app, you'd want a PATCH/PUT endpoint
      const deleteResponse = await fetch(`/api/ir-urls/${ticker}?id=${urlId}`, {
        method: 'DELETE',
      });

      if (!deleteResponse.ok) {
        throw new Error('Failed to update URL');
      }

      const addResponse = await fetch(`/api/ir-urls/${ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: editingUrlValue.trim() }),
      });

      if (!addResponse.ok) {
        const data = await addResponse.json();
        throw new Error(data.error || 'Failed to update URL');
      }

      // Refresh URLs
      await fetchIrUrls(ticker);
      setEditingUrlId(null);
      setEditingUrlValue('');
    } catch (err: any) {
      setUrlError(err.message || 'Failed to update URL');
      console.error('Error updating URL:', err);
    }
  };

  const handleDeleteUrl = async (urlId: string) => {
    if (!confirm('Are you sure you want to delete this URL?')) {
      return;
    }

    try {
      setDeletingUrlId(urlId);
      setUrlError(null);
      const response = await fetch(`/api/ir-urls/${ticker}?id=${urlId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete URL');
      }

      setIrUrls(irUrls.filter((url) => url.id !== urlId));
    } catch (err: any) {
      setUrlError(err.message || 'Failed to delete URL');
      console.error('Error deleting URL:', err);
    } finally {
      setDeletingUrlId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans antialiased">
      {/* Top Navigation Bar */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="w-full max-w-none px-6 py-3">
          <div className="flex items-center gap-6">
            {/* Logo/Brand */}
            <div className="flex-shrink-0">
              <div className="text-lg font-bold text-blue-600 tracking-tight">StockAnalysis</div>
            </div>
            {/* Ticker Search Bar */}
            <div className="flex-1 max-w-md">
              <TickerSearch 
                selectedTicker={ticker}
                onTickerChange={(newTicker) => {
                  router.push(`/${newTicker}/documents`);
                }}
              />
            </div>
            {/* Navigation Items */}
            <nav className="flex items-center gap-6 flex-shrink-0">
              <Link
                href={`/${ticker}/value`}
                className={`pb-3 px-1 border-b-2 transition-colors text-sm font-medium ${
                  pathname === `/${ticker}/value`
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-700 hover:text-gray-900'
                }`}
              >
                Value
              </Link>
              <Link
                href={`/${ticker}/kpi`}
                className={`pb-3 px-1 border-b-2 transition-colors text-sm font-medium ${
                  pathname === `/${ticker}/kpi`
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-700 hover:text-gray-900'
                }`}
              >
                KPI
              </Link>
              <Link
                href={`/${ticker}/documents`}
                className={`pb-3 px-1 border-b-2 transition-colors text-sm font-medium ${
                  pathname === `/${ticker}/documents`
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-700 hover:text-gray-900'
                }`}
              >
                Documents
              </Link>
            </nav>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="w-full max-w-none px-6 py-6">
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
          {/* Main Content Area - 3/4 width */}
          <div className="xl:col-span-3">
            {/* Page Title */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                Documents
              </h1>
              {data && data.totalDocuments > 0 && (
                <p className="text-sm text-gray-600 mt-1">
                  {data.totalDocuments} document{data.totalDocuments !== 1 ? 's' : ''} across {data.quarters.length} quarter{data.quarters.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>

            {/* Loading State */}
            {loading && (
              <div className="bg-white rounded-lg shadow-sm p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Loading documents...</p>
              </div>
            )}

            {/* Error State */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-6">
                <p className="text-red-800 font-medium">Error: {error}</p>
              </div>
            )}

            {/* Documents Display */}
            {!loading && !error && data && (
              <>
                {data.totalDocuments === 0 ? (
                  <div className="bg-white rounded-lg shadow-sm p-8 text-center">
                    <p className="text-gray-600">No documents found for {data.ticker}</p>
                    <p className="text-sm text-gray-500 mt-2">
                      Documents will appear here once they are scanned from the investor relations website.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {data.quarters.map((quarterKey) => {
                      const documents = data.documentsByQuarter[quarterKey] || [];
                      return (
                        <div
                          key={quarterKey}
                          className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden"
                        >
                          {/* Quarter Header */}
                          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-200 px-4 py-3">
                            <div className="flex items-center justify-between">
                              <h2 className="text-lg font-bold text-gray-900">
                                {formatQuarter(quarterKey)}
                              </h2>
                              <span className="text-xs font-medium text-gray-600 bg-white px-2 py-1 rounded-full">
                                {documents.length} document{documents.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                          </div>

                          {/* Documents List */}
                          <div className="divide-y divide-gray-100">
                            {documents.map((doc) => (
                              <div
                                key={doc.document_id}
                                className="px-4 py-3 hover:bg-gray-50 transition-colors"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1.5">
                                      {doc.document_type && (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 flex-shrink-0">
                                          {getDocumentTypeLabel(doc.document_type)}
                                        </span>
                                      )}
                                    </div>
                                    <h3 className="text-sm font-semibold text-gray-900 mb-1.5 line-clamp-2">
                                      {doc.title || 'Untitled Document'}
                                    </h3>
                                    {doc.release_date && (
                                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                        </svg>
                                        {formatDate(doc.release_date)}
                                      </div>
                                    )}
                                  </div>

                                  {/* Action Buttons */}
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    {doc.document_download_url && (
                                      <a
                                        href={doc.document_download_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center justify-center p-1.5 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                        title="Download"
                                      >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                      </a>
                                    )}
                                    {doc.url && (
                                      <a
                                        href={doc.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center justify-center p-1.5 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                        title="View Source"
                                      >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                        </svg>
                                      </a>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Right Sidebar - 1/4 width */}
          <div className="xl:col-span-1">
            <div className="sticky top-6 space-y-6">
              {/* Company Info */}
              <CompanyInfoCard ticker={ticker} showPrice={true} />
              
              {/* IR URLs Section */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">IR URLs</h3>
                  <button
                    onClick={() => {
                      setIsEditingUrls(!isEditingUrls);
                      setUrlError(null);
                      if (isEditingUrls) {
                        setEditingUrlId(null);
                        setEditingUrlValue('');
                        setNewUrl('');
                      }
                    }}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
                  >
                    {isEditingUrls ? 'Done' : 'Edit'}
                  </button>
                </div>
                <div className="p-4">
                  {irUrlsLoading ? (
                    <div className="text-center py-4">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mx-auto"></div>
                      <p className="text-xs text-gray-500 mt-2">Loading...</p>
                    </div>
                  ) : (
                    <>
                      {urlError && (
                        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                          {urlError}
                        </div>
                      )}

                      {/* Add New URL Form */}
                      {isEditingUrls && (
                        <form onSubmit={handleAddUrl} className="mb-4 pb-4 border-b border-gray-200">
                          <div className="flex gap-2">
                            <input
                              type="url"
                              value={newUrl}
                              onChange={(e) => {
                                setNewUrl(e.target.value);
                                setUrlError(null);
                              }}
                              placeholder="https://investor.example.com/..."
                              className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                              disabled={addingUrl}
                            />
                            <button
                              type="submit"
                              disabled={addingUrl || !newUrl.trim()}
                              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
                            >
                              {addingUrl ? '...' : 'Add'}
                            </button>
                          </div>
                        </form>
                      )}

                      {/* URLs List */}
                      {irUrls.length === 0 && !isEditingUrls ? (
                        <div className="text-center py-4">
                          <p className="text-xs text-gray-500">No IR URLs configured</p>
                          <button
                            onClick={() => setIsEditingUrls(true)}
                            className="text-xs text-blue-600 hover:text-blue-700 mt-2 inline-block"
                          >
                            Add URL
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {irUrls.map((url) => (
                            <div key={url.id} className="border-b border-gray-100 last:border-b-0 pb-3 last:pb-0">
                              {isEditingUrls && editingUrlId === url.id ? (
                                // Edit Mode
                                <div className="space-y-2">
                                  <input
                                    type="url"
                                    value={editingUrlValue}
                                    onChange={(e) => {
                                      setEditingUrlValue(e.target.value);
                                      setUrlError(null);
                                    }}
                                    className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    autoFocus
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleSaveEdit(url.id)}
                                      className="flex-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={handleCancelEdit}
                                      className="flex-1 px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300 font-medium"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                // View Mode
                                <>
                                  <div className="flex items-start justify-between gap-2">
                                    <a
                                      href={url.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-blue-600 hover:text-blue-800 break-all line-clamp-2 flex-1"
                                      title={url.url}
                                    >
                                      {url.url}
                                    </a>
                                    {isEditingUrls && (
                                      <div className="flex gap-1 flex-shrink-0">
                                        <button
                                          onClick={() => handleStartEdit(url)}
                                          className="p-1 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                          title="Edit"
                                        >
                                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                          </svg>
                                        </button>
                                        <button
                                          onClick={() => handleDeleteUrl(url.id)}
                                          disabled={deletingUrlId === url.id}
                                          className="p-1 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                                          title="Delete"
                                        >
                                          {deletingUrlId === url.id ? (
                                            <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-red-600"></div>
                                          ) : (
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                          )}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-xs text-gray-500 mt-1.5">
                                    Last scanned: {formatLastScanned(url.last_scanned)}
                                  </div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
