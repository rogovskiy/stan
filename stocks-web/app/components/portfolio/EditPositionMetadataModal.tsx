import { useRouter } from 'next/navigation';
import type { Band, Position } from '../../lib/services/portfolioService';

export default function EditPositionMetadataModal({
  portfolioId,
  position,
  bands,
  positionBandId,
  setPositionBandId,
  positionThesisId,
  setPositionThesisId,
  positionNotes,
  setPositionNotes,
  onClose,
  onSave,
}: {
  portfolioId: string;
  position: Position;
  bands: Band[];
  positionBandId: string;
  setPositionBandId: (v: string) => void;
  positionThesisId: string;
  setPositionThesisId: (v: string) => void;
  positionNotes: string;
  setPositionNotes: (v: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const router = useRouter();
  const newThesisHref = `/new-thesis?portfolioId=${encodeURIComponent(portfolioId)}&positionId=${encodeURIComponent(position.id!)}&ticker=${encodeURIComponent(position.ticker)}`;
  const builderHref = position.thesisId
    ? `/${position.ticker}/thesis-builder?thesisDocId=${encodeURIComponent(position.thesisId)}`
    : null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-gray-900">Edit position – {position.ticker}</h3>
            <button onClick={onClose} className="text-gray-600 hover:text-gray-900">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Band (optional)</label>
              <select
                value={positionBandId}
                onChange={(e) => setPositionBandId(e.target.value)}
                className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">None</option>
                {bands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name || `Band ${b.sizeMinPct}–${b.sizeMaxPct}%`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Thesis</label>
              <div className="flex flex-wrap gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    router.push(newThesisHref);
                  }}
                  className="px-3 py-1.5 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                >
                  Full thesis workflow (new-thesis)
                </button>
                {builderHref && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      router.push(builderHref);
                    }}
                    className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Open thesis builder
                  </button>
                )}
              </div>
              <label className="block text-xs text-gray-500 mb-1">Thesis document ID (advanced)</label>
              <input
                type="text"
                value={positionThesisId}
                onChange={(e) => setPositionThesisId(e.target.value)}
                className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Firestore thesis doc id"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Notes</label>
              <textarea
                value={positionNotes}
                onChange={(e) => setPositionNotes(e.target.value)}
                rows={3}
                className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Position notes..."
              />
            </div>
          </div>
          <div className="flex gap-3 mt-6">
            <button
              onClick={onSave}
              className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              Save
            </button>
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
