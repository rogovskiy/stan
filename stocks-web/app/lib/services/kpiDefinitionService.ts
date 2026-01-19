import { doc, getDoc, getDocs, collection, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import crypto from 'crypto';

/**
 * Generate an immutable KPI ID from semantic_interpretation
 * This matches the Python implementation - generates a 12-character MD5 hash
 */
function generateKpiId(semanticInterpretation: any): string {
  if (!semanticInterpretation) {
    throw new Error('semantic_interpretation is required to generate KPI ID');
  }

  const measureKind = semanticInterpretation.measure_kind || '';
  const subject = semanticInterpretation.subject || '';
  const subjectAxis = semanticInterpretation.subject_axis || '';
  const unitFamily = semanticInterpretation.unit_family || '';

  // Normalize qualifiers
  const qualifiers = semanticInterpretation.qualifiers;
  let qualifiersDict: Record<string, string> = {};

  if (qualifiers) {
    if (Array.isArray(qualifiers)) {
      qualifiers.forEach((q: any) => {
        if (q && typeof q === 'object' && q.key && q.value) {
          qualifiersDict[q.key] = q.value;
        }
      });
    } else if (typeof qualifiers === 'object') {
      qualifiersDict = { ...qualifiers };
    }
  }

  // Sort qualifiers by key for deterministic hashing
  const sortedQualifiers = Object.entries(qualifiersDict).sort(([a], [b]) => a.localeCompare(b));
  const qualifiersStr = JSON.stringify(sortedQualifiers);

  // Create deterministic string from invariants
  const invariantString = `${measureKind}|${subject}|${subjectAxis}|${unitFamily}|${qualifiersStr}`;

  // Generate MD5 hash and take first 12 characters
  const hash = crypto.createHash('md5').update(invariantString).digest('hex');
  return hash.substring(0, 12);
}

/**
 * Get all KPI definitions for a ticker
 */
export async function getKPIDefinitions(ticker: string): Promise<any[]> {
  try {
    const kpiDefinitionsRef = collection(db, 'tickers', ticker.toUpperCase(), 'kpi_definitions');
    const querySnapshot = await getDocs(kpiDefinitionsRef);
    
    const definitions: any[] = [];
    querySnapshot.forEach((doc) => {
      definitions.push(doc.data());
    });
    
    // Sort by name
    definitions.sort((a, b) => {
      const nameA = a.name || '';
      const nameB = b.name || '';
      return nameA.localeCompare(nameB);
    });
    
    return definitions;
  } catch (error) {
    console.error(`Error getting KPI definitions for ${ticker}:`, error);
    return [];
  }
}

/**
 * Create a KPI definition from a raw KPI
 */
export async function createKPIDefinition(
  ticker: string, 
  rawKpi: any, 
  quarterKey: string
): Promise<any> {
  try {
    const upperTicker = ticker.toUpperCase();
    const semanticInterpretation = rawKpi.semantic_interpretation;

    if (!semanticInterpretation) {
      throw new Error('Raw KPI must have semantic_interpretation to create a definition');
    }

    // Generate immutable ID from semantic_interpretation
    const kpiId = generateKpiId(semanticInterpretation);

    // Check if definition already exists
    const definitionRef = doc(db, 'tickers', upperTicker, 'kpi_definitions', kpiId);
    const existingSnap = await getDoc(definitionRef);
    const existingData = existingSnap.exists() ? existingSnap.data() : null;

    const now = new Date().toISOString();

    // Prepare definition data
    const definitionData: any = {
      id: kpiId,
      name: rawKpi.name || '',
      value: {
        unit: rawKpi.value?.unit || '',
        multiplier: rawKpi.value?.multiplier || null
      },
      value_type: rawKpi.value_type || '',
      summary: rawKpi.summary || '',
      source: rawKpi.source || '',
      semantic_interpretation: semanticInterpretation,
      updated_at: now
    };

    // If new document, set created_at; otherwise preserve existing
    if (!existingSnap.exists()) {
      definitionData.created_at = now;
    } else if (existingData?.created_at) {
      definitionData.created_at = existingData.created_at;
    }

    // Store the definition
    await setDoc(definitionRef, definitionData);

    return definitionData;
  } catch (error) {
    console.error(`Error creating KPI definition for ${ticker}:`, error);
    throw error;
  }
}

/**
 * Link a raw KPI to a definition by updating the raw_kpis document
 */
export async function linkRawKPIToDefinition(
  ticker: string,
  rawKpi: any,
  definitionId: string,
  quarterKey: string
): Promise<void> {
  try {
    const rawKpisRef = doc(db, 'tickers', ticker.toUpperCase(), 'raw_kpis', quarterKey);
    const rawKpisSnap = await getDoc(rawKpisRef);
    
    if (!rawKpisSnap.exists()) {
      throw new Error(`Raw KPIs document not found for ${ticker} ${quarterKey}`);
    }
    
    const data = rawKpisSnap.data();
    const rawKpis = data.raw_kpis || [];
    
    // Find and update the matching KPI
    const kpiName = rawKpi.name;
    const updatedKpis = rawKpis.map((kpi: any) => {
      if (kpi.name === kpiName) {
        return {
          ...kpi,
          definition_id: definitionId,
          linked_at: new Date().toISOString()
        };
      }
      return kpi;
    });
    
    await updateDoc(rawKpisRef, {
      raw_kpis: updatedKpis
    });
  } catch (error) {
    console.error(`Error linking raw KPI to definition for ${ticker}:`, error);
    throw error;
  }
}



