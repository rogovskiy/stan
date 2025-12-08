#!/usr/bin/env python3
"""
Firebase Cache Service - Python Version

Handles caching to Firebase Firestore and Storage using firebase-admin SDK.
"""

import os
import json
import io
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
import firebase_admin
from firebase_admin import credentials, firestore, storage
from google.cloud import storage as gcs


class FirebaseCache:
    """Service for caching data to Firebase"""
    
    def __init__(self):
        self._init_firebase()
        self.db = firestore.client()
        self.bucket = storage.bucket()
    
    def _init_firebase(self):
        """Initialize Firebase Admin SDK"""
        if not firebase_admin._apps:
            # Create credentials from environment variables
            private_key = os.getenv("FIREBASE_PRIVATE_KEY")
            if not private_key:
                raise ValueError("FIREBASE_PRIVATE_KEY environment variable is not set")
            
            # Handle the private key formatting
            private_key = private_key.replace('\\n', '\n')
            
            cred_dict = {
                "type": "service_account",
                "project_id": os.getenv("FIREBASE_PROJECT_ID"),
                "private_key_id": os.getenv("FIREBASE_PRIVATE_KEY_ID"),
                "private_key": private_key,
                "client_email": os.getenv("FIREBASE_CLIENT_EMAIL"),
                "client_id": os.getenv("FIREBASE_CLIENT_ID"),
                "auth_uri": os.getenv("FIREBASE_AUTH_URI", "https://accounts.google.com/o/oauth2/auth"),
                "token_uri": os.getenv("FIREBASE_TOKEN_URI", "https://oauth2.googleapis.com/token")
            }
            
            # Use the correct storage bucket from environment or fallback to default
            storage_bucket = os.getenv("FIREBASE_STORAGE_BUCKET") or f"{os.getenv('FIREBASE_PROJECT_ID')}.appspot.com"
            
            cred = credentials.Certificate(cred_dict)
            firebase_admin.initialize_app(cred, {
                'storageBucket': storage_bucket
            })
    
    def cache_ticker_metadata(self, ticker: str, metadata: Dict[str, Any]) -> None:
        """Cache ticker metadata to Firestore"""
        try:
            doc_ref = self.db.collection('tickers').document(ticker.upper())
            metadata_with_timestamp = {
                **metadata,
                'last_updated': datetime.now().isoformat()
            }
            doc_ref.set(metadata_with_timestamp)
            print(f'Cached metadata for {ticker}')
        except Exception as error:
            print(f'Error caching metadata for {ticker}: {error}')
            raise error
    
    def get_ticker_metadata(self, ticker: str) -> Optional[Dict[str, Any]]:
        """Get ticker metadata from Firestore"""
        try:
            doc_ref = self.db.collection('tickers').document(ticker.upper())
            doc = doc_ref.get()
            
            if doc.exists:
                data = doc.to_dict()
                
                # Check if metadata is stale (older than 7 days)
                last_updated = data.get('last_updated')
                if last_updated:
                    cache_age = datetime.now() - datetime.fromisoformat(last_updated)
                    max_age = timedelta(days=7)
                    
                    if cache_age < max_age:
                        print(f'Metadata cache hit for {ticker}')
                        return data
                
                print(f'Metadata cache expired for {ticker}')
                return None
            
            return None
        except Exception as error:
            print(f'Error getting metadata for {ticker}: {error}')
            return None
    
    def cache_annual_price_data(self, ticker: str, year: int, price_data: Dict[str, Any], verbose: bool = True) -> None:
        """Cache annual price data to Firebase Storage and update consolidated reference"""
        try:
            upper_ticker = ticker.upper()
            
            # 1. Upload price data to Firebase Storage
            storage_path = f'price_data/{upper_ticker}/{year}.json'
            json_data = json.dumps(price_data, indent=2)
            
            if verbose:
                print(f'Uploading price data for {ticker} {year} to Storage...')
            blob = self.bucket.blob(storage_path)
            blob.upload_from_string(json_data, content_type='application/json')
            
            # Make blob publicly readable
            blob.make_public()
            download_url = blob.public_url
            
            # 2. Calculate metadata
            data_entries = list(price_data['data'].items())
            prices = [data['c'] for _, data in data_entries]
            volumes = [data['v'] for _, data in data_entries]
            
            year_reference = {
                'year': year,
                'start_date': f'{year}-01-01',
                'end_date': f'{year}-12-31',
                'storage_ref': storage_path,
                'download_url': download_url,
                'metadata': {
                    'total_days': len(data_entries),
                    'first_close': prices[0] if prices else 0,
                    'last_close': prices[-1] if prices else 0,
                    'avg_volume': round(sum(volumes) / len(volumes)) if volumes else 0,
                    'file_size': len(json_data.encode('utf-8')),
                    'compressed': False
                },
                'last_updated': datetime.now().isoformat()
            }
            
            # 3. Update consolidated priceData document
            price_data_ref = self.db.collection('tickers').document(upper_ticker).collection('price').document('consolidated')
            price_data_doc = price_data_ref.get()
            
            if price_data_doc.exists:
                consolidated_data = price_data_doc.to_dict()
            else:
                consolidated_data = {
                    'last_updated': datetime.now().isoformat(),
                    'data_source': 'yfinance_python',
                    'years': {}
                }
            
            # Update the specific year and overall timestamp
            consolidated_data['years'][str(year)] = year_reference
            consolidated_data['last_updated'] = datetime.now().isoformat()
            
            price_data_ref.set(consolidated_data)
            
            if verbose:
                print(f'Cached annual price data for {ticker} {year} ({len(json_data.encode("utf-8"))} bytes)')
        except Exception as error:
            print(f'Error caching annual price data for {ticker} {year}: {error}')
            raise error
    
    def get_annual_price_reference(self, ticker: str, year: int) -> Optional[Dict[str, Any]]:
        """Get annual price reference from consolidated document"""
        try:
            price_data_ref = self.db.collection('tickers').document(ticker.upper()).collection('price').document('consolidated')
            price_data_doc = price_data_ref.get()
            
            if price_data_doc.exists:
                consolidated_data = price_data_doc.to_dict()
                year_data = consolidated_data.get('years', {}).get(str(year))
                
                if year_data:
                    # Check cache age
                    current_year = datetime.now().year
                    max_age = timedelta(hours=24) if year == current_year else timedelta(days=30)
                    
                    cache_age = datetime.now() - datetime.fromisoformat(year_data['last_updated'])
                    
                    if cache_age < max_age:
                        print(f'Annual price reference cache hit for {ticker} {year}')
                        return year_data
                    
                    print(f'Annual price reference cache expired for {ticker} {year}')
            
            return None
        except Exception as error:
            print(f'Error getting annual price reference for {ticker} {year}: {error}')
            return None
    
    def download_annual_price_data(self, reference: Dict[str, Any]) -> Dict[str, Any]:
        """Download annual price data from Firebase Storage"""
        try:
            print(f'Downloading price data from Storage: {reference["storage_ref"]}')
            
            blob = self.bucket.blob(reference['storage_ref'])
            json_data = blob.download_as_text()
            price_data = json.loads(json_data)
            
            return price_data
        except Exception as error:
            print(f'Error downloading annual price data: {error}')
            raise error
    
    def get_price_data_range(self, ticker: str, start_date: datetime, end_date: datetime) -> Dict[str, Any]:
        """Get price data for a date range (across multiple years)"""
        years = self._get_years_in_range(start_date, end_date)
        price_data = {}
        
        for year in years:
            reference = self.get_annual_price_reference(ticker, year)
            if reference:
                annual_data = self.download_annual_price_data(reference)
                
                # Filter dates within the requested range
                for date_str, day_data in annual_data['data'].items():
                    date_obj = datetime.strptime(date_str, '%Y-%m-%d')
                    if start_date <= date_obj <= end_date:
                        price_data[date_str] = day_data
        
        return price_data
    
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
    
    def clear_cache(self, ticker: Optional[str] = None) -> None:
        """Clear cache for a specific ticker"""
        if not ticker:
            print('Clearing all cache not implemented - please specify a ticker')
            return
        
        try:
            upper_ticker = ticker.upper()
            
            # Delete metadata
            meta_ref = self.db.collection('tickers').document(upper_ticker)
            meta_ref.delete()
            
            # Get consolidated price data and delete storage files
            price_data_ref = self.db.collection('tickers').document(upper_ticker).collection('price').document('consolidated')
            price_data_doc = price_data_ref.get()
            
            if price_data_doc.exists:
                consolidated_data = price_data_doc.to_dict()
                
                # Delete all storage files
                for year_data in consolidated_data.get('years', {}).values():
                    try:
                        if isinstance(year_data, dict) and 'storage_ref' in year_data:
                            blob = self.bucket.blob(year_data['storage_ref'])
                            blob.delete()
                            print(f'Deleted storage file: {year_data["storage_ref"]}')
                        else:
                            print(f'Skipping invalid year_data structure: {type(year_data)}')
                    except Exception as error:
                        storage_ref = year_data.get('storage_ref', 'unknown') if isinstance(year_data, dict) else 'unknown'
                        print(f'Could not delete storage file {storage_ref}: {error}')
                
                # Delete consolidated price data document
                price_data_ref.delete()
            
            # Delete all financial data
            quarters_ref = self.db.collection('tickers').document(upper_ticker).collection('quarters')
            quarters = quarters_ref.stream()
            
            for quarter in quarters:
                quarter.reference.delete()
            
            print(f'Cleared all cache for {ticker}')
            
        except Exception as error:
            print(f'Error clearing cache for {ticker}: {error}')
            raise error
    
    def has_cached_data_for_range(self, ticker: str, start_date: datetime, end_date: datetime) -> Dict[str, Any]:
        """Check if we have cached data for a date range"""
        years = self._get_years_in_range(start_date, end_date)
        missing_years = []
        missing_quarters = []
        has_price_data = True
        has_financial_data = True
        
        # Check price data
        try:
            price_data_ref = self.db.collection('tickers').document(ticker.upper()).collection('price').document('consolidated')
            price_data_doc = price_data_ref.get()
            
            if price_data_doc.exists:
                consolidated_data = price_data_doc.to_dict()
                
                for year in years:
                    year_data = consolidated_data.get('years', {}).get(str(year))
                    if not year_data:
                        has_price_data = False
                        missing_years.append(year)
                    else:
                        # Check if cached data is still valid
                        current_year = datetime.now().year
                        max_age = timedelta(hours=24) if year == current_year else timedelta(days=30)
                        
                        cache_age = datetime.now() - datetime.fromisoformat(year_data['last_updated'])
                        if cache_age >= max_age:
                            has_price_data = False
                            missing_years.append(year)
            else:
                has_price_data = False
                missing_years.extend(years)
        except Exception as error:
            print(f'Error checking price data cache: {error}')
            has_price_data = False
            missing_years.extend(years)
        
        # Check financial data (quarterly)
        start_year = start_date.year
        end_year = end_date.year
        
        for year in range(start_year, end_year + 1):
            for quarter in range(1, 5):
                quarter_key = f'{year}Q{quarter}'
                quarter_data = self.get_sec_financial_data(ticker, quarter_key)
                
                if not quarter_data:
                    has_financial_data = False
                    missing_quarters.append(quarter_key)
        
        return {
            'has_all_price_data': has_price_data,
            'has_all_financial_data': has_financial_data,
            'missing_years': missing_years,
            'missing_quarters': missing_quarters
        }
    

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
    
    
    def cache_split_history(self, ticker: str, splits: List[Dict[str, Any]], verbose: bool = True) -> None:
        """Cache stock split history to Firestore
        
        Args:
            ticker: Stock ticker symbol
            splits: List of split dictionaries with keys: date, split_ratio, description
            verbose: Show progress messages
        """
        try:
            upper_ticker = ticker.upper()
            
            # Store splits in tickers/{ticker}/price/splits
            splits_ref = (self.db.collection('tickers')
                         .document(upper_ticker)
                         .collection('price')
                         .document('splits'))
            
            splits_data = {
                'ticker': upper_ticker,
                'splits': splits,
                'total_splits': len(splits),
                'last_updated': datetime.now().isoformat()
            }
            
            splits_ref.set(splits_data)
            
            if verbose:
                print(f'Cached {len(splits)} stock splits for {ticker}')
        except Exception as error:
            print(f'Error caching split history for {ticker}: {error}')
            raise error
    
    def get_split_history(self, ticker: str) -> Optional[List[Dict[str, Any]]]:
        """Get stock split history from Firestore
        
        Args:
            ticker: Stock ticker symbol
            
        Returns:
            List of split dictionaries or None if not found
        """
        try:
            splits_ref = (self.db.collection('tickers')
                         .document(ticker.upper())
                         .collection('price')
                         .document('splits'))
            
            doc = splits_ref.get()
            if doc.exists:
                data = doc.to_dict()
                return data.get('splits', [])
            return None
            
        except Exception as error:
            print(f'Error getting split history for {ticker}: {error}')
            return None
    
    def _get_years_in_range(self, start_date: datetime, end_date: datetime) -> List[int]:
        """Get years in date range"""
        start_year = start_date.year
        end_year = end_date.year
        return list(range(start_year, end_year + 1))
    
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
    
    def store_ir_document(self, ticker: str, document_id: str, document_data: Dict[str, Any], 
                         file_content: bytes, file_extension: str = 'pdf', verbose: bool = True) -> None:
        """Store IR document in Firebase Storage and metadata in Firestore
        
        Args:
            ticker: Stock ticker symbol
            document_id: Unique document identifier
            document_data: Document metadata dictionary
            file_content: Binary content of the document
            file_extension: File extension (default: 'pdf')
            verbose: Enable verbose output
        """
        try:
            upper_ticker = ticker.upper()
            
            # 1. Upload document to Firebase Storage
            storage_path = f'ir_documents/{upper_ticker}/{document_id}.{file_extension}'
            
            if verbose:
                print(f'Uploading IR document {document_id} for {ticker} to Storage...')
            
            blob = self.bucket.blob(storage_path)
            blob.upload_from_string(file_content, content_type=f'application/{file_extension}')
            
            # Make blob publicly readable
            blob.make_public()
            download_url = blob.public_url
            
            # 2. Store metadata in Firestore
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('ir_documents')
                      .document(document_id))
            
            metadata = {
                **document_data,
                'document_storage_ref': storage_path,
                'document_download_url': download_url,
                'scanned_at': datetime.now().isoformat()
            }
            
            doc_ref.set(metadata)
            
            if verbose:
                print(f'✅ Stored IR document {document_id} for {ticker}')
                
        except Exception as error:
            print(f'Error storing IR document {document_id} for {ticker}: {error}')
            raise error
    
    def get_ir_documents_for_quarter(self, ticker: str, quarter_key: str) -> List[Dict[str, Any]]:
        """Get all IR documents for a specific quarter
        
        Args:
            ticker: Stock ticker symbol
            quarter_key: Quarter key in format YYYYQN (e.g., "2024Q3")
            
        Returns:
            List of document metadata dictionaries
        """
        try:
            upper_ticker = ticker.upper()
            
            # Query documents by quarter_key
            docs_ref = (self.db.collection('tickers')
                       .document(upper_ticker)
                       .collection('ir_documents'))
            
            query = docs_ref.where('quarter_key', '==', quarter_key)
            docs = query.stream()
            
            documents = []
            for doc in docs:
                doc_data = doc.to_dict()
                doc_data['document_id'] = doc.id
                documents.append(doc_data)
            
            return documents
            
        except Exception as error:
            print(f'Error getting IR documents for {ticker} {quarter_key}: {error}')
            return []
    
    def get_ir_document_content(self, ticker: str, document_id: str) -> Optional[bytes]:
        """Download document content from Firebase Storage
        
        Args:
            ticker: Stock ticker symbol
            document_id: Document identifier
            
        Returns:
            Document content as bytes, or None if not found
        """
        try:
            upper_ticker = ticker.upper()
            
            # Get document metadata to find storage path
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('ir_documents')
                      .document(document_id))
            
            doc = doc_ref.get()
            if not doc.exists:
                return None
            
            doc_data = doc.to_dict()
            storage_ref = doc_data.get('document_storage_ref')
            
            if not storage_ref:
                return None
            
            # Download from Storage
            blob = self.bucket.blob(storage_ref)
            if not blob.exists():
                return None
            
            return blob.download_as_bytes()
            
        except Exception as error:
            print(f'Error getting document content for {ticker} {document_id}: {error}')
            return None
    
    def store_ir_kpis(self, ticker: str, quarter_key: str, kpis: Dict[str, Any], 
                     source_documents: List[str], llm_metadata: Dict[str, Any], 
                     verbose: bool = True) -> None:
        """Store consolidated KPIs for a quarter
        
        Args:
            ticker: Stock ticker symbol
            quarter_key: Quarter key in format YYYYQN (e.g., "2024Q3")
            kpis: Dictionary of extracted KPIs
            source_documents: List of document IDs used for extraction
            llm_metadata: Metadata about LLM extraction (model, etc.)
            verbose: Enable verbose output
        """
        try:
            upper_ticker = ticker.upper()
            
            # Parse quarter_key to get fiscal year and quarter
            year_str, quarter_str = quarter_key.split('Q')
            fiscal_year = int(year_str)
            fiscal_quarter = int(quarter_str)
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('ir_kpis')
                      .document(quarter_key))
            
            kpi_data = {
                'ticker': upper_ticker,
                'quarter_key': quarter_key,
                'fiscal_year': fiscal_year,
                'fiscal_quarter': fiscal_quarter,
                'extracted_kpis': kpis,
                'source_documents': source_documents,
                'extraction_timestamp': datetime.now().isoformat(),
                'llm_metadata': llm_metadata
            }
            
            doc_ref.set(kpi_data)
            
            if verbose:
                print(f'✅ Stored IR KPIs for {ticker} {quarter_key}')
                
        except Exception as error:
            print(f'Error storing IR KPIs for {ticker} {quarter_key}: {error}')
            raise error
    
    def get_ir_kpis(self, ticker: str, quarter_key: str) -> Optional[Dict[str, Any]]:
        """Get consolidated KPIs for a quarter
        
        Args:
            ticker: Stock ticker symbol
            quarter_key: Quarter key in format YYYYQN (e.g., "2024Q3")
            
        Returns:
            KPI data dictionary or None if not found
        """
        try:
            upper_ticker = ticker.upper()
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('ir_kpis')
                      .document(quarter_key))
            
            doc = doc_ref.get()
            if doc.exists:
                return doc.to_dict()
            
            return None
            
        except Exception as error:
            print(f'Error getting IR KPIs for {ticker} {quarter_key}: {error}')
            return None
    
    def get_existing_quarter_kpis(self, ticker: str, quarter_key: str) -> Optional[Dict[str, Any]]:
        """Get existing KPIs from quarters collection for context
        
        Args:
            ticker: Stock ticker symbol
            quarter_key: Quarter key in format YYYYQN (e.g., "2024Q3")
            
        Returns:
            Financial data dictionary from quarters collection or None
        """
        try:
            upper_ticker = ticker.upper()
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('quarters')
                      .document(quarter_key))
            
            doc = doc_ref.get()
            if doc.exists:
                return doc.to_dict()
            
            return None
            
        except Exception as error:
            print(f'Error getting existing quarter KPIs for {ticker} {quarter_key}: {error}')
            return None
    
    def store_company_summary(self, ticker: str, summary_data: Dict[str, Any]) -> None:
        """Store company summary in Firestore
        
        Args:
            ticker: Stock ticker symbol
            summary_data: Dictionary containing summary, business_model, competitive_moat, etc.
        """
        try:
            upper_ticker = ticker.upper()
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('company_summary')
                      .document('summary'))
            
            doc_ref.set(summary_data)
            
            print(f'✅ Stored company summary for {ticker}')
                
        except Exception as error:
            print(f'Error storing company summary for {ticker}: {error}')
            raise error
    
    def get_company_summary(self, ticker: str) -> Optional[Dict[str, Any]]:
        """Get company summary from Firestore
        
        Args:
            ticker: Stock ticker symbol
            
        Returns:
            Dictionary with company summary data, or None if not found
        """
        try:
            upper_ticker = ticker.upper()
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('company_summary')
                      .document('summary'))
            
            doc = doc_ref.get()
            if doc.exists:
                return doc.to_dict()
            
            return None
            
        except Exception as error:
            print(f'Error getting company summary for {ticker}: {error}')
            return None
    
    def store_quarterly_analysis(self, ticker: str, quarter_key: str, analysis_data: Dict[str, Any], verbose: bool = True) -> None:
        """Store quarterly analysis in Firestore
        
        Args:
            ticker: Stock ticker symbol
            quarter_key: Quarter key in format YYYYQN (e.g., "2025Q1")
            analysis_data: Dictionary containing summary, growth_theses, custom_kpis, etc.
            verbose: Enable verbose output
        """
        try:
            upper_ticker = ticker.upper()
            
            # Parse quarter_key to get fiscal year and quarter
            year_str, quarter_str = quarter_key.split('Q')
            fiscal_year = int(year_str)
            fiscal_quarter = int(quarter_str)
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('quarterly_analysis')
                      .document(quarter_key))
            
            # Add metadata
            analysis_data['ticker'] = upper_ticker
            analysis_data['quarter_key'] = quarter_key
            analysis_data['fiscal_year'] = fiscal_year
            analysis_data['fiscal_quarter'] = fiscal_quarter
            analysis_data['stored_at'] = datetime.now().isoformat()
            
            doc_ref.set(analysis_data)
            
            if verbose:
                print(f'✅ Stored quarterly analysis for {ticker} {quarter_key}')
                
        except Exception as error:
            print(f'Error storing quarterly analysis for {ticker} {quarter_key}: {error}')
            raise error
    
    def get_quarterly_analysis(self, ticker: str, quarter_key: str) -> Optional[Dict[str, Any]]:
        """Get quarterly analysis from Firestore
        
        Args:
            ticker: Stock ticker symbol
            quarter_key: Quarter key in format YYYYQN (e.g., "2025Q1")
            
        Returns:
            Dictionary with quarterly analysis data, or None if not found
        """
        try:
            upper_ticker = ticker.upper()
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('quarterly_analysis')
                      .document(quarter_key))
            
            doc = doc_ref.get()
            if doc.exists:
                return doc.to_dict()
            
            return None
            
        except Exception as error:
            print(f'Error getting quarterly analysis for {ticker} {quarter_key}: {error}')
            return None
    
    def get_all_quarterly_analyses(self, ticker: str) -> List[Dict[str, Any]]:
        """Get all quarterly analyses for a ticker
        
        Args:
            ticker: Stock ticker symbol
            
        Returns:
            List of quarterly analysis dictionaries, sorted by quarter_key
        """
        try:
            upper_ticker = ticker.upper()
            
            docs_ref = (self.db.collection('tickers')
                       .document(upper_ticker)
                       .collection('quarterly_analysis'))
            
            docs = docs_ref.stream()
            
            analyses = []
            for doc in docs:
                doc_data = doc.to_dict()
                doc_data['quarter_key'] = doc.id
                analyses.append(doc_data)
            
            # Sort by quarter_key chronologically
            analyses.sort(key=lambda x: (int(x.get('quarter_key', '0000Q0')[:4]), int(x.get('quarter_key', '0000Q0')[5])))
            
            return analyses
            
        except Exception as error:
            print(f'Error getting all quarterly analyses for {ticker}: {error}')
            return []