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
    
    def cache_annual_price_data(self, ticker: str, year: int, price_data: Dict[str, Any]) -> None:
        """Cache annual price data to Firebase Storage and update consolidated reference"""
        try:
            upper_ticker = ticker.upper()
            
            # 1. Upload price data to Firebase Storage
            storage_path = f'price_data/{upper_ticker}/{year}.json'
            json_data = json.dumps(price_data, indent=2)
            
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
        """Cache quarterly financial data to Firestore"""
        try:
            doc_ref = self.db.collection('tickers').document(ticker.upper()).collection('quarters').document(quarter_key)
            financial_data_with_timestamp = {
                **financial_data,
                'last_updated': datetime.now().isoformat()
            }
            doc_ref.set(financial_data_with_timestamp)
            print(f'Cached financial data for {ticker} {quarter_key}')
        except Exception as error:
            print(f'Error caching financial data for {ticker} {quarter_key}: {error}')
            raise error
    
    def get_quarterly_financial_data(self, ticker: str, quarter_key: str) -> Optional[Dict[str, Any]]:
        """Get quarterly financial data from Firestore"""
        try:
            doc_ref = self.db.collection('tickers').document(ticker.upper()).collection('quarters').document(quarter_key)
            doc = doc_ref.get()
            
            if doc.exists:
                data = doc.to_dict()
                
                # Check if last_updated exists and is valid
                if 'last_updated' not in data:
                    print(f'Financial data missing timestamp for {ticker} {quarter_key} - treating as expired')
                    return None
                
                # Parse timestamp - handle both string and datetime
                last_updated = data['last_updated']
                if isinstance(last_updated, str):
                    try:
                        last_updated_dt = datetime.fromisoformat(last_updated.replace('Z', '+00:00'))
                    except ValueError:
                        # Fallback parsing
                        last_updated_dt = datetime.strptime(last_updated, '%Y-%m-%dT%H:%M:%S.%f')
                else:
                    last_updated_dt = last_updated
                
                # Determine cache policy based on quarter age
                quarter_end = datetime.strptime(f"{quarter_key[:4]}-12-31", '%Y-%m-%d')  # Approximate quarter end
                days_since_quarter = (datetime.now() - quarter_end).days
                
                if days_since_quarter > 90:  # Historical quarter (>90 days old)
                    max_age = timedelta(days=365)  # 1 year cache for historical data
                else:  # Recent quarter
                    max_age = timedelta(hours=12)  # 12 hours for recent data
                
                cache_age = datetime.now() - last_updated_dt
                
                if cache_age < max_age:
                    print(f'Financial cache hit for {ticker} {quarter_key}')
                    # Remove last_updated from returned data
                    financial_data = {k: v for k, v in data.items() if k != 'last_updated'}
                    return financial_data
                
                print(f'Financial cache expired for {ticker} {quarter_key}')
                return None
            
            return None
        except Exception as error:
            print(f'Error getting financial data for {ticker} {quarter_key}: {error}')
            return None

    def get_all_financial_data(self, ticker: str) -> List[Dict[str, Any]]:
        """Get all available financial data for a ticker (no date restrictions)"""
        financial_data = []
        
        # Check a wide range of years to find all available data
        # Starting from 1990 to current year + 5 should cover everything
        current_year = datetime.now().year
        for year in range(1990, current_year + 6):
            for quarter in range(1, 5):
                quarter_key = f'{year}Q{quarter}'
                quarter_data = self.get_quarterly_financial_data(ticker, quarter_key)
                
                if quarter_data:
                    financial_data.append(quarter_data)
        
        return financial_data

    def get_financial_data_range(self, ticker: str, start_date: datetime, end_date: datetime) -> List[Dict[str, Any]]:
        """Get financial data for multiple quarters"""
        start_year = start_date.year
        end_year = end_date.year
        financial_data = []
        
        # Generate quarter keys for the range
        for year in range(start_year, end_year + 1):
            for quarter in range(1, 5):
                quarter_key = f'{year}Q{quarter}'
                quarter_data = self.get_quarterly_financial_data(ticker, quarter_key)
                
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
                        blob = self.bucket.blob(year_data['storage_ref'])
                        blob.delete()
                        print(f'Deleted storage file: {year_data["storage_ref"]}')
                    except Exception as error:
                        print(f'Could not delete storage file {year_data["storage_ref"]}: {error}')
                
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
                quarter_data = self.get_quarterly_financial_data(ticker, quarter_key)
                
                if not quarter_data:
                    has_financial_data = False
                    missing_quarters.append(quarter_key)
        
        return {
            'has_all_price_data': has_price_data,
            'has_all_financial_data': has_financial_data,
            'missing_years': missing_years,
            'missing_quarters': missing_quarters
        }
    
    def cache_custom_data(self, key: str, data: Dict[str, Any]) -> None:
        """Cache custom data with a specific key"""
        try:
            doc_ref = self.db.collection('custom_data').document(key)
            data_with_timestamp = {
                **data,
                'last_updated': datetime.now().isoformat()
            }
            doc_ref.set(data_with_timestamp)
            print(f'Cached custom data for key: {key}')
        except Exception as error:
            print(f'Error caching custom data for {key}: {error}')
            raise error
    
    def get_custom_data(self, key: str, max_age_hours: int = 24) -> Optional[Dict[str, Any]]:
        """Get custom data by key"""
        try:
            doc_ref = self.db.collection('custom_data').document(key)
            doc = doc_ref.get()
            
            if doc.exists:
                data = doc.to_dict()
                
                # Check if data is still fresh
                cache_age = datetime.now() - datetime.fromisoformat(data['last_updated'])
                max_age = timedelta(hours=max_age_hours)
                
                if cache_age < max_age:
                    print(f'Custom data cache hit for {key}')
                    # Remove last_updated from returned data
                    custom_data = {k: v for k, v in data.items() if k != 'last_updated'}
                    return custom_data
                
                print(f'Custom data cache expired for {key}')
                return None
            
            return None
        except Exception as error:
            print(f'Error getting custom data for {key}: {error}')
            return None
    
    def _get_years_in_range(self, start_date: datetime, end_date: datetime) -> List[int]:
        """Get years in date range"""
        start_year = start_date.year
        end_year = end_date.year
        return list(range(start_year, end_year + 1))