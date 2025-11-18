#!/usr/bin/env tsx

/**
 * Test script to investigate Yahoo Finance earnings data availability
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import YahooFinance from 'yahoo-finance2';

async function testEarningsData() {
  const yf = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] });
  
  console.log('🔍 Testing Yahoo Finance earnings data for AAPL...\n');
  
  try {
    // Test what modules are available
    console.log('1. Testing quoteSummary with earnings modules...');
    const quoteSummary = await yf.quoteSummary('AAPL', {
      modules: ['earnings', 'earningsHistory', 'earningsTrend', 'financialData']
    });
    
    console.log('\n📊 Available earnings modules:');
    console.log('- earnings:', !!quoteSummary?.earnings);
    console.log('- earningsHistory:', !!quoteSummary?.earningsHistory);
    console.log('- earningsTrend:', !!quoteSummary?.earningsTrend);
    console.log('- financialData:', !!quoteSummary?.financialData);
    
    // Check earningsHistory in detail
    if (quoteSummary?.earningsHistory) {
      const history = quoteSummary.earningsHistory.history || [];
      console.log(`\n📈 EarningsHistory contains ${history.length} records`);
      
      if (history.length > 0) {
        console.log('\nFirst record:', JSON.stringify(history[0], null, 2));
        console.log('\nLast record:', JSON.stringify(history[history.length - 1], null, 2));
        
        // Check date ranges
        const dates = history.map(h => h.quarter).filter(d => d instanceof Date);
        if (dates.length > 0) {
          const sortedDates = dates.sort((a, b) => a.getTime() - b.getTime());
          console.log(`\nDate range: ${sortedDates[0].toISOString()} to ${sortedDates[sortedDates.length - 1].toISOString()}`);
        }
      }
    }
    
    // Check earnings chart
    if (quoteSummary?.earnings?.earningsChart) {
      const quarterly = quoteSummary.earnings.earningsChart.quarterly || [];
      const yearly = quoteSummary.earnings.earningsChart.yearly || [];
      
      console.log(`\n📊 Earnings Chart:`)
      console.log(`- Quarterly records: ${quarterly.length}`);
      console.log(`- Yearly records: ${yearly.length}`);
      
      if (quarterly.length > 0) {
        console.log('\nQuarterly sample:', JSON.stringify(quarterly[0], null, 2));
      }
      
      if (yearly.length > 0) {
        console.log('\nYearly sample:', JSON.stringify(yearly[0], null, 2));
      }
    }
    
    // Test other financial modules
    console.log('\n2. Testing other financial modules...');
    
    try {
      const incomeStatement = await yf.quoteSummary('AAPL', {
        modules: ['incomeStatementHistory', 'incomeStatementHistoryQuarterly']
      });
      
      console.log('- incomeStatementHistory:', !!incomeStatement?.incomeStatementHistory);
      console.log('- incomeStatementHistoryQuarterly:', !!incomeStatement?.incomeStatementHistoryQuarterly);
      
      if (incomeStatement?.incomeStatementHistory?.incomeStatementHistory) {
        const statements = incomeStatement.incomeStatementHistory.incomeStatementHistory;
        console.log(`  Annual income statements: ${statements.length}`);
      }
      
      if (incomeStatement?.incomeStatementHistoryQuarterly?.incomeStatementHistory) {
        const statements = incomeStatement.incomeStatementHistoryQuarterly.incomeStatementHistory;
        console.log(`  Quarterly income statements: ${statements.length}`);
      }
    } catch (error) {
      console.log('Income statement modules failed:', error.message);
    }
    
    // Test fundamentalsTimeSeries (mentioned in the warning)
    console.log('\n3. Testing fundamentalsTimeSeries...');
    
    try {
      const fundamentals = await yf.fundamentalsTimeSeries('AAPL', {
        period1: new Date('2020-01-01'),
        period2: new Date(),
        frequency: 'quarterly'
      });
      
      console.log('fundamentalsTimeSeries result:', !!fundamentals);
      if (fundamentals) {
        console.log('Keys:', Object.keys(fundamentals));
      }
    } catch (error) {
      console.log('fundamentalsTimeSeries failed:', error.message);
    }
    
    // Test historical data for earnings dates
    console.log('\n4. Testing chart data for earnings correlation...');
    
    const chartData = await yf.chart('AAPL', {
      period1: new Date('2020-01-01'),
      period2: new Date(),
      interval: '1d',
      events: ['earnings', 'dividends', 'splits']
    });
    
    console.log('Chart data events:');
    console.log('- earnings events:', chartData.events?.earnings ? Object.keys(chartData.events.earnings).length : 0);
    console.log('- dividend events:', chartData.events?.dividends ? Object.keys(chartData.events.dividends).length : 0);
    console.log('- split events:', chartData.events?.splits ? Object.keys(chartData.events.splits).length : 0);
    
    if (chartData.events?.earnings) {
      console.log('\nSample earnings event:', JSON.stringify(Object.values(chartData.events.earnings)[0], null, 2));
    }
    
  } catch (error) {
    console.error('Error testing earnings data:', error);
  }
}

testEarningsData().catch(console.error);