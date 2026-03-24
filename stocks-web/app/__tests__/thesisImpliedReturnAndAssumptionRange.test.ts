import { parseAssumptionRangeToPctInterval, stripAssumptionPercentSigns } from '../lib/positionThesisAssumptionRange';
import {
  getImpliedReturnIntervalFromPayload,
  getImpliedReturnMidpointFromPayload,
} from '../lib/thesisImpliedReturnFromPayload';
import {
  computeBandThesisReturnSignal,
  computePositionThesisReturnRowIssue,
} from '../lib/portfolioBandThesisReturnAlignment';
import type { PositionThesisPayload } from '../lib/types/positionThesis';
import type { Band } from '../lib/services/portfolioService';

const basePayload = (g: string, d: string): PositionThesisPayload =>
  ({
    ticker: 'X',
    positionRole: '',
    holdingHorizon: '',
    thesisStatement: '',
    portfolioRole: '',
    regimeDesignedFor: '',
    entryPrice: '',
    upsideDividendAssumption: '',
    upsideGrowthAssumption: '',
    upsideMultipleAssumption: '',
    baseDividendAssumption: d,
    baseGrowthAssumption: g,
    baseMultipleBasis: 'P/E',
    baseMultipleAssumption: '',
    downsideDividendAssumption: '',
    downsideGrowthAssumption: '',
    downsideMultipleAssumption: '',
    upsideScenario: '',
    baseScenario: '',
    downsideScenario: '',
    drivers: [],
    failures: [],
    distanceToFailure: '',
    currentVolRegime: '',
    riskPosture: '',
    trimRule: '',
    exitRule: '',
    addRule: '',
    systemMonitoringSignals: '',
  }) as PositionThesisPayload;

describe('parseAssumptionRangeToPctInterval', () => {
  it('parses range with en dash and percents', () => {
    expect(parseAssumptionRangeToPctInterval('4–6')).toEqual({ min: 4, max: 6 });
    expect(parseAssumptionRangeToPctInterval('4%–6%')).toEqual({ min: 4, max: 6 });
  });

  it('parses single number and to-form', () => {
    expect(parseAssumptionRangeToPctInterval('3.5%')).toEqual({ min: 3.5, max: 3.5 });
    expect(parseAssumptionRangeToPctInterval('2 to 5')).toEqual({ min: 2, max: 5 });
  });

  it('returns null for empty or gibberish', () => {
    expect(parseAssumptionRangeToPctInterval('')).toBeNull();
    expect(parseAssumptionRangeToPctInterval('see notes')).toBeNull();
  });

  it('swaps when low > high', () => {
    expect(parseAssumptionRangeToPctInterval('8–3')).toEqual({ min: 3, max: 8 });
  });
});

describe('stripAssumptionPercentSigns', () => {
  it('removes percent signs', () => {
    expect(stripAssumptionPercentSigns('4%–6%')).toBe('4–6');
  });
});

describe('getImpliedReturnIntervalFromPayload', () => {
  it('adds growth and yield intervals', () => {
    expect(getImpliedReturnIntervalFromPayload(basePayload('4–6', '2–3'))).toEqual({
      min: 6,
      max: 9,
    });
    expect(getImpliedReturnMidpointFromPayload(basePayload('10', '2'))).toBe(12);
  });

  it('treats missing or unparseable growth as 0 when yield is present', () => {
    expect(getImpliedReturnIntervalFromPayload(basePayload('', '2'))).toEqual({ min: 2, max: 2 });
    expect(getImpliedReturnMidpointFromPayload(basePayload('', '3–4'))).toBe(3.5);
    expect(getImpliedReturnIntervalFromPayload(basePayload('see notes', '2'))).toEqual({
      min: 2,
      max: 2,
    });
  });

  it('treats missing or unparseable dividend yield as 0 when growth is present', () => {
    expect(getImpliedReturnIntervalFromPayload(basePayload('5', ''))).toEqual({ min: 5, max: 5 });
    expect(getImpliedReturnIntervalFromPayload(basePayload('5', 'see notes'))).toEqual({
      min: 5,
      max: 5,
    });
  });

  it('is 0 when growth and yield both blank or unparseable', () => {
    expect(getImpliedReturnIntervalFromPayload(basePayload('', ''))).toEqual({ min: 0, max: 0 });
    expect(getImpliedReturnMidpointFromPayload(basePayload('see notes', 'see notes'))).toBe(0);
  });
});

describe('computeBandThesisReturnSignal', () => {
  const band: Band = {
    id: 'b1',
    name: 'Growth',
    sizeMinPct: 0,
    sizeMaxPct: 20,
    expectedReturnMinPct: 8,
    expectedReturnMaxPct: 15,
  };

  it('no_signal without ER on band', () => {
    const b2: Band = { ...band, expectedReturnMinPct: undefined, expectedReturnMaxPct: undefined };
    expect(computeBandThesisReturnSignal(b2, [{ ticker: 'A', thesisId: 't1' }], {})).toEqual({
      kind: 'no_signal',
    });
  });

  it('no_signal when no linked theses', () => {
    expect(
      computeBandThesisReturnSignal(band, [{ ticker: 'A', thesisId: null }], {})
    ).toEqual({ kind: 'no_signal' });
  });

  it('thesis_incomplete when payload missing or unparseable', () => {
    const r = computeBandThesisReturnSignal(
      band,
      [
        { ticker: 'A', thesisId: 't1' },
        { ticker: 'B', thesisId: 't2' },
      ],
      { t1: basePayload('8', '2'), t2: null }
    );
    expect(r.kind).toBe('thesis_incomplete');
    if (r.kind === 'thesis_incomplete') {
      expect(r.incompleteTickers).toContain('B');
    }
  });

  it('misaligned when average midpoint outside band', () => {
    const r = computeBandThesisReturnSignal(
      band,
      [
        { ticker: 'A', thesisId: 't1' },
        { ticker: 'B', thesisId: 't2' },
      ],
      {
        t1: basePayload('2', '1'),
        t2: basePayload('3', '1'),
      }
    );
    expect(r.kind).toBe('misaligned');
  });

  it('ok when average inside band', () => {
    const r = computeBandThesisReturnSignal(
      band,
      [{ ticker: 'A', thesisId: 't1' }],
      { t1: basePayload('8', '2') }
    );
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.averageMidPct).toBe(10);
    }
  });
});

describe('computePositionThesisReturnRowIssue', () => {
  const band: Band = {
    id: 'b1',
    name: 'G',
    sizeMinPct: 0,
    sizeMaxPct: 100,
    expectedReturnMinPct: 5,
    expectedReturnMaxPct: 10,
  };

  it('none without thesis', () => {
    expect(computePositionThesisReturnRowIssue(band, { ticker: 'A', thesisId: null }, undefined)).toBe(
      'none'
    );
  });

  it('none when growth and yield blank (both default to 0)', () => {
    expect(
      computePositionThesisReturnRowIssue(band, { ticker: 'A', thesisId: 'x' }, basePayload('', ''))
    ).toBe('none');
  });

  it('none when only yield set (growth missing defaults to 0)', () => {
    expect(
      computePositionThesisReturnRowIssue(band, { ticker: 'A', thesisId: 'x' }, basePayload('', '5'))
    ).toBe('none');
  });

  it('none when only growth set (yield missing defaults to 0)', () => {
    expect(
      computePositionThesisReturnRowIssue(band, { ticker: 'A', thesisId: 'x' }, basePayload('5', ''))
    ).toBe('none');
  });
});
