#!/usr/bin/env python3
"""
KPI Unification Script

Unifies raw KPIs with KPI definitions using exact semantic invariant matching.
Two KPI observations are unified only if all semantic invariants match exactly:
- measure_kind
- subject
- subject_axis
- unit_family
- qualifiers (if present, must match exactly)

If any invariant differs, the KPIs represent different identities and must not be unified.

For unmatched raw KPIs, creates new definitions.
Stores unified KPIs in quarterly_analysis document.
"""

import os
import argparse
import sys
from datetime import datetime
from typing import Dict, List, Optional, Any
from dotenv import load_dotenv

from raw_kpi_service import RawKPIService
from kpi_definitions_service import KPIDefinitionsService
from firebase_cache import FirebaseCache

# Load environment variables
load_dotenv('.env.local')


def normalize_qualifiers(qualifiers: Any) -> Dict[str, str]:
    """Normalize qualifiers to a dictionary format for comparison
    
    Supports both array format [{key: str, value: str}] and dict format {key: value}
    
    Args:
        qualifiers: Qualifiers in array or dict format
        
    Returns:
        Normalized dictionary of qualifiers
    """
    # Explicitly handle None, missing, empty list, and empty dict
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


def match_qualifiers(qualifiers1: Any, qualifiers2: Any) -> bool:
    """Check if two qualifier sets match exactly
    
    Args:
        qualifiers1: First qualifiers (array or dict)
        qualifiers2: Second qualifiers (array or dict)
        
    Returns:
        True if qualifiers match exactly, False otherwise
    """
    norm1 = normalize_qualifiers(qualifiers1)
    norm2 = normalize_qualifiers(qualifiers2)
    
    # Both empty - match
    if not norm1 and not norm2:
        return True
    
    # One empty, one not - no match
    if not norm1 or not norm2:
        return False
    
    # Both must have same keys
    keys1 = set(norm1.keys())
    keys2 = set(norm2.keys())
    
    if keys1 != keys2:
        return False
    
    # All values must match
    for key in keys1:
        if norm1[key] != norm2[key]:
            return False
    
    return True


def match_semantic_invariants(sem1: Dict[str, Any], sem2: Dict[str, Any], verbose: bool = False) -> bool:
    """Check if two semantic interpretations match exactly
    
    All four invariants must match exactly:
    - measure_kind
    - subject
    - subject_axis
    - unit_family
    
    Qualifiers must also match exactly (if present).
    
    Args:
        sem1: First semantic_interpretation dictionary
        sem2: Second semantic_interpretation dictionary
        verbose: Enable verbose output for debugging
        
    Returns:
        True if all invariants and qualifiers match exactly, False otherwise
    """
    if not sem1 or not sem2:
        return False
    
    # All four invariants must match exactly
    invariants = ['measure_kind', 'subject', 'subject_axis', 'unit_family']
    
    for invariant in invariants:
        val1 = sem1.get(invariant)
        val2 = sem2.get(invariant)
        
        # Both must be present and match exactly
        if val1 is None or val2 is None:
            return False
        
        if val1 != val2:
            return False
    
    # Qualifiers must also match exactly
    if not match_qualifiers(sem1.get('qualifiers'), sem2.get('qualifiers')):
        return False
    
    return True


def match_raw_kpi_to_definition(
    raw_kpi: Dict[str, Any],
    definitions: List[Dict[str, Any]],
    verbose: bool = False
) -> Optional[Dict[str, Any]]:
    """Find matching definition for a raw KPI based on exact semantic invariant matching
    
    Args:
        raw_kpi: Raw KPI dictionary (must have 'semantic_interpretation' field)
        definitions: List of definition dictionaries (must have 'semantic_interpretation' field)
        verbose: Enable verbose output
        
    Returns:
        Matched definition dictionary or None if no match found
    """
    try:
        raw_sem = raw_kpi.get('semantic_interpretation')
        raw_kpi_name = raw_kpi.get('name', 'Unknown')
        
        if not raw_sem:
            if verbose:
                print(f'   ⚠️  Raw KPI "{raw_kpi_name}" has no semantic_interpretation')
            return None
        
        if verbose:
            raw_qualifiers = normalize_qualifiers(raw_sem.get('qualifiers'))
            print(f'   🔍 Searching for match: measure_kind={raw_sem.get("measure_kind")}, '
                  f'subject={raw_sem.get("subject")}, subject_axis={raw_sem.get("subject_axis")}, '
                  f'unit_family={raw_sem.get("unit_family")}, qualifiers={raw_qualifiers}')
        
        checked_count = 0
        # Find definition with matching semantic invariants
        for definition in definitions:
            def_sem = definition.get('semantic_interpretation')
            def_name = definition.get('name', 'Unknown')
            def_id = definition.get('id', 'Unknown')
            
            if not def_sem:
                continue
            
            checked_count += 1
            
            # Check if semantic invariants match exactly
            if match_semantic_invariants(raw_sem, def_sem, verbose=False):
                if verbose:
                    print(f'   ✅ MATCH FOUND: "{raw_kpi_name}" → Existing definition "{def_name}" (ID: {def_id})')
                    print(f'      Reason: All semantic invariants match exactly')
                return definition
        
        if verbose:
            print(f'   ❌ NO MATCH FOUND after checking {checked_count} definition(s)')
            print(f'      Reason: No existing definition matches all semantic invariants')
        
        return None
        
    except Exception as error:
        print(f'Error matching raw KPI to definition: {error}')
        return None


