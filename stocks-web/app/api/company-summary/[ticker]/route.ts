import { NextRequest, NextResponse } from 'next/server';
import { getTickerMetadata } from '../../../lib/services/tickerMetadataService';

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

    console.log(`Company Summary API Request: ${ticker}`);

    // Get company information data from main ticker document with price refresh
    const companyData = await getTickerMetadata(ticker, true);

    if (!companyData) {
      return NextResponse.json(
        { 
          error: 'Company information not found',
          message: `No company information found for ${ticker}. Run the company info generator script first.`,
          suggestion: `python generate_company_summary.py ${ticker}`
        },
        { status: 404 }
      );
    }

    // Return all company information fields, including longBusinessSummary and price
    return NextResponse.json({
      success: true,
      ticker: ticker.toUpperCase(),
      data: {
        longBusinessSummary: companyData.longBusinessSummary,
        // Include all other fields for future display purposes
        industry: companyData.industry,
        sector: companyData.sector,
        exchange: companyData.exchange,
        fiscalYearEndMonth: companyData.fiscalYearEndMonth,
        fiscalYearEndDate: companyData.fiscalYearEndDate,
        longName: companyData.longName,
        shortName: companyData.shortName,
        name: companyData.name,
        country: companyData.country,
        website: companyData.website,
        fullTimeEmployees: companyData.fullTimeEmployees,
        source: companyData.source,
        lastUpdated: companyData.lastUpdated,
        // Include price fields
        lastPrice: companyData.lastPrice,
        lastPriceTimestamp: companyData.lastPriceTimestamp
      }
    });
    
  } catch (error) {
    console.error('Error in company summary API:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}





