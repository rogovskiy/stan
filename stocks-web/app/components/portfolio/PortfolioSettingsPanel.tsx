import type { Band, PortfolioAccountType } from '../../lib/services/portfolioService';

export default function PortfolioSettingsPanel({
  settingsName,
  setSettingsName,
  settingsDescription,
  setSettingsDescription,
  settingsAccountType,
  setSettingsAccountType,
  settingsBands,
  addBand,
  updateBand,
  removeBand,
  onSave,
  onCancel,
  onDeletePortfolio,
  savingSettings,
  portfolioId,
}: {
  settingsName: string;
  setSettingsName: (v: string) => void;
  settingsDescription: string;
  setSettingsDescription: (v: string) => void;
  settingsAccountType: PortfolioAccountType;
  setSettingsAccountType: (v: PortfolioAccountType) => void;
  settingsBands: Band[];
  addBand: () => void;
  updateBand: (id: string, updates: Partial<Band>) => void;
  removeBand: (id: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDeletePortfolio: (id: string) => void;
  savingSettings: boolean;
  portfolioId?: string;
}) {
  return (
    <div className="mt-4 pt-4 border-t border-gray-200 max-h-[min(60vh,500px)] overflow-y-auto">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">Portfolio settings</h3>
      <div className="grid gap-3 max-w-xl">
        <label className="block">
          <span className="text-sm text-gray-600">Name</span>
          <input
            type="text"
            value={settingsName}
            onChange={(e) => setSettingsName(e.target.value)}
            className="mt-1 block w-full px-3 py-2 text-black border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </label>
        <label className="block">
          <span className="text-sm text-gray-600">Description</span>
          <textarea
            value={settingsDescription}
            onChange={(e) => setSettingsDescription(e.target.value)}
            rows={2}
            className="mt-1 block w-full px-3 py-2 text-black border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </label>
        <div>
          <span className="text-sm text-gray-600 block mb-1">Account type</span>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="accountType"
                checked={settingsAccountType === 'taxable'}
                onChange={() => setSettingsAccountType('taxable')}
                className="text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm">Taxable</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="accountType"
                checked={settingsAccountType === 'ira'}
                onChange={() => setSettingsAccountType('ira')}
                className="text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm">IRA</span>
            </label>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">Risk bands</span>
            <button
              type="button"
              onClick={addBand}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              + Add band
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-2">
            Bands define portfolio size ranges (e.g. 10–20%) and optional limits (max position size, max
            drawdown). Assign bands to positions in the position edit dialog.
          </p>
          {settingsBands.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No bands defined.</p>
          ) : (
            <ul className="space-y-3">
              {settingsBands.map((band) => (
                <li
                  key={band.id}
                  className="border border-gray-200 rounded-lg p-3 bg-gray-50/50 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <input
                      type="text"
                      value={band.name}
                      onChange={(e) => updateBand(band.id, { name: e.target.value })}
                      placeholder="Band name"
                      className="flex-1 min-w-0 px-2 py-1.5 text-sm text-black border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => removeBand(band.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                      title="Remove band"
                      aria-label="Remove band"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-gray-500">Size range %</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          value={band.sizeMinPct}
                          onChange={(e) =>
                            updateBand(band.id, { sizeMinPct: parseFloat(e.target.value) || 0 })
                          }
                          className="w-16 px-2 py-1 text-black border border-gray-300 rounded"
                        />
                        <span className="text-gray-400">–</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          value={band.sizeMaxPct}
                          onChange={(e) =>
                            updateBand(band.id, { sizeMaxPct: parseFloat(e.target.value) || 0 })
                          }
                          className="w-16 px-2 py-1 text-black border border-gray-300 rounded"
                        />
                      </div>
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-gray-500">Max position %</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        placeholder="—"
                        value={band.maxPositionSizePct ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateBand(band.id, {
                            maxPositionSizePct: v === '' ? undefined : parseFloat(v) || 0,
                          });
                        }}
                        className="w-full px-2 py-1 text-black border border-gray-300 rounded"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5 col-span-2">
                      <span className="text-gray-500">Max drawdown %</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        placeholder="—"
                        value={band.maxDrawdownPct ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateBand(band.id, {
                            maxDrawdownPct: v === '' ? undefined : parseFloat(v) || 0,
                          });
                        }}
                        className="w-full max-w-[8rem] px-2 py-1 text-black border border-gray-300 rounded"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5 col-span-2">
                      <span className="text-gray-500">Expected return range % (annual)</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={-100}
                          max={200}
                          step={0.5}
                          placeholder="Min"
                          value={band.expectedReturnMinPct ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateBand(band.id, {
                              expectedReturnMinPct: v === '' ? undefined : parseFloat(v) || 0,
                            });
                          }}
                          className="w-16 px-2 py-1 text-black border border-gray-300 rounded"
                        />
                        <span className="text-gray-400">–</span>
                        <input
                          type="number"
                          min={-100}
                          max={200}
                          step={0.5}
                          placeholder="Max"
                          value={band.expectedReturnMaxPct ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateBand(band.id, {
                              expectedReturnMaxPct: v === '' ? undefined : parseFloat(v) || 0,
                            });
                          }}
                          className="w-16 px-2 py-1 text-black border border-gray-300 rounded"
                        />
                      </div>
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={onSave}
            disabled={savingSettings || !settingsName.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
          >
            {savingSettings ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => portfolioId && onDeletePortfolio(portfolioId)}
            className="ml-auto px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md"
          >
            Delete portfolio
          </button>
        </div>
      </div>
    </div>
  );
}