def create_definition_from_raw_kpi(raw_kpi: Dict[str, Any], ticker: str, 
                                   kpi_defs_service: KPIDefinitionsService,
                                   verbose: bool = False) -> Optional[str]:
    """Create a new KPI definition from a raw KPI
    
    Args:
        raw_kpi: Raw KPI dictionary
        ticker: Stock ticker symbol
        kpi_defs_service: KPIDefinitionsService instance
        verbose: Enable verbose output
        
    Returns:
        KPI definition ID if created successfully, None otherwise
    """
    try:
        raw_kpi_name = raw_kpi.get('name', 'Unknown')
        
        # Extract value information
        raw_value = raw_kpi.get('value', {})
        if isinstance(raw_value, dict):
            unit = raw_value.get('unit', '')
            multiplier = raw_value.get('multiplier')
        else:
            unit = ''
            multiplier = None
        
        # Create definition from raw KPI
        semantic_interpretation = raw_kpi.get('semantic_interpretation', {})
        if not semantic_interpretation:
            if verbose:
                print(f'      ⚠️  Cannot create definition: raw KPI has no semantic_interpretation')
            return None
        
        if verbose:
            sem = semantic_interpretation
            qualifiers = normalize_qualifiers(sem.get('qualifiers'))
            print(f'      Creating definition with:')
            print(f'         Name: "{raw_kpi_name}"')
            print(f'         measure_kind: {sem.get("measure_kind")}')
            print(f'         subject: {sem.get("subject")}')
            print(f'         subject_axis: {sem.get("subject_axis")}')
            print(f'         unit_family: {sem.get("unit_family")}')
            print(f'         qualifiers: {qualifiers}')
            print(f'         unit: {unit}')
            print(f'         multiplier: {multiplier}')
        
        definition_data = {
            'name': raw_kpi_name,
            'value': {
                'unit': unit,
                'multiplier': multiplier
            },
            'value_type': raw_kpi.get('value_type', 'quarterly'),
            'summary': raw_kpi.get('summary', ''),
            'source': raw_kpi.get('source', ''),
            'semantic_interpretation': semantic_interpretation
        }
        
        kpi_id = kpi_defs_service.set_kpi_definition(ticker, definition_data, verbose=False)
        
        if verbose:
            print(f'      ✅ Successfully created definition (ID: {kpi_id})')
        
        return kpi_id
        
    except Exception as error:
        if verbose:
            print(f'      ❌ Error creating definition: {error}')
        else:
            print(f'Error creating definition from raw KPI: {error}')
        return None


