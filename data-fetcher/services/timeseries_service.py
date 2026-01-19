#!/usr/bin/env python3
"""
Timeseries Service

Service for managing timeseries data in Firebase Firestore.
Timeseries data is stored at: /tickers/{ticker}/timeseries/*
"""

from datetime import datetime
from typing import Dict, Optional, Any
from services.firebase_base_service import FirebaseBaseService


class TimeseriesService(FirebaseBaseService):
    """Service for managing timeseries data in Firebase"""
    
    def cache_quarterly_timeseries(self, ticker: str, data: Dict[str, Any]) -> None:
        """Cache quarterly time series data in ticker-specific collection"""
        try:
            doc_ref = self.db.collection('tickers').document(ticker.upper()).collection('timeseries').document('quarterly')
            data_with_timestamp = {
                **data,
                'last_updated': datetime.now().isoformat()
            }
            doc_ref.set(data_with_timestamp)
            print(f'Cached quarterly timeseries for {ticker.upper()} in tickers/{ticker.upper()}/timeseries/quarterly')
        except Exception as error:
            print(f'Error caching quarterly timeseries for {ticker}: {error}')
            raise error

    def get_quarterly_timeseries(self, ticker: str, max_age_hours: int = 24) -> Optional[Dict[str, Any]]:
        """Get quarterly time series data from ticker-specific collection"""
        try:
            doc_ref = self.db.collection('tickers').document(ticker.upper()).collection('timeseries').document('quarterly')
            doc = doc_ref.get()
            
            if doc.exists:
                data = doc.to_dict()
                
                # Return the data if it exists (no expiration logic)
                if data:
                    print(f'Retrieved quarterly timeseries for {ticker.upper()}')
                    # Remove last_updated from returned data
                    timeseries_data = {k: v for k, v in data.items() if k != 'last_updated'}
                    return timeseries_data
                
            return None
        except Exception as error:
            print(f'Error getting quarterly timeseries for {ticker}: {error}')
            return None
    
    def cache_kpi_timeseries(self, ticker: str, data: Dict[str, Any]) -> None:
        """Cache KPI time series data in ticker-specific collection
        
        Args:
            ticker: Stock ticker symbol
            data: KPI timeseries data dictionary
        """
        try:
            doc_ref = self.db.collection('tickers').document(ticker.upper()).collection('timeseries').document('kpi')
            data_with_timestamp = {
                **data,
                'last_updated': datetime.now().isoformat()
            }
            doc_ref.set(data_with_timestamp)
            print(f'Cached KPI timeseries for {ticker.upper()} in tickers/{ticker.upper()}/timeseries/kpi')
        except Exception as error:
            print(f'Error caching KPI timeseries for {ticker}: {error}')
            raise error






