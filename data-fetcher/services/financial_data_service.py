#!/usr/bin/env python3
"""
Financial Data Service

Service for managing financial data (SEC filings) in Firebase Firestore.
Financial data is stored at: /tickers/{ticker}/quarters/{period_key}
"""

from datetime import datetime
from typing import Dict, List, Optional, Any
from services.firebase_base_service import FirebaseBaseService


class FinancialDataService(FirebaseBaseService):
    """Service for managing financial data in Firebase"""
    
    def set_sec_financial_data(self, ticker: str, period_key: str, data: Dict[str, Any]) -> None:
        """Cache SEC comprehensive financial statement data
        
        Args:
            ticker: Stock ticker symbol
            period_key: Period identifier (e.g., '2021Q1', '2021_ANNUAL')
            data: Financial statement data including income statement, balance sheet, and cash flow
        """
        try:
            # Store in tickers/{ticker}/quarters/{period_key}
            doc_ref = (self.db.collection('tickers')
                      .document(ticker.upper())
                      .collection('quarters')
                      .document(period_key))
            
            doc_ref.set(data)
            
        except Exception as error:
            print(f'Error caching SEC financial data for {ticker} {period_key}: {error}')
            raise error
    
    def get_sec_financial_data(self, ticker: str, period_key: str) -> Optional[Dict[str, Any]]:
        """Get SEC comprehensive financial statement data for a specific period
        
        Args:
            ticker: Stock ticker symbol
            period_key: Period identifier (e.g., '2021Q1', '2021_ANNUAL')
            
        Returns:
            Financial statement data or None if not found
        """
        try:
            doc_ref = (self.db.collection('tickers')
                      .document(ticker.upper())
                      .collection('quarters')
                      .document(period_key))
            
            doc = doc_ref.get()
            if doc.exists:
                return doc.to_dict()
            return None
            
        except Exception as error:
            print(f'Error getting SEC financial data for {ticker} {period_key}: {error}')
            return None
    
    def get_all_sec_financial_data(self, ticker: str) -> List[Dict[str, Any]]:
        """Get all financial statement data for a ticker
        
        Args:
            ticker: Stock ticker symbol
            
        Returns:
            List of all financial data (quarterly and annual)
        """
        try:
            collection_ref = (self.db.collection('tickers')
                            .document(ticker.upper())
                            .collection('quarters'))
            
            docs = collection_ref.stream()
            
            all_data = []
            
            for doc in docs:
                data = doc.to_dict()
                all_data.append(data)
            
            # Sort by fiscal year and quarter
            all_data.sort(key=lambda x: (x.get('fiscal_year', 0), x.get('fiscal_quarter', 0)))
            
            return all_data
            
        except Exception as error:
            print(f'Error getting all financial data for {ticker}: {error}')
            return []
    
    def cache_quarterly_financial_data(self, ticker: str, quarter_key: str, financial_data: Dict[str, Any]) -> None:
        """Cache quarterly financial data to Firestore (alias for set_sec_financial_data)"""
        self.set_sec_financial_data(ticker, quarter_key, financial_data)
    
    def get_quarterly_financial_data(self, ticker: str, quarter_key: str) -> Optional[Dict[str, Any]]:
        """Get quarterly financial data from Firestore (alias for get_sec_financial_data)"""
        return self.get_sec_financial_data(ticker, quarter_key)

    def get_all_financial_data(self, ticker: str) -> List[Dict[str, Any]]:
        """Get all available financial data for a ticker"""
        return self.get_all_sec_financial_data(ticker)

    def get_financial_data_range(self, ticker: str, start_date: datetime, end_date: datetime) -> List[Dict[str, Any]]:
        """Get financial data for multiple quarters"""
        start_year = start_date.year
        end_year = end_date.year
        financial_data = []
        
        # Generate quarter keys for the range
        for year in range(start_year, end_year + 1):
            for quarter in range(1, 5):
                quarter_key = f'{year}Q{quarter}'
                quarter_data = self.get_sec_financial_data(ticker, quarter_key)
                
                if quarter_data:
                    # Check if quarter falls within date range using period_end_date
                    quarter_end_date_str = quarter_data.get('period_end_date')
                    
                    if quarter_end_date_str:
                        try:
                            quarter_end_date = datetime.strptime(quarter_end_date_str, '%Y-%m-%d')
                            if start_date <= quarter_end_date <= end_date:
                                financial_data.append(quarter_data)
                        except (ValueError, TypeError):
                            # If date parsing fails, include the quarter anyway
                            financial_data.append(quarter_data)
                    else:
                        # If no period_end_date is available, include the quarter based on year
                        if start_date.year <= year <= end_date.year:
                            financial_data.append(quarter_data)
        
        return sorted(financial_data, key=lambda x: (x['fiscal_year'], x['fiscal_quarter']))

