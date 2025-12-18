#!/usr/bin/env python3
"""
KPI Definitions Service

Service for managing KPI definitions in Firebase Firestore.
KPI definitions are stored at: /tickers/{ticker}/kpi_definitions/{kpi_name}

A KPI definition is similar to a KPI but without the numeric value.
It contains: name, unit, multiplier, value_type, summary, source, group, other_names
"""

import os
from datetime import datetime
from typing import Dict, List, Optional, Any
import firebase_admin
from firebase_admin import credentials, firestore


class KPIDefinitionsService:
    """Service for managing KPI definitions in Firebase"""
    
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
    
    def _generate_kpi_id(self, semantic_interpretation: Dict[str, Any]) -> str:
        """Generate an immutable ID from semantic_interpretation fields
        
        This ID is generated from the semantic invariants including qualifiers
        and never changes, even if the KPI name changes later. The ID is based on:
        - measure_kind
        - subject
        - subject_axis
        - unit_family
        - qualifiers (normalized and sorted)
        
        Args:
            semantic_interpretation: Dictionary with semantic_interpretation fields
            
        Returns:
            Hash-based ID string (12 characters)
        """
        import hashlib
        import json
        
        if not semantic_interpretation:
            raise ValueError("semantic_interpretation is required to generate KPI ID")
        
        # Extract the four semantic invariants
        measure_kind = semantic_interpretation.get('measure_kind', '')
        subject = semantic_interpretation.get('subject', '')
        subject_axis = semantic_interpretation.get('subject_axis', '')
        unit_family = semantic_interpretation.get('unit_family', '')
        
        # Normalize qualifiers for consistent hashing
        qualifiers = semantic_interpretation.get('qualifiers')
        qualifiers_dict = {}
        
        if qualifiers is not None:
            if isinstance(qualifiers, list):
                for q in qualifiers:
                    if isinstance(q, dict):
                        key = q.get('key')
                        value = q.get('value')
                        if key and value:
                            qualifiers_dict[key] = value
            elif isinstance(qualifiers, dict):
                qualifiers_dict = qualifiers.copy() if qualifiers else {}
        
        # Sort qualifiers by key for deterministic hashing
        sorted_qualifiers = sorted(qualifiers_dict.items())
        qualifiers_str = json.dumps(sorted_qualifiers, sort_keys=True)
        
        # Create a deterministic string from the invariants including qualifiers
        invariant_string = f"{measure_kind}|{subject}|{subject_axis}|{unit_family}|{qualifiers_str}"
        
        # Generate hash-based ID
        kpi_id = hashlib.md5(invariant_string.encode()).hexdigest()[:12]
        return kpi_id
    
    def _normalize_kpi_name_for_doc_id(self, semantic_interpretation: Dict[str, Any]) -> str:
        """Generate KPI ID from semantic_interpretation
        
        This is now an alias for _generate_kpi_id for backward compatibility.
        We use the immutable ID based on semantic invariants as the document ID.
        """
        return self._generate_kpi_id(semantic_interpretation)
    
    def _find_kpi_by_name_or_id(self, ticker: str, identifier: str) -> Optional[tuple[Dict[str, Any], str]]:
        """Find a KPI definition by name or ID
        
        Args:
            ticker: Stock ticker symbol
            identifier: KPI name or ID (12-character hash)
            
        Returns:
            Tuple of (definition_dict, kpi_id) or (None, None) if not found
        """
        upper_ticker = ticker.upper()
        
        # First try by ID (12-character hash)
        if len(identifier) == 12 and all(c in '0123456789abcdef' for c in identifier):
            kpi_id = identifier
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('kpi_definitions')
                      .document(kpi_id))
            
            doc = doc_ref.get()
            if doc.exists:
                return doc.to_dict(), kpi_id
        
        # If not found by ID, search by name
        all_definitions = self.get_all_kpi_definitions(upper_ticker)
        for definition in all_definitions:
            if definition.get('name', '').lower() == identifier.lower():
                return definition, definition.get('id')
        
        return None, None
    
    def set_kpi_definition(self, ticker: str, kpi_definition: Dict[str, Any], verbose: bool = False) -> str:
        """Store a KPI definition
        
        Args:
            ticker: Stock ticker symbol
            kpi_definition: KPI definition dictionary (without numeric value)
                Required fields: name, semantic_interpretation (with measure_kind, subject, subject_axis, unit_family)
                Optional fields: value (with unit and multiplier), value_type, summary, source
            verbose: Enable verbose output
            
        Returns:
            Immutable KPI ID (12-character hash based on semantic_interpretation)
        """
        try:
            upper_ticker = ticker.upper()
            kpi_name = kpi_definition.get('name', '')
            semantic_interpretation = kpi_definition.get('semantic_interpretation', {})
            
            if not kpi_name:
                raise ValueError("KPI definition must have a 'name' field")
            
            if not semantic_interpretation:
                raise ValueError("KPI definition must have a 'semantic_interpretation' field")
            
            # Generate immutable ID from semantic_interpretation
            kpi_id = self._generate_kpi_id(semantic_interpretation)
            
            # Check if definition already exists
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('kpi_definitions')
                      .document(kpi_id))
            
            existing_doc = doc_ref.get()
            existing_data = existing_doc.to_dict() if existing_doc.exists else None
            
            # Prepare the definition data
            definition_data = {
                'id': kpi_id,  # Immutable ID based on semantic_interpretation
                'name': kpi_name,  # Current name (can change)
                'value': {
                    'unit': kpi_definition.get('value', {}).get('unit', ''),
                    'multiplier': kpi_definition.get('value', {}).get('multiplier')
                },
                'value_type': kpi_definition.get('value_type', ''),
                'summary': kpi_definition.get('summary', ''),
                'source': kpi_definition.get('source', ''),
                'semantic_interpretation': semantic_interpretation,  # Required field
                'updated_at': datetime.now().isoformat()
            }
            
            # If this is a new document, set created_at
            if not existing_doc.exists:
                definition_data['created_at'] = datetime.now().isoformat()
            else:
                # Preserve created_at from existing document
                if existing_data and 'created_at' in existing_data:
                    definition_data['created_at'] = existing_data['created_at']
                # Preserve the original ID (immutable)
                definition_data['id'] = existing_data.get('id', kpi_id)
            
            doc_ref.set(definition_data)
            
            if verbose:
                print(f'✅ Stored KPI definition "{kpi_name}" (ID: {kpi_id}) for {ticker}')
            
            return kpi_id
            
        except Exception as error:
            print(f'Error storing KPI definition for {ticker}: {error}')
            raise error
    
    def get_kpi_definition(self, ticker: str, kpi_name: str) -> Optional[Dict[str, Any]]:
        """Get a KPI definition by name or ID
        
        Args:
            ticker: Stock ticker symbol
            kpi_name: KPI name or ID
            
        Returns:
            KPI definition dictionary or None if not found
        """
        try:
            definition, _ = self._find_kpi_by_name_or_id(ticker, kpi_name)
            return definition
            
        except Exception as error:
            print(f'Error getting KPI definition "{kpi_name}" for {ticker}: {error}')
            return None
    
    def get_kpi_definition_by_id(self, ticker: str, kpi_id: str) -> Optional[Dict[str, Any]]:
        """Get a KPI definition by immutable ID
        
        Args:
            ticker: Stock ticker symbol
            kpi_id: Immutable KPI ID (lowercase snake_case)
            
        Returns:
            KPI definition dictionary or None if not found
        """
        try:
            upper_ticker = ticker.upper()
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('kpi_definitions')
                      .document(kpi_id))
            
            doc = doc_ref.get()
            if doc.exists:
                return doc.to_dict()
            
            return None
            
        except Exception as error:
            print(f'Error getting KPI definition by ID "{kpi_id}" for {ticker}: {error}')
            return None
    
    def get_all_kpi_definitions(self, ticker: str) -> List[Dict[str, Any]]:
        """Get all KPI definitions for a ticker
        
        Args:
            ticker: Stock ticker symbol
            
        Returns:
            List of KPI definition dictionaries
        """
        try:
            upper_ticker = ticker.upper()
            
            docs_ref = (self.db.collection('tickers')
                       .document(upper_ticker)
                       .collection('kpi_definitions'))
            
            docs = docs_ref.stream()
            
            definitions = []
            for doc in docs:
                definition_data = doc.to_dict()
                definitions.append(definition_data)
            
            # Sort by name
            definitions.sort(key=lambda x: x.get('name', ''))
            
            return definitions
            
        except Exception as error:
            print(f'Error getting all KPI definitions for {ticker}: {error}')
            return []
    
    def update_kpi_definition(self, ticker: str, kpi_name: str, updates: Dict[str, Any], verbose: bool = False) -> bool:
        """Update specific fields of a KPI definition
        
        Args:
            ticker: Stock ticker symbol
            kpi_name: KPI name (used to find the definition)
            updates: Dictionary of fields to update
            verbose: Enable verbose output
            
        Returns:
            True if updated, False if not found
        """
        try:
            upper_ticker = ticker.upper()
            # Find by name first
            definition, doc_id = self._find_kpi_by_name_or_id(upper_ticker, kpi_name)
            if not definition:
                if verbose:
                    print(f'KPI definition "{kpi_name}" not found for {ticker}')
                return False
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('kpi_definitions')
                      .document(doc_id))
            
            doc = doc_ref.get()
            if not doc.exists:
                if verbose:
                    print(f'KPI definition "{kpi_name}" not found for {ticker}')
                return False
            
            # Prepare update data
            update_data = {
                'updated_at': datetime.now().isoformat()
            }
            
            # Handle nested value updates
            if 'value' in updates:
                current_data = doc.to_dict()
                current_value = current_data.get('value', {})
                new_value = updates.pop('value')
                update_data['value'] = {
                    'unit': new_value.get('unit', current_value.get('unit', '')),
                    'multiplier': new_value.get('multiplier', current_value.get('multiplier'))
                }
            
            # Add other updates
            update_data.update(updates)
            
            doc_ref.update(update_data)
            
            if verbose:
                print(f'✅ Updated KPI definition "{kpi_name}" for {ticker}')
            
            return True
            
        except Exception as error:
            print(f'Error updating KPI definition "{kpi_name}" for {ticker}: {error}')
            return False
    
    def delete_kpi_definition(self, ticker: str, kpi_name: str, verbose: bool = False) -> bool:
        """Delete a KPI definition
        
        Args:
            ticker: Stock ticker symbol
            kpi_name: KPI name
            verbose: Enable verbose output
            
        Returns:
            True if deleted, False if not found
        """
        try:
            upper_ticker = ticker.upper()
            # Find by name first
            definition, doc_id = self._find_kpi_by_name_or_id(upper_ticker, kpi_name)
            if not definition:
                if verbose:
                    print(f'KPI definition "{kpi_name}" not found for {ticker}')
                return False
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('kpi_definitions')
                      .document(doc_id))
            
            doc_ref.delete()
            
            if verbose:
                print(f'✅ Deleted KPI definition "{kpi_name}" for {ticker}')
            
            return True
            
        except Exception as error:
            print(f'Error deleting KPI definition "{kpi_name}" for {ticker}: {error}')
            return False
    
    def bulk_set_kpi_definitions(self, ticker: str, kpi_definitions: List[Dict[str, Any]], verbose: bool = False) -> int:
        """Store multiple KPI definitions at once
        
        Args:
            ticker: Stock ticker symbol
            kpi_definitions: List of KPI definition dictionaries
            verbose: Enable verbose output
            
        Returns:
            Number of definitions stored
        """
        try:
            count = 0
            for kpi_def in kpi_definitions:
                self.set_kpi_definition(ticker, kpi_def, verbose=False)
                count += 1
            
            if verbose:
                print(f'✅ Stored {count} KPI definitions for {ticker}')
            
            return count
            
        except Exception as error:
            print(f'Error bulk storing KPI definitions for {ticker}: {error}')
            raise error
    
    def get_kpi_definitions_by_group(self, ticker: str, group: str) -> List[Dict[str, Any]]:
        """Get all KPI definitions for a specific group
        
        Args:
            ticker: Stock ticker symbol
            group: Group name
            
        Returns:
            List of KPI definition dictionaries
        """
        try:
            upper_ticker = ticker.upper()
            
            docs_ref = (self.db.collection('tickers')
                       .document(upper_ticker)
                       .collection('kpi_definitions'))
            
            # Query by group
            query = docs_ref.where('group', '==', group)
            docs = query.stream()
            
            definitions = []
            for doc in docs:
                definition_data = doc.to_dict()
                definitions.append(definition_data)
            
            # Sort by name
            definitions.sort(key=lambda x: x.get('name', ''))
            
            return definitions
            
        except Exception as error:
            print(f'Error getting KPI definitions by group "{group}" for {ticker}: {error}')
            return []
    
    def search_kpi_definitions(self, ticker: str, search_term: str) -> List[Dict[str, Any]]:
        """Search KPI definitions by name or other_names
        
        Args:
            ticker: Stock ticker symbol
            search_term: Search term (case-insensitive)
            
        Returns:
            List of matching KPI definition dictionaries
        """
        try:
            all_definitions = self.get_all_kpi_definitions(ticker)
            search_term_lower = search_term.lower()
            
            matches = []
            for definition in all_definitions:
                name = definition.get('name', '').lower()
                other_names = [n.lower() for n in definition.get('other_names', [])]
                
                if (search_term_lower in name or 
                    any(search_term_lower in other_name for other_name in other_names)):
                    matches.append(definition)
            
            return matches
            
        except Exception as error:
            print(f'Error searching KPI definitions for {ticker}: {error}')
            return []
    
    def set_kpi_value(self, ticker: str, kpi_name: str, quarter_key: str, value: float, verbose: bool = False) -> bool:
        """Store a KPI value for a specific quarter
        
        Values are stored at: /tickers/{ticker}/kpi_definitions/{kpi_id}/values/{quarter_key}
        
        Args:
            ticker: Stock ticker symbol
            kpi_name: KPI name (will be converted to ID)
            quarter_key: Quarter key in format YYYYQN (e.g., "2025Q1")
            value: Numeric value for the KPI
            verbose: Enable verbose output
            
        Returns:
            True if stored successfully, False otherwise
        """
        try:
            upper_ticker = ticker.upper()
            
            # Find the KPI definition to get the immutable ID
            definition, kpi_id = self._find_kpi_by_name_or_id(upper_ticker, kpi_name)
            
            if not definition:
                if verbose:
                    print(f'⚠️  KPI definition "{kpi_name}" not found for {ticker}. Cannot create definition without semantic_interpretation.')
                return False
            
            # Use the immutable ID for storage
            if not kpi_id:
                kpi_id = definition.get('id')
                if not kpi_id:
                    if verbose:
                        print(f'⚠️  KPI definition "{kpi_name}" has no ID')
                    return False
            
            # Store the value in the values subcollection using the immutable ID
            value_doc_ref = (self.db.collection('tickers')
                           .document(upper_ticker)
                           .collection('kpi_definitions')
                           .document(kpi_id)
                           .collection('values')
                           .document(quarter_key))
            
            value_data = {
                'kpi_id': kpi_id,  # Store immutable ID
                'kpi_name': definition.get('name', kpi_name) if definition else kpi_name,  # Current name
                'quarter_key': quarter_key,
                'value': value,
                'updated_at': datetime.now().isoformat()
            }
            
            # Check if value already exists to add created_at
            existing_value = value_doc_ref.get()
            is_new_value = not existing_value.exists
            
            if is_new_value:
                value_data['created_at'] = datetime.now().isoformat()
                if verbose:
                    print(f'✅ Stored value {value} for KPI "{kpi_name}" (ID: {kpi_id}) ({quarter_key})')
            else:
                if verbose:
                    print(f'✅ Updated value {value} for KPI "{kpi_name}" (ID: {kpi_id}) ({quarter_key})')
            
            value_doc_ref.set(value_data)
            
            return True
            
        except Exception as error:
            print(f'Error storing KPI value for {ticker} {kpi_name} {quarter_key}: {error}')
            return False
    
    def get_kpi_value(self, ticker: str, kpi_id: str, quarter_key: str) -> Optional[float]:
        """Get a KPI value for a specific quarter using the immutable ID
        
        Args:
            ticker: Stock ticker symbol
            kpi_id: Immutable KPI ID (lowercase snake_case)
            quarter_key: Quarter key in format YYYYQN (e.g., "2025Q1")
            
        Returns:
            Numeric value or None if not found
        """
        try:
            upper_ticker = ticker.upper()
            
            value_doc_ref = (self.db.collection('tickers')
                           .document(upper_ticker)
                           .collection('kpi_definitions')
                           .document(kpi_id)
                           .collection('values')
                           .document(quarter_key))
            
            doc = value_doc_ref.get()
            if doc.exists:
                data = doc.to_dict()
                return data.get('value')
            
            return None
            
        except Exception as error:
            print(f'Error getting KPI value for {ticker} {kpi_id} {quarter_key}: {error}')
            return None
    
    def get_all_kpi_values(self, ticker: str, kpi_id: str) -> List[Dict[str, Any]]:
        """Get all values for a KPI across all quarters using the immutable ID
        
        Args:
            ticker: Stock ticker symbol
            kpi_id: Immutable KPI ID (lowercase snake_case)
            
        Returns:
            List of value dictionaries with quarter_key and value, sorted by quarter_key
        """
        try:
            upper_ticker = ticker.upper()
            
            values_ref = (self.db.collection('tickers')
                         .document(upper_ticker)
                         .collection('kpi_definitions')
                         .document(kpi_id)
                         .collection('values'))
            
            docs = values_ref.stream()
            
            values = []
            for doc in docs:
                value_data = doc.to_dict()
                values.append({
                    'quarter_key': doc.id,
                    'value': value_data.get('value'),
                    'created_at': value_data.get('created_at'),
                    'updated_at': value_data.get('updated_at')
                })
            
            # Sort by quarter_key chronologically
            values.sort(key=lambda x: (int(x['quarter_key'][:4]), int(x['quarter_key'][5])))
            
            return values
            
        except Exception as error:
            print(f'Error getting all KPI values for {ticker} {kpi_id}: {error}')
            return []
    
    def clear_all_kpi_data(self, ticker: str, verbose: bool = False) -> int:
        """Clear all KPI data for a ticker using batch deletes
        
        This includes:
        - All quarterly_analysis documents
        - KPI timeseries
        - All KPI definitions and their values
        
        Uses Firestore batch writes (up to 500 operations per batch) for efficiency.
        
        Args:
            ticker: Stock ticker symbol
            verbose: Enable verbose output
            
        Returns:
            Number of items deleted
        """
        try:
            from firebase_admin import firestore
            
            upper_ticker = ticker.upper()
            deleted_count = 0
            BATCH_SIZE = 500  # Firestore batch limit
            
            if verbose:
                print(f'🗑️  Clearing all KPI data for {upper_ticker}...')
            
            ticker_ref = self.db.collection('tickers').document(upper_ticker)
            
            # Collect all document references to delete
            doc_refs_to_delete = []
            
            # 1. Collect quarterly_analysis documents
            quarterly_analysis_ref = ticker_ref.collection('quarterly_analysis')
            quarterly_docs = list(quarterly_analysis_ref.stream())
            for doc in quarterly_docs:
                doc_refs_to_delete.append(doc.reference)
            if verbose and quarterly_docs:
                print(f'   Found {len(quarterly_docs)} quarterly_analysis document(s)')
            
            # 2. Collect KPI timeseries document
            timeseries_ref = ticker_ref.collection('timeseries').document('kpi')
            timeseries_doc = timeseries_ref.get()
            if timeseries_doc.exists:
                doc_refs_to_delete.append(timeseries_ref)
                if verbose:
                    print(f'   Found KPI timeseries document')
            
            # 3. Collect all KPI definitions and their values
            kpi_definitions_ref = ticker_ref.collection('kpi_definitions')
            all_definitions = list(kpi_definitions_ref.stream())
            
            for def_doc in all_definitions:
                doc_id = def_doc.id
                # Collect all values for this KPI definition
                values_ref = def_doc.reference.collection('values')
                value_docs = list(values_ref.stream())
                for value_doc in value_docs:
                    doc_refs_to_delete.append(value_doc.reference)
                
                # Add the definition document itself
                doc_refs_to_delete.append(def_doc.reference)
            
            if verbose and all_definitions:
                total_values = sum(len(list(doc.reference.collection('values').stream())) for doc in all_definitions)
                print(f'   Found {len(all_definitions)} KPI definition(s) with {total_values} value(s)')
            
            # Delete in batches
            total_to_delete = len(doc_refs_to_delete)
            if total_to_delete == 0:
                if verbose:
                    print(f'   No KPI data found to delete')
                return 0
            
            if verbose:
                print(f'   Deleting {total_to_delete} document(s) in batches of {BATCH_SIZE}...')
            
            # Process in batches
            for i in range(0, total_to_delete, BATCH_SIZE):
                batch = self.db.batch()
                batch_docs = doc_refs_to_delete[i:i + BATCH_SIZE]
                
                for doc_ref in batch_docs:
                    batch.delete(doc_ref)
                
                batch.commit()
                deleted_count += len(batch_docs)
                
                if verbose:
                    print(f'   Deleted batch {i // BATCH_SIZE + 1}: {len(batch_docs)} document(s)')
            
            if verbose:
                print(f'✅ Cleared {deleted_count} KPI data item(s) for {upper_ticker}')
            else:
                print(f'✅ Cleared {deleted_count} KPI data item(s) for {upper_ticker}')
            
            return deleted_count
            
        except Exception as error:
            print(f'Error clearing all KPI data for {ticker}: {error}')
            raise error