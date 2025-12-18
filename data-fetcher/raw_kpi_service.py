#!/usr/bin/env python3
"""
Raw KPI Service

Service for managing raw KPIs extracted from quarterly investor relations documents in Firebase Firestore.
Raw KPIs are stored at: /tickers/{ticker}/raw_kpis/{quarter_key}

Raw KPIs are the KPIs as extracted from documents, before any unification or normalization.
They contain the full KPI objects with all metadata as extracted by the LLM.
"""

import os
from datetime import datetime
from typing import Dict, List, Optional, Any
import firebase_admin
from firebase_admin import credentials, firestore


class RawKPIService:
    """Service for managing raw KPIs in Firebase"""
    
    def __init__(self):
        self._init_firebase()
        self.db = firestore.client()
    
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
    
    def store_raw_kpis(self, ticker: str, quarter_key: str, raw_kpis: List[Dict[str, Any]], 
                       source_documents: List[str], verbose: bool = False) -> None:
        """Store raw KPIs extracted from quarterly documents
        
        Args:
            ticker: Stock ticker symbol
            quarter_key: Quarter key in format YYYYQN (e.g., "2025Q1")
            raw_kpis: List of raw KPI objects extracted from documents (full KPI objects with all metadata)
            source_documents: List of document IDs used for extraction
            verbose: Enable verbose output
        """
        try:
            upper_ticker = ticker.upper()
            
            # Parse quarter_key to get fiscal year and quarter
            year_str, quarter_str = quarter_key.split('Q')
            fiscal_year = int(year_str)
            fiscal_quarter = int(quarter_str)
            
            # Store main document
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('raw_kpis')
                      .document(quarter_key))
            
            raw_kpi_data = {
                'ticker': upper_ticker,
                'quarter_key': quarter_key,
                'fiscal_year': fiscal_year,
                'fiscal_quarter': fiscal_quarter,
                'raw_kpis': raw_kpis,
                'source_documents': source_documents,
                'num_documents': len(source_documents),
                'num_kpis': len(raw_kpis),
                'created_at': datetime.now().isoformat(),
                'extraction_type': 'raw'  # Mark as raw extraction (no unification)
            }
            
            # Check if document already exists to preserve created_at
            existing_doc = doc_ref.get()
            if existing_doc.exists:
                existing_data = existing_doc.to_dict()
                if existing_data and 'created_at' in existing_data:
                    raw_kpi_data['created_at'] = existing_data['created_at']
                raw_kpi_data['updated_at'] = datetime.now().isoformat()
            else:
                raw_kpi_data['updated_at'] = raw_kpi_data['created_at']
            
            doc_ref.set(raw_kpi_data)
            
            if verbose:
                print(f'✅ Stored {len(raw_kpis)} raw KPIs for {ticker} {quarter_key}')
                
        except Exception as error:
            print(f'Error storing raw KPIs for {ticker} {quarter_key}: {error}')
            raise error
    
    def get_raw_kpis(self, ticker: str, quarter_key: str) -> Optional[Dict[str, Any]]:
        """Get raw KPIs for a quarter
        
        Args:
            ticker: Stock ticker symbol
            quarter_key: Quarter key in format YYYYQN (e.g., "2025Q1")
            
        Returns:
            Dictionary with raw KPI data, or None if not found
        """
        try:
            upper_ticker = ticker.upper()
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('raw_kpis')
                      .document(quarter_key))
            
            doc = doc_ref.get()
            if doc.exists:
                return doc.to_dict()
            
            return None
            
        except Exception as error:
            print(f'Error getting raw KPIs for {ticker} {quarter_key}: {error}')
            return None
    
    def get_all_raw_kpis(self, ticker: str) -> List[Dict[str, Any]]:
        """Get all raw KPIs for a ticker across all quarters
        
        Args:
            ticker: Stock ticker symbol
            
        Returns:
            List of raw KPI dictionaries, sorted by quarter_key
        """
        try:
            upper_ticker = ticker.upper()
            
            docs_ref = (self.db.collection('tickers')
                       .document(upper_ticker)
                       .collection('raw_kpis'))
            
            docs = docs_ref.stream()
            
            raw_kpis_list = []
            for doc in docs:
                raw_kpi_data = doc.to_dict()
                raw_kpi_data['quarter_key'] = doc.id
                raw_kpis_list.append(raw_kpi_data)
            
            # Sort by quarter_key chronologically
            raw_kpis_list.sort(key=lambda x: (int(x.get('quarter_key', '0000Q0')[:4]), int(x.get('quarter_key', '0000Q0')[5])))
            
            return raw_kpis_list
            
        except Exception as error:
            print(f'Error getting all raw KPIs for {ticker}: {error}')
            return []
    
    def delete_raw_kpis(self, ticker: str, quarter_key: str, verbose: bool = False) -> bool:
        """Delete raw KPIs for a quarter
        
        Args:
            ticker: Stock ticker symbol
            quarter_key: Quarter key in format YYYYQN (e.g., "2025Q1")
            verbose: Enable verbose output
            
        Returns:
            True if deleted, False if not found
        """
        try:
            upper_ticker = ticker.upper()
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('raw_kpis')
                      .document(quarter_key))
            
            doc = doc_ref.get()
            if not doc.exists:
                if verbose:
                    print(f'Raw KPIs for {ticker} {quarter_key} not found')
                return False
            
            doc_ref.delete()
            
            if verbose:
                print(f'✅ Deleted raw KPIs for {ticker} {quarter_key}')
            
            return True
            
        except Exception as error:
            print(f'Error deleting raw KPIs for {ticker} {quarter_key}: {error}')
            return False
    
    def clear_all_raw_kpis(self, ticker: str, verbose: bool = False) -> int:
        """Clear all raw KPIs for a ticker
        
        Args:
            ticker: Stock ticker symbol
            verbose: Enable verbose output
            
        Returns:
            Number of quarters deleted
        """
        try:
            upper_ticker = ticker.upper()
            
            docs_ref = (self.db.collection('tickers')
                       .document(upper_ticker)
                       .collection('raw_kpis'))
            
            docs = list(docs_ref.stream())
            deleted_count = 0
            
            if verbose:
                print(f'🗑️  Clearing all raw KPIs for {upper_ticker}...')
                print(f'   Found {len(docs)} quarter(s)')
            
            for doc in docs:
                # Delete main document
                doc.reference.delete()
                deleted_count += 1
            
            if verbose:
                print(f'✅ Cleared {deleted_count} raw KPI quarter(s) for {upper_ticker}')
            
            return deleted_count
            
        except Exception as error:
            print(f'Error clearing all raw KPIs for {ticker}: {error}')
            raise error
    
    def get_raw_kpis_by_date_range(self, ticker: str, start_quarter: Optional[str] = None, 
                                    end_quarter: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get raw KPIs for a date range
        
        Args:
            ticker: Stock ticker symbol
            start_quarter: Optional start quarter in format YYYYQN (e.g., "2024Q1")
            end_quarter: Optional end quarter in format YYYYQN (e.g., "2025Q1")
            
        Returns:
            List of raw KPI dictionaries within the date range, sorted by quarter_key
        """
        try:
            all_raw_kpis = self.get_all_raw_kpis(ticker)
            
            if not start_quarter and not end_quarter:
                return all_raw_kpis
            
            filtered = []
            for raw_kpi in all_raw_kpis:
                quarter_key = raw_kpi.get('quarter_key', '')
                
                if start_quarter and quarter_key < start_quarter:
                    continue
                if end_quarter and quarter_key > end_quarter:
                    continue
                
                filtered.append(raw_kpi)
            
            return filtered
            
        except Exception as error:
            print(f'Error getting raw KPIs by date range for {ticker}: {error}')
            return []
    
    def get_raw_kpi_count(self, ticker: str, quarter_key: Optional[str] = None) -> int:
        """Get count of raw KPIs
        
        Args:
            ticker: Stock ticker symbol
            quarter_key: Optional quarter key. If provided, returns count for that quarter.
                        If None, returns total count across all quarters.
            
        Returns:
            Number of raw KPIs
        """
        try:
            if quarter_key:
                raw_kpi_data = self.get_raw_kpis(ticker, quarter_key)
                if raw_kpi_data:
                    return len(raw_kpi_data.get('raw_kpis', []))
                return 0
            else:
                all_raw_kpis = self.get_all_raw_kpis(ticker)
                total_count = 0
                for raw_kpi in all_raw_kpis:
                    total_count += len(raw_kpi.get('raw_kpis', []))
                return total_count
            
        except Exception as error:
            print(f'Error getting raw KPI count for {ticker}: {error}')
            return 0
    
    def link_raw_kpi_to_definition(self, ticker: str, quarter_key: str, kpi_name: str, 
                                    definition_id: str, target_semantic: Optional[Dict[str, Any]] = None,
                                    verbose: bool = False) -> bool:
        """Link a raw KPI to a KPI definition by adding definition_id field
        
        Args:
            ticker: Stock ticker symbol
            quarter_key: Quarter key in format YYYYQN (e.g., "2025Q1")
            kpi_name: Name of the raw KPI to link
            definition_id: Immutable KPI definition ID to link to
            target_semantic: Optional semantic_interpretation to match against (for disambiguation)
            verbose: Enable verbose output
            
        Returns:
            True if linked successfully, False otherwise
        """
        try:
            upper_ticker = ticker.upper()
            
            # Get the raw KPIs document
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('raw_kpis')
                      .document(quarter_key))
            
            doc = doc_ref.get()
            if not doc.exists:
                if verbose:
                    print(f'   ⚠️  Raw KPIs document not found for {ticker} {quarter_key}')
                return False
            
            doc_data = doc.to_dict()
            raw_kpis = doc_data.get('raw_kpis', [])
            
            # Find and update the specific KPI
            # If target_semantic is provided, match by semantic invariants for disambiguation
            # Otherwise, match by name (but this may link the wrong one if duplicates exist)
            updated = False
            matched_kpi = None
            
            for kpi in raw_kpis:
                if kpi.get('name', '') == kpi_name:
                    # If we have target semantic, verify it matches
                    if target_semantic:
                        kpi_semantic = kpi.get('semantic_interpretation', {})
                        if (kpi_semantic.get('measure_kind') == target_semantic.get('measure_kind') and
                            kpi_semantic.get('subject') == target_semantic.get('subject') and
                            kpi_semantic.get('subject_axis') == target_semantic.get('subject_axis') and
                            kpi_semantic.get('unit_family') == target_semantic.get('unit_family')):
                            # Check qualifiers match (inline implementation to avoid circular import)
                            def normalize_qualifiers_inline(qualifiers):
                                if qualifiers is None:
                                    return {}
                                if isinstance(qualifiers, list):
                                    if len(qualifiers) == 0:
                                        return {}
                                    result = {}
                                    for q in qualifiers:
                                        if isinstance(q, dict):
                                            key = q.get('key')
                                            value = q.get('value')
                                            if key and value:
                                                result[key] = value
                                    return result
                                if isinstance(qualifiers, dict):
                                    return qualifiers.copy() if qualifiers else {}
                                return {}
                            
                            def match_qualifiers_inline(q1, q2):
                                norm1 = normalize_qualifiers_inline(q1)
                                norm2 = normalize_qualifiers_inline(q2)
                                if not norm1 and not norm2:
                                    return True
                                if not norm1 or not norm2:
                                    return False
                                keys1 = set(norm1.keys())
                                keys2 = set(norm2.keys())
                                if keys1 != keys2:
                                    return False
                                for key in keys1:
                                    if norm1[key] != norm2[key]:
                                        return False
                                return True
                            
                            if match_qualifiers_inline(kpi_semantic.get('qualifiers'), target_semantic.get('qualifiers')):
                                matched_kpi = kpi
                                break
                    else:
                        # No semantic matching - use first match by name (may be wrong if duplicates)
                        matched_kpi = kpi
                        break
            
            if matched_kpi:
                # Check if already linked to a different definition
                existing_def_id = matched_kpi.get('definition_id')
                if existing_def_id and existing_def_id != definition_id:
                    if verbose:
                        print(f'   ⚠️  Raw KPI "{kpi_name}" already linked to definition {existing_def_id}, updating to {definition_id}')
                
                matched_kpi['definition_id'] = definition_id
                matched_kpi['linked_at'] = datetime.now().isoformat()
                updated = True
            
            if updated:
                # Update the document
                doc_ref.update({'raw_kpis': raw_kpis})
                
                if verbose:
                    print(f'   ✅ Linked "{kpi_name}" to definition ID: {definition_id}')
                return True
            else:
                if verbose:
                    if target_semantic:
                        print(f'   ⚠️  Raw KPI "{kpi_name}" with matching semantic_interpretation not found in document')
                    else:
                        print(f'   ⚠️  Raw KPI "{kpi_name}" not found in document')
                return False
            
        except Exception as error:
            print(f'Error linking raw KPI to definition: {error}')
            return False

