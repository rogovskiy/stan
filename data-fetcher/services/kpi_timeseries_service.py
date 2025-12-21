#!/usr/bin/env python3
"""
KPI Timeseries Service

Service for building KPI timeseries from raw KPIs.
Builds timeseries/kpi document from raw_kpis collection (with definition_id) and kpi_definitions.
"""

from datetime import datetime
from typing import Dict, List, Optional, Any
from services.firebase_base_service import FirebaseBaseService
from raw_kpi_service import RawKPIService
from kpi_definitions_service import KPIDefinitionsService


class KPITimeseriesService(FirebaseBaseService):
    """Service for building KPI timeseries from raw KPIs"""
    
    def build_kpi_timeseries_from_raw(self, ticker: str, min_coverage: float = 0.6, verbose: bool = False) -> Dict[str, Any]:
        """Build KPI timeseries from raw_kpis collection
        
        Reads all raw_kpis documents, groups by definition_id,
        fetches definitions, and builds timeseries format.
        Only includes quarters with actual data (leaves gaps for missing quarters).
        Filters out KPIs with coverage below min_coverage threshold.
        
        Args:
            ticker: Stock ticker symbol
            min_coverage: Minimum data coverage threshold (0.6 = 60%). KPIs below this are filtered out.
            verbose: Enable verbose output
            
        Returns:
            Dictionary containing KPI timeseries data in format expected by UI
        """
        try:
            upper_ticker = ticker.upper()
            
            if verbose:
                print(f'\n📊 Building KPI timeseries from raw KPIs for {upper_ticker}...')
            
            # 1. Get all raw_kpis documents
            raw_kpi_service = RawKPIService()
            all_raw_kpis = raw_kpi_service.get_all_raw_kpis(upper_ticker)
            
            if not all_raw_kpis:
                if verbose:
                    print(f'   ⚠️  No raw KPIs found for {upper_ticker}')
                return self._create_empty_timeseries(min_coverage)
            
            if verbose:
                print(f'   Found {len(all_raw_kpis)} quarter(s) with raw KPIs')
            
            # 2. Group by definition_id across all quarters
            kpis_by_definition = {}  # definition_id -> list of (quarter_key, raw_kpi)
            all_quarters_set = set()
            
            for quarter_doc in all_raw_kpis:
                quarter_key = quarter_doc.get('quarter_key', '')
                if quarter_key:
                    all_quarters_set.add(quarter_key)
                
                raw_kpis = quarter_doc.get('raw_kpis', [])
                
                for raw_kpi in raw_kpis:
                    definition_id = raw_kpi.get('definition_id')
                    if definition_id:  # Only unified KPIs
                        if definition_id not in kpis_by_definition:
                            kpis_by_definition[definition_id] = []
                        kpis_by_definition[definition_id].append((quarter_key, raw_kpi))
            
            if not kpis_by_definition:
                if verbose:
                    print(f'   ⚠️  No unified KPIs found (no definition_id links)')
                return self._create_empty_timeseries(min_coverage)
            
            if verbose:
                print(f'   Found {len(kpis_by_definition)} unique KPI definition(s)')
            
            # 3. Calculate coverage requirements
            total_quarters = len(all_quarters_set)
            min_quarters_required = int(total_quarters * min_coverage)
            
            if verbose:
                print(f'   Total quarters available: {total_quarters}')
                print(f'   Minimum coverage: {min_coverage * 100:.0f}% ({min_quarters_required} quarters required)')
            
            # 4. Fetch definitions and build timeseries (with coverage filtering)
            kpi_defs_service = KPIDefinitionsService()
            timeseries_list = []
            filtered_out = []
            
            for definition_id, kpi_entries in kpis_by_definition.items():
                # Fetch definition
                definition = kpi_defs_service.get_kpi_definition_by_id(upper_ticker, definition_id)
                if not definition:
                    if verbose:
                        print(f'   ⚠️  Definition {definition_id} not found, skipping')
                    continue
                
                # Build timeseries values - only include quarters with actual data (leave gaps for missing quarters)
                # Handle duplicates: group by quarter_key and take most recent based on linked_at
                quarters_dict = {}  # quarter_key -> (raw_kpi, linked_at_timestamp)
                
                for quarter_key, raw_kpi in kpi_entries:
                    linked_at = raw_kpi.get('linked_at', '')
                    
                    # If we already have this quarter, compare linked_at timestamps
                    if quarter_key in quarters_dict:
                        existing_linked_at = quarters_dict[quarter_key][1]
                        # Take the more recent one (later timestamp)
                        if linked_at > existing_linked_at:
                            quarters_dict[quarter_key] = (raw_kpi, linked_at)
                    else:
                        quarters_dict[quarter_key] = (raw_kpi, linked_at)
                
                # Sort by quarter_key chronologically
                sorted_quarters = sorted(quarters_dict.keys())
                
                values = []
                quarters_with_data = set()
                
                for quarter_key in sorted_quarters:
                    raw_kpi, _ = quarters_dict[quarter_key]
                    value_obj = raw_kpi.get('value', {})
                    
                    # Extract numeric value
                    num_value = None
                    if isinstance(value_obj, dict):
                        num_value = value_obj.get('number')
                        unit_from_value = value_obj.get('unit', '')
                    else:
                        # Try to parse as number if it's not a dict
                        try:
                            num_value = float(value_obj) if value_obj is not None else None
                        except (ValueError, TypeError):
                            num_value = None
                        unit_from_value = ''
                    
                    # Only add entry if we have an actual value (don't estimate or interpolate)
                    if num_value is not None:
                        quarters_with_data.add(quarter_key)
                        
                        # Get unit from definition or raw KPI
                        unit = definition.get('value', {}).get('unit', '') or unit_from_value or raw_kpi.get('value', {}).get('unit', '')
                        
                        values.append({
                            'quarter': quarter_key,
                            'value': num_value,
                            'unit': unit,
                            'change': None,  # Can calculate later if needed
                            'change_type': None,
                            'frequency': 1,
                            'context': raw_kpi.get('summary', '') or raw_kpi.get('context', ''),
                            'source': raw_kpi.get('source', '')
                        })
                
                # Calculate metadata
                quarters_with_data_count = len(quarters_with_data)
                coverage = quarters_with_data_count / total_quarters if total_quarters > 0 else 0
                
                # Filter by coverage threshold (only include KPIs that appear in enough quarters)
                if quarters_with_data_count < min_quarters_required:
                    # Filter out this KPI (one-off or low coverage)
                    kpi_name = definition.get('name', '')
                    if not kpi_name and kpi_entries:
                        kpi_name = kpi_entries[0][1].get('name', 'Unknown KPI')
                    filtered_out.append({
                        'name': kpi_name,
                        'coverage': coverage,
                        'coverage_count': quarters_with_data_count
                    })
                    continue
                
                # Get name and unit from definition
                kpi_name = definition.get('name', '')
                kpi_unit = definition.get('value', {}).get('unit', '')
                
                # Use raw KPI name/unit as fallback if definition doesn't have them
                if not kpi_name and kpi_entries:
                    kpi_name = kpi_entries[0][1].get('name', 'Unknown KPI')
                if not kpi_unit and values:
                    kpi_unit = values[0].get('unit', '')
                
                timeseries_list.append({
                    'name': kpi_name,
                    'group': definition.get('group', 'Other'),  # Default or derive from definition
                    'unit': kpi_unit,
                    'coverage': coverage,
                    'coverage_count': quarters_with_data_count,
                    'total_quarters': total_quarters,
                    'max_frequency': 1,
                    'values': values
                })
            
            # Sort by coverage (highest first), then by name
            timeseries_list.sort(key=lambda x: (-x['coverage'], x['name']))
            
            if verbose:
                print(f'   ✅ Included KPIs: {len(timeseries_list)} (≥{min_coverage * 100:.0f}% coverage)')
                if filtered_out:
                    print(f'   ⚠️  Filtered out: {len(filtered_out)} KPIs (<{min_coverage * 100:.0f}% coverage)')
            
            # Build final timeseries data structure
            sorted_quarters = sorted(all_quarters_set)
            
            timeseries_data = {
                'kpis': timeseries_list,
                'metadata': {
                    'total_quarters': total_quarters,
                    'quarters': sorted_quarters,
                    'min_coverage': min_coverage,
                    'min_quarters_required': min_quarters_required,
                    'total_kpis_extracted': len(kpis_by_definition),
                    'kpis_included': len(timeseries_list),
                    'kpis_filtered_out': len(filtered_out),
                    'created_at': datetime.now().isoformat()
                }
            }
            
            # 4. Store in timeseries/kpi document
            from services.timeseries_service import TimeseriesService
            timeseries_service = TimeseriesService()
            timeseries_service.cache_kpi_timeseries(upper_ticker, timeseries_data)
            
            if verbose:
                print(f'   ✅ Built timeseries with {len(timeseries_list)} KPI(s)')
                print(f'   ✅ Stored in tickers/{upper_ticker}/timeseries/kpi')
            
            return timeseries_data
            
        except Exception as error:
            print(f'Error building KPI timeseries from raw KPIs for {ticker}: {error}')
            if verbose:
                import traceback
                traceback.print_exc()
            raise error
    
    def _create_empty_timeseries(self, min_coverage: float = 0.6) -> Dict[str, Any]:
        """Create empty timeseries structure"""
        return {
            'kpis': [],
            'metadata': {
                'total_quarters': 0,
                'quarters': [],
                'min_coverage': min_coverage,
                'min_quarters_required': 0,
                'total_kpis_extracted': 0,
                'kpis_included': 0,
                'kpis_filtered_out': 0,
                'created_at': datetime.now().isoformat()
            }
        }