def unify_kpis(ticker: str, quarter_key: str, verbose: bool = False) -> Dict[str, Any]:
    """Unify raw KPIs with definitions using exact semantic invariant matching
    
    Args:
        ticker: Stock ticker symbol
        quarter_key: Quarter key in format YYYYQN (e.g., "2024Q1")
        verbose: Enable verbose output
        
    Returns:
        Dictionary with unification results
    """
    try:
        upper_ticker = ticker.upper()
        
        if verbose:
            print(f'🔄 Unifying KPIs for {upper_ticker} {quarter_key}...')
            print(f'   Matching rule: All semantic invariants must match exactly')
        
        # Initialize services
        raw_kpi_service = RawKPIService()
        kpi_defs_service = KPIDefinitionsService()
        firebase = FirebaseCache()
        
        # Load raw KPIs
        if verbose:
            print(f'\n📥 Loading raw KPIs...')
        raw_kpi_data = raw_kpi_service.get_raw_kpis(upper_ticker, quarter_key)
        
        if not raw_kpi_data:
            print(f'❌ No raw KPIs found for {upper_ticker} {quarter_key}')
            return {'error': 'No raw KPIs found'}
        
        raw_kpis = raw_kpi_data.get('raw_kpis', [])
        
        if not raw_kpis:
            print(f'❌ No raw KPIs in document for {upper_ticker} {quarter_key}')
            return {'error': 'No raw KPIs in document'}
        
        if verbose:
            print(f'   Found {len(raw_kpis)} raw KPIs')
        
        # Load all definitions
        if verbose:
            print(f'\n📥 Loading KPI definitions...')
        all_definitions = kpi_defs_service.get_all_kpi_definitions(upper_ticker)
        
        if verbose:
            definitions_with_sem = [d for d in all_definitions if d.get('semantic_interpretation')]
            print(f'   Found {len(all_definitions)} definitions ({len(definitions_with_sem)} with semantic_interpretation)')
        
        # Match raw KPIs to definitions
        if verbose:
            print(f'\n🔍 Matching raw KPIs to definitions (including qualifiers in matching)...')
            print(f'   Processing {len(raw_kpis)} raw KPI(s)...\n')
        
        matched_count = 0
        unmatched_count = 0
        created_definitions = 0
        
        unified_kpis = []  # For quarterly_analysis storage
        raw_kpi_updates = []  # For updating raw KPIs with definition links
        
        for idx, raw_kpi in enumerate(raw_kpis, 1):
            raw_kpi_name = raw_kpi.get('name', 'Unknown')
            raw_sem = raw_kpi.get('semantic_interpretation', {})
            
            if verbose:
                print(f'\n📋 [{idx}/{len(raw_kpis)}] Processing: "{raw_kpi_name}"')
            
            if not raw_sem:
                if verbose:
                    print(f'   ⚠️  SKIPPING: No semantic_interpretation found')
                    print(f'      Action: Cannot process without semantic data')
                unmatched_count += 1
                continue
            
            # Extract value for display
            raw_value = raw_kpi.get('value', {})
            if isinstance(raw_value, dict):
                kpi_value = raw_value.get('number')
            else:
                kpi_value = raw_value
            
            if verbose and kpi_value is not None:
                print(f'   Value: {kpi_value}')
            
            # Try to find a match (against all definitions, including those with qualifiers)
            matched_def = match_raw_kpi_to_definition(
                raw_kpi,
                all_definitions,
                verbose=verbose
            )
            
            if matched_def:
                def_id = matched_def.get('id')
                def_name = matched_def.get('name', 'Unknown')
                
                if verbose:
                    print(f'   📌 RESULT: Linking to EXISTING definition')
                    print(f'      Definition: "{def_name}" (ID: {def_id})')
                    print(f'      Action: Will link raw KPI to existing definition')
                
                # Extract value for quarterly_analysis
                if kpi_value is not None:
                    unified_kpis.append({
                        'id': def_id,
                        'value': kpi_value
                    })
                    if verbose:
                        print(f'      Value {kpi_value} will be stored in definition timeseries')
                
                # Track update for raw KPI
                raw_kpi_updates.append({
                    'kpi_name': raw_kpi_name,
                    'kpi_definition_id': def_id,
                    'semantic_interpretation': raw_sem
                })
                
                matched_count += 1
            else:
                # No match found - create new definition
                if verbose:
                    print(f'   📌 RESULT: Creating NEW definition')
                    print(f'      Reason: No existing definition matches all semantic invariants')
                
                def_id = create_definition_from_raw_kpi(
                    raw_kpi,
                    upper_ticker,
                    kpi_defs_service,
                    verbose=verbose
                )
                
                if def_id:
                    if verbose:
                        print(f'      Action: Created new definition (ID: {def_id})')
                        print(f'      Action: Will link raw KPI to newly created definition')
                    
                    # Get the newly created definition and add to list for potential future matches
                    new_definition = kpi_defs_service.get_kpi_definition_by_id(upper_ticker, def_id)
                    if new_definition:
                        all_definitions.append(new_definition)
                        if verbose:
                            print(f'      Note: New definition added to search pool for remaining KPIs')
                    
                    # Extract value for quarterly_analysis
                    if kpi_value is not None:
                        unified_kpis.append({
                            'id': def_id,
                            'value': kpi_value
                        })
                        if verbose:
                            print(f'      Value {kpi_value} will be stored in definition timeseries')
                    
                    # Track update for raw KPI
                    raw_kpi_updates.append({
                        'kpi_name': raw_kpi_name,
                        'kpi_definition_id': def_id,
                        'semantic_interpretation': raw_sem
                    })
                    
                    created_definitions += 1
                    unmatched_count += 1
                else:
                    if verbose:
                        print(f'   ⚠️  FAILED: Could not create definition')
                        print(f'      Action: Raw KPI will remain unlinked')
                    unmatched_count += 1
        
        # Update raw KPIs with definition links
        if raw_kpi_updates:
            if verbose:
                print(f'\n📝 Updating raw KPIs with definition links...')
                print(f'   Linking {len(raw_kpi_updates)} raw KPI(s) to definitions...\n')
            
            for idx, update in enumerate(raw_kpi_updates, 1):
                if verbose:
                    print(f'   [{idx}/{len(raw_kpi_updates)}] Linking "{update["kpi_name"]}" → Definition ID: {update["kpi_definition_id"]}')
                raw_kpi_service.link_raw_kpi_to_definition(
                    upper_ticker,
                    quarter_key,
                    update['kpi_name'],
                    update['kpi_definition_id'],
                    target_semantic=update.get('semantic_interpretation'),
                    verbose=verbose  # Show if linking fails
                )
        
        # Store values in KPI definitions (timeseries)
        if verbose:
            print(f'\n📊 Storing KPI values in definitions...')
            print(f'   Storing {len(unified_kpis)} value(s) in definition timeseries...\n')
        
        for idx, unified_kpi in enumerate(unified_kpis, 1):
            def_id = unified_kpi['id']
            kpi_value = unified_kpi['value']
            
            # Get definition to get the name
            definition = kpi_defs_service.get_kpi_definition_by_id(upper_ticker, def_id)
            if definition:
                kpi_name = definition.get('name', '')
                
                if verbose:
                    print(f'   [{idx}/{len(unified_kpis)}] Storing value {kpi_value} for "{kpi_name}" (ID: {def_id}) in {quarter_key}')
                
                # Store the value
                kpi_defs_service.set_kpi_value(
                    upper_ticker,
                    kpi_name,
                    quarter_key,
                    kpi_value,
                    verbose=False  # Reduce noise, we already logged above
                )
        
        # Store in quarterly_analysis
        if verbose:
            print(f'\n💾 Storing unified KPIs in quarterly_analysis...')
        
        # Get existing quarterly_analysis or create new
        existing_analysis = firebase.get_quarterly_analysis(upper_ticker, quarter_key)
        
        if existing_analysis:
            # Update existing document
            existing_analysis['custom_kpis'] = unified_kpis
            existing_analysis['unified_at'] = datetime.now().isoformat()
            firebase.store_quarterly_analysis(upper_ticker, quarter_key, existing_analysis, verbose=verbose)
        else:
            # Create new document
            analysis_data = {
                'ticker': upper_ticker,
                'quarter_key': quarter_key,
                'custom_kpis': unified_kpis,
                'unified_at': datetime.now().isoformat(),
                'created_at': datetime.now().isoformat()
            }
            firebase.store_quarterly_analysis(upper_ticker, quarter_key, analysis_data, verbose=verbose)
        
        if verbose:
            print(f'✅ Stored quarterly analysis for {upper_ticker} {quarter_key}')
        
        # Summary
        if verbose:
            print(f'\n✅ Unification complete!')
            print(f'   Matched: {matched_count}')
            print(f'   Created new definitions: {created_definitions}')
            print(f'   Total unified KPIs: {len(unified_kpis)}')
        
        return {
            'matched': matched_count,
            'created_definitions': created_definitions,
            'unmatched': unmatched_count,
            'total_unified': len(unified_kpis)
        }
        
    except Exception as error:
        print(f'Error unifying KPIs: {error}')
        if verbose:
            import traceback
            traceback.print_exc()
        return {'error': str(error)}


