#!/usr/bin/env python3
"""
Analyst Data Service

Service for managing analyst data in Firebase Firestore.
Analyst data is stored at: /tickers/{ticker}/analyst/*
"""

from datetime import datetime
from typing import Dict, List, Optional, Any
from services.firebase_base_service import FirebaseBaseService


class AnalystDataService(FirebaseBaseService):
    """Service for managing analyst data in Firebase"""
    
    def cache_analyst_data(self, ticker: str, all_analyst_data: Dict[str, Any], 
                          timestamp: Optional[datetime] = None) -> None:
        """Cache all analyst data types together in a consolidated document
        
        Args:
            ticker: Stock ticker symbol
            all_analyst_data: Dictionary containing all analyst data types:
                - 'price_targets': Optional price targets data
                - 'recommendations': Optional recommendations data
                - 'growth_estimates': Optional growth estimates data
                - 'earnings_trend': Optional earnings trend data
            timestamp: Optional timestamp (defaults to current time)
            
        Stores consolidated data at: tickers/{ticker}/analyst/{timestamp}
        Each document contains all available analyst data types at that timestamp.
        """
        try:
            if timestamp is None:
                timestamp = datetime.now()
            
            # Format timestamp as ISO string for document ID (replace colons for Firestore compatibility)
            timestamp_str = timestamp.strftime('%Y-%m-%dT%H-%M-%S')
            
            upper_ticker = ticker.upper()
            
            # Prepare consolidated document with all analyst data types
            doc_data = {
                'ticker': upper_ticker,
                'fetched_at': timestamp.isoformat(),
                'data_source': 'yfinance',
                'price_targets': all_analyst_data.get('price_targets'),
                'recommendations': all_analyst_data.get('recommendations'),
                'growth_estimates': all_analyst_data.get('growth_estimates'),
                'earnings_trend': all_analyst_data.get('earnings_trend')
            }
            
            # Remove None values to keep document clean
            doc_data = {k: v for k, v in doc_data.items() if v is not None}
            
            # Store consolidated document in Firestore
            # Structure: /tickers/{ticker}/analyst/{timestamp}
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('analyst')
                      .document(timestamp_str))
            
            doc_ref.set(doc_data)
            
            # Update latest reference document
            # Structure: /tickers/{ticker}/analyst/latest
            latest_ref = (self.db.collection('tickers')
                         .document(upper_ticker)
                         .collection('analyst')
                         .document('latest'))
            
            latest_ref.set({
                'latest_timestamp': timestamp_str,
                'fetched_at': timestamp.isoformat(),
                **doc_data
            })
            
        except Exception as error:
            print(f'Error caching consolidated analyst data for {ticker}: {error}')
            raise error
    
    def get_latest_analyst_data(self, ticker: str, data_type: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Get most recent analyst data snapshot
        
        Args:
            ticker: Stock ticker symbol
            data_type: Optional specific type to extract ('price_targets', 'recommendations', 
                     'growth_estimates', 'earnings_trend'). If None, returns all types.
            
        Returns:
            Latest analyst data dictionary (specific type or all types) or None if not found
        """
        try:
            upper_ticker = ticker.upper()
            
            # Get latest consolidated reference
            latest_ref = (self.db.collection('tickers')
                         .document(upper_ticker)
                         .collection('analyst')
                         .document('latest'))
            
            doc = latest_ref.get()
            if doc.exists:
                data = doc.to_dict()
                # Remove metadata fields
                metadata_fields = ['latest_timestamp', 'fetched_at', 'ticker', 'data_source']
                analyst_data = {k: v for k, v in data.items() if k not in metadata_fields}
                
                if data_type:
                    # Extract specific data type
                    return analyst_data.get(data_type)
                else:
                    # Return all analyst data types
                    return analyst_data if analyst_data else None
            
            return None
            
        except Exception as error:
            print(f'Error getting latest analyst data for {ticker} ({data_type or "all"}): {error}')
            return None
    
    def get_analyst_data_history(self, ticker: str, data_type: Optional[str] = None,
                                 start_date: Optional[datetime] = None,
                                 end_date: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """Get historical analyst data snapshots
        
        Args:
            ticker: Stock ticker symbol
            data_type: Optional specific type to extract from each snapshot. 
                     If None, returns all types from each snapshot.
            start_date: Optional start date filter
            end_date: Optional end date filter
            
        Returns:
            List of analyst data snapshots sorted by timestamp (most recent first)
            Each snapshot contains the requested data type(s)
        """
        try:
            upper_ticker = ticker.upper()
            
            # Query the consolidated analyst collection
            collection_ref = (self.db.collection('tickers')
                            .document(upper_ticker)
                            .collection('analyst'))
            
            # Get all documents from the collection
            docs = collection_ref.stream()
            
            history = []
            for doc in docs:
                # Skip the 'latest' document
                if doc.id == 'latest':
                    continue
                
                data = doc.to_dict()
                if not data or not data.get('fetched_at'):
                    continue
                
                # Apply date filters if provided
                fetched_at_str = data.get('fetched_at')
                if fetched_at_str:
                    fetched_at_dt = datetime.fromisoformat(fetched_at_str.replace('Z', '+00:00'))
                    
                    if start_date and fetched_at_dt < start_date:
                        continue
                    if end_date and fetched_at_dt > end_date:
                        continue
                
                # Extract specific data type if requested
                if data_type:
                    # Remove metadata fields
                    metadata_fields = ['ticker', 'fetched_at', 'data_source']
                    snapshot_data = {k: v for k, v in data.items() if k not in metadata_fields}
                    if data_type in snapshot_data:
                        history.append({
                            'fetched_at': data.get('fetched_at'),
                            data_type: snapshot_data[data_type]
                        })
                else:
                    # Return all data types
                    history.append(data)
            
            # Sort by fetched_at descending (most recent first)
            history.sort(key=lambda x: x.get('fetched_at', ''), reverse=True)
            
            return history
            
        except Exception as error:
            print(f'Error getting analyst data history for {ticker} ({data_type or "all"}): {error}')
            return []
    
    def get_all_analyst_data(self, ticker: str) -> Dict[str, Optional[Dict[str, Any]]]:
        """Get latest snapshot of all analyst data types (single document read)
        
        Args:
            ticker: Stock ticker symbol
            
        Returns:
            Dictionary with keys: 'price_targets', 'recommendations', 
            'growth_estimates', 'earnings_trend'
            Each value is the latest data snapshot or None if not available
        """
        try:
            # Single document read to get all analyst data
            all_data = self.get_latest_analyst_data(ticker, data_type=None)
            
            if not all_data:
                return {
                    'price_targets': None,
                    'recommendations': None,
                    'growth_estimates': None,
                    'earnings_trend': None
                }
            
            # Ensure all expected keys are present
            result = {
                'price_targets': all_data.get('price_targets'),
                'recommendations': all_data.get('recommendations'),
                'growth_estimates': all_data.get('growth_estimates'),
                'earnings_trend': all_data.get('earnings_trend')
            }
            
            return result
            
        except Exception as error:
            print(f'Error getting all analyst data for {ticker}: {error}')
            return {
                'price_targets': None,
                'recommendations': None,
                'growth_estimates': None,
                'earnings_trend': None
            }

