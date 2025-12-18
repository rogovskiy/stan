#!/usr/bin/env python3
"""
Price Data Service

Service for managing price data in Firebase Firestore and Storage.
Price data is stored at: /tickers/{ticker}/price/* and Storage price_data/
"""

import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from services.firebase_base_service import FirebaseBaseService


class PriceDataService(FirebaseBaseService):
    """Service for managing price data in Firebase"""
    
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