def main():
    parser = argparse.ArgumentParser(
        description='Unify raw KPIs with definitions using exact semantic invariant matching',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Unify KPIs for a quarter
  python unify_kpis.py AAPL 2024Q1
  
  # Unify with verbose output
  python unify_kpis.py AAPL 2024Q1 --verbose

Unification Rule:
  Two KPI observations are unified only if all semantic invariants match exactly:
  - measure_kind
  - subject
  - subject_axis
  - unit_family
  - qualifiers (if present, must match exactly)
  
  If any invariant differs, the KPIs represent different identities and must not be unified.
  
  Qualifiers are included in the matching logic, so KPIs with different qualifiers
  will be treated as separate identities and unified accordingly.
        '''
    )
    
    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT)')
    parser.add_argument('quarter', help='Quarter in format YYYYQN (e.g., 2024Q1)')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose output')
    
    args = parser.parse_args()
    
    # Validate quarter format
    import re
    if not re.match(r'^\d{4}Q[1-4]$', args.quarter):
        print(f'Error: Invalid quarter format. Use YYYYQN (e.g., 2024Q1)')
        sys.exit(1)
    
    try:
        results = unify_kpis(
            args.ticker.upper(),
            args.quarter,
            args.verbose
        )
        
        if 'error' in results:
            print(f'\n❌ Unification failed: {results["error"]}')
            sys.exit(1)
        
        print(f'\n✅ Successfully unified {results["total_unified"]} KPIs')
        print(f'   Matched: {results["matched"]}')
        print(f'   Created new definitions: {results["created_definitions"]}')
        
    except KeyboardInterrupt:
        print('\n\nInterrupted by user')
        sys.exit(1)
    except Exception as e:
        print(f'Error: {e}')
        if args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
