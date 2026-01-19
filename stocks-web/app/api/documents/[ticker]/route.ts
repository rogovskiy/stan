import { NextRequest, NextResponse } from 'next/server';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../lib/firebase';

interface DocumentMetadata {
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
  [quarterKey: string]: DocumentMetadata[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;

    if (!ticker) {
      return NextResponse.json(
        { error: 'Ticker parameter is required' },
        { status: 400 }
      );
    }

    console.log(`Documents API Request: ${ticker}`);

    // Get all documents for this ticker
    const documentsRef = collection(
      db,
      'tickers',
      ticker.toUpperCase(),
      'ir_documents'
    );

    const documentsSnapshot = await getDocs(documentsRef);

    if (documentsSnapshot.empty) {
      return NextResponse.json({
        success: true,
        ticker: ticker.toUpperCase(),
        documentsByQuarter: {},
        totalDocuments: 0
      });
    }

    // Group documents by quarter
    const documentsByQuarter: DocumentsByQuarter = {};
    const documents: DocumentMetadata[] = [];

    documentsSnapshot.forEach((doc) => {
      const docData = doc.data() as DocumentMetadata;
      docData.document_id = doc.id;

      documents.push(docData);

      // Use quarter_key if available, otherwise construct from fiscal_year and fiscal_quarter
      let quarterKey = docData.quarter_key;
      if (!quarterKey && docData.fiscal_year && docData.fiscal_quarter) {
        quarterKey = `${docData.fiscal_year}Q${docData.fiscal_quarter}`;
      } else if (!quarterKey && docData.fiscal_year) {
        // Annual documents (10-K, annual reports) - use Q4
        quarterKey = `${docData.fiscal_year}Q4`;
      }

      if (quarterKey) {
        if (!documentsByQuarter[quarterKey]) {
          documentsByQuarter[quarterKey] = [];
        }
        documentsByQuarter[quarterKey].push(docData);
      }
    });

    // Sort documents within each quarter by release_date (newest first)
    Object.keys(documentsByQuarter).forEach((quarterKey) => {
      documentsByQuarter[quarterKey].sort((a, b) => {
        const dateA = a.release_date ? new Date(a.release_date).getTime() : 0;
        const dateB = b.release_date ? new Date(b.release_date).getTime() : 0;
        return dateB - dateA; // Descending order (newest first)
      });
    });

    // Sort quarters in descending order (newest first)
    const sortedQuarterKeys = Object.keys(documentsByQuarter).sort((a, b) => {
      // Extract year and quarter for comparison
      const matchA = a.match(/(\d{4})Q(\d)/);
      const matchB = b.match(/(\d{4})Q(\d)/);
      
      if (!matchA || !matchB) return 0;
      
      const yearA = parseInt(matchA[1], 10);
      const quarterA = parseInt(matchA[2], 10);
      const yearB = parseInt(matchB[1], 10);
      const quarterB = parseInt(matchB[2], 10);
      
      if (yearA !== yearB) {
        return yearB - yearA; // Descending by year
      }
      return quarterB - quarterA; // Descending by quarter
    });

    const sortedDocumentsByQuarter: DocumentsByQuarter = {};
    sortedQuarterKeys.forEach((key) => {
      sortedDocumentsByQuarter[key] = documentsByQuarter[key];
    });

    return NextResponse.json({
      success: true,
      ticker: ticker.toUpperCase(),
      documentsByQuarter: sortedDocumentsByQuarter,
      totalDocuments: documents.length,
      quarters: sortedQuarterKeys
    });

  } catch (error) {
    console.error('Error in documents API:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}






