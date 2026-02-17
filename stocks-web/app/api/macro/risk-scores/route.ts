import { NextResponse } from 'next/server';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase';

const RISK_SCORES_PATH = ['macro', 'us_market', 'risk_scores'] as const;

/** YYYY-MM-DD pattern for dated document IDs */
const DATE_DOC_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface MacroScorePayload {
  asOf: string;
  macroMode: string;
  globalScore: number;
  confidence: number;
  transition: string;
  channelScores?: Record<string, number>;
  reasons?: string[];
}

export interface MacroRiskScoresResponse {
  latest: MacroScorePayload | null;
  history: MacroScorePayload[];
}

export async function GET() {
  try {
    const riskScoresRef = collection(db, RISK_SCORES_PATH[0], RISK_SCORES_PATH[1], RISK_SCORES_PATH[2]);

    const latestRef = doc(db, RISK_SCORES_PATH[0], RISK_SCORES_PATH[1], RISK_SCORES_PATH[2], 'latest');

    const [latestSnap, allDocsSnap] = await Promise.all([
      getDoc(latestRef),
      getDocs(riskScoresRef),
    ]);

    const latest = latestSnap.exists() ? (latestSnap.data() as MacroScorePayload) : null;

    const history: MacroScorePayload[] = [];
    allDocsSnap.docs.forEach((d) => {
      if (d.id === 'latest') return;
      if (!DATE_DOC_PATTERN.test(d.id)) return;
      const data = d.data() as MacroScorePayload;
      if (data?.asOf != null && typeof data.globalScore === 'number') {
        history.push(data);
      }
    });
    history.sort((a, b) => a.asOf.localeCompare(b.asOf));

    const response: MacroRiskScoresResponse = { latest, history };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Macro risk scores API error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch macro risk scores',
      },
      { status: 500 }
    );
  }
}
