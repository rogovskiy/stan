#!/usr/bin/env python3
"""
Extract KPIs from Quarterly IR Documents

Extracts custom KPIs (Key Performance Indicators) from quarterly investor relations documents.
Focuses on extracting company-specific metrics that are not in standard financial statements.

This script handles:
- KPI extraction using LLM with structured output
- KPI name normalization across quarters
- Frequency tracking (how many quarters a KPI has been reported)
- KPI matrix display showing metrics across quarters
"""

import os
import json
import argparse
import sys
import base64
from datetime import datetime
from typing import Dict, List, Optional, Any
from dotenv import load_dotenv
import google.generativeai as genai

from firebase_cache import FirebaseCache
from document_text_extractor import get_document_text, extract_text_from_html
from io import BytesIO
from pathlib import Path

# Load environment variables from .env.local
load_dotenv('.env.local')

# Get the directory where this script is located
SCRIPT_DIR = Path(__file__).parent
PROMPTS_DIR = SCRIPT_DIR / 'prompts'
SCHEMAS_DIR = SCRIPT_DIR


def get_gemini_model() -> str:
    """Get Gemini model from env var or return default"""
    return os.getenv('GEMINI_MODEL', 'gemini-2.0-flash-exp')


def extract_json_from_llm_response(response_text: str) -> str:
    """Extract JSON from LLM response (handles markdown code blocks)"""
    if '```json' in response_text:
        return response_text.split('```json')[1].split('```')[0].strip()
    elif '```' in response_text:
        return response_text.split('```')[1].split('```')[0].strip()
    return response_text.strip()


def load_prompt_template(template_name: str, **kwargs) -> str:
    """Load and render a prompt template file
    
    Args:
        template_name: Name of template file (e.g., 'kpi_extraction_prompt.txt')
        **kwargs: Variables to substitute in the template
        
    Returns:
        Rendered prompt string
    """
    template_path = PROMPTS_DIR / template_name
    if not template_path.exists():
        raise FileNotFoundError(f"Prompt template not found: {template_path}")
    
    with open(template_path, 'r', encoding='utf-8') as f:
        template = f.read()
    
    # Simple template substitution using .format()
    # Escape braces that should remain literal
    template = template.replace('{{', '<<<').replace('}}', '>>>')
    try:
        rendered = template.format(**kwargs)
        rendered = rendered.replace('<<<', '{').replace('>>>', '}')
        return rendered
    except KeyError as e:
        raise ValueError(f"Missing template variable: {e}")


def load_json_schema(schema_name: str) -> Dict[str, Any]:
    """Load a JSON schema file
    
    Args:
        schema_name: Name of schema file (e.g., 'kpi_schema.json')
        
    Returns:
        Schema as dictionary
    """
    schema_path = SCHEMAS_DIR / schema_name
    if not schema_path.exists():
        raise FileNotFoundError(f"Schema file not found: {schema_path}")
    
    with open(schema_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def clean_schema_for_gemini(schema: Dict[str, Any]) -> Dict[str, Any]:
    """Clean JSON schema to only include fields supported by Gemini structured output
    
    Gemini supports: type, properties, items, enum, required, description
    Gemini does NOT support: $schema, title, minLength, maxLength, examples, minimum, maximum, oneOf, etc.
    
    Args:
        schema: JSON schema dictionary
        
    Returns:
        Cleaned schema dictionary compatible with Gemini
    """
    if not isinstance(schema, dict):
        return schema
    
    cleaned = {}
    
    # Handle oneOf - convert to string type (most flexible)
    if 'oneOf' in schema:
        cleaned['type'] = 'string'
        if 'description' in schema:
            cleaned['description'] = schema['description']
        return cleaned
    
    # Fields Gemini supports
    supported_fields = ['type', 'properties', 'items', 'enum', 'required', 'description']
    
    for key, value in schema.items():
        if key in ['$schema', 'title', 'additionalProperties', 'oneOf', 'minLength', 'maxLength', 'minimum', 'maximum', 'examples']:
            continue  # Skip unsupported fields
        
        if key in supported_fields:
            if key == 'properties' and isinstance(value, dict):
                # Recursively clean properties
                cleaned[key] = {k: clean_schema_for_gemini(v) for k, v in value.items()}
            elif key == 'items' and isinstance(value, dict):
                # Recursively clean items
                cleaned[key] = clean_schema_for_gemini(value)
            elif key in ['enum', 'required']:
                # Keep these as-is
                cleaned[key] = value
            elif key == 'description':
                # Keep description as-is
                cleaned[key] = value
            elif key == 'type':
                cleaned[key] = value
    
    return cleaned


def prepare_documents_for_llm(ticker: str, quarter_key: str, verbose: bool = False) -> tuple[List[tuple[bytes, Dict]], List[tuple[str, Dict]], List[Dict]]:
    """Prepare documents for LLM processing
    
    Args:
        ticker: Stock ticker symbol
        quarter_key: Quarter key in format YYYYQN
        verbose: Enable verbose output
        
    Returns:
        Tuple of (pdf_files, html_texts, documents) where:
        - pdf_files: List of (content_bytes, doc_meta) tuples
        - html_texts: List of (text, doc_meta) tuples
        - documents: List of document metadata dictionaries
    """
    firebase = FirebaseCache()
    documents = firebase.get_ir_documents_for_quarter(ticker, quarter_key)
    
    if not documents:
        if verbose:
            print(f'No documents found for {ticker} {quarter_key}')
        return [], [], []
    
    # Filter out Consolidated Financial Statements
    original_count = len(documents)
    documents = [
        doc for doc in documents
        if not (
            'consolidated financial' in doc.get('title', '').lower() or
            'consolidated financial' in doc.get('document_type', '').lower() or
            doc.get('document_type', '').lower() == 'financial_statements'
        )
    ]
    
    if verbose:
        if original_count > len(documents):
            print(f'Found {original_count} documents, excluded {original_count - len(documents)} Consolidated Financial Statement(s)')
        print(f'Processing {len(documents)} documents for {ticker} {quarter_key}')
        for doc in documents:
            print(f"  - {doc.get('title', 'N/A')} ({doc.get('document_type', 'N/A')})")
    
    if not documents:
        if verbose:
            print(f'No documents remaining after filtering for {ticker} {quarter_key}')
        return [], [], []
    
    # Separate PDFs and HTML files
    pdf_files = []
    html_texts = []
    
    for doc in documents:
        doc_id = doc.get('document_id')
        if not doc_id:
            continue
        
        doc_content = firebase.get_ir_document_content(ticker, doc_id)
        if not doc_content:
            if verbose:
                print(f'  ⚠️  Could not retrieve content for: {doc.get("title", "Unknown")}')
            continue
        
        storage_ref = doc.get('document_storage_ref', '')
        is_pdf = storage_ref.endswith('.pdf') or (isinstance(doc_content, bytes) and doc_content.startswith(b'%PDF'))
        
        if is_pdf:
            if verbose:
                print(f'  📄 Preparing PDF: {doc.get("title", "Unknown")}')
            
            if len(doc_content) > 50 * 1024 * 1024:
                if verbose:
                    print(f'     ⚠️  PDF too large ({len(doc_content) / 1024 / 1024:.1f}MB), extracting text instead')
                from document_text_extractor import extract_text_from_pdf
                text = extract_text_from_pdf(doc_content)
                if text:
                    html_texts.append((text[:50000], doc))
            else:
                pdf_files.append((doc_content, doc))
                if verbose:
                    print(f'     ✅ Ready ({len(doc_content) / 1024:.1f}KB)')
        else:
            if verbose:
                print(f'  📝 Extracting text from HTML: {doc.get("title", "Unknown")}')
            text = extract_text_from_html(doc_content)
            if text:
                html_texts.append((text[:50000], doc))
    
    return pdf_files, html_texts, documents


def get_previous_quarter_kpis(ticker: str, quarter_key: str) -> Optional[List[Dict[str, Any]]]:
    """Get KPIs from previous quarter to calculate frequency
    
    Args:
        ticker: Stock ticker symbol
        quarter_key: Current quarter key
        
    Returns:
        List of KPI dictionaries from previous quarter, or None
    """
    try:
        firebase = FirebaseCache()
        
        # Parse current quarter to find previous
        year_str, q_str = quarter_key.split('Q')
        year = int(year_str)
        quarter = int(q_str)
        
        # Calculate previous quarter
        if quarter == 1:
            prev_year = year - 1
            prev_quarter = 4
        else:
            prev_year = year
            prev_quarter = quarter - 1
        
        prev_quarter_key = f"{prev_year}Q{prev_quarter}"
        
        # Get previous quarter analysis
        prev_analysis = firebase.get_quarterly_analysis(ticker.upper(), prev_quarter_key)
        if prev_analysis and prev_analysis.get('custom_kpis'):
            return prev_analysis.get('custom_kpis')
        
        return None
    except Exception as e:
        return None


def detect_unit_type_mismatch(unit1: str, unit2: str) -> bool:
    """Detect if two units represent different types (e.g., percentage vs dollar)
    
    Args:
        unit1: First unit string
        unit2: Second unit string
        
    Returns:
        True if units represent different types (percentage vs dollar), False otherwise
    """
    if not unit1 or not unit2:
        return False
    
    unit1_lower = unit1.lower().strip()
    unit2_lower = unit2.lower().strip()
    
    # Percentage units
    percentage_units = ['%', 'percent', 'percentage', 'pct']
    # Dollar/monetary units
    dollar_units = ['$', '$b', '$m', '$k', 'billion', 'billions', 'million', 'millions', 
                    'thousand', 'thousands', 'dollar', 'dollars', 'usd']
    
    unit1_is_percentage = any(p in unit1_lower for p in percentage_units)
    unit2_is_percentage = any(p in unit2_lower for p in percentage_units)
    unit1_is_dollar = any(d in unit1_lower for d in dollar_units)
    unit2_is_dollar = any(d in unit2_lower for d in dollar_units)
    
    # Check for type mismatch
    if (unit1_is_percentage and unit2_is_dollar) or (unit1_is_dollar and unit2_is_percentage):
        return True
    
    return False


def normalize_kpi_name(kpi_name: str, previous_quarter_kpis: Optional[List[Dict[str, Any]]]) -> tuple[str, Optional[Dict[str, Any]], bool]:
    """Check if a KPI name matches a previous quarter KPI by name or other_names
    
    Args:
        kpi_name: Name of the KPI to check
        previous_quarter_kpis: List of KPIs from previous quarter, or None
        
    Returns:
        Tuple of (canonical_name, matched_prev_kpi, was_matched)
        - canonical_name: The normalized/canonical name to use
        - matched_prev_kpi: The matched previous KPI dict if found, None otherwise
        - was_matched: True if a match was found
    """
    if not previous_quarter_kpis:
        return kpi_name, None, False
    
    # Normalize names for comparison (lowercase, strip spaces)
    def normalize_for_match(name: str) -> str:
        return name.lower().strip()
    
    kpi_name_normalized = normalize_for_match(kpi_name)
    
    # First check exact name match
    for prev_kpi in previous_quarter_kpis:
        prev_name = prev_kpi.get('name', '')
        if normalize_for_match(prev_name) == kpi_name_normalized:
            return prev_name, prev_kpi, True
    
    # Then check other_names
    for prev_kpi in previous_quarter_kpis:
        other_names = prev_kpi.get('other_names', [])
        for other_name in other_names:
            if normalize_for_match(other_name) == kpi_name_normalized:
                # Found a match via other_names - return canonical name
                return prev_kpi.get('name', ''), prev_kpi, True
    
    # No match found
    return kpi_name, None, False


def normalize_kpi_names(
    kpis: List[Dict[str, Any]],
    previous_quarter_kpis: Optional[List[Dict[str, Any]]],
    verbose: bool = False
) -> List[Dict[str, Any]]:
    """Normalize KPI names by matching against previous quarter KPIs
    
    Args:
        kpis: List of extracted KPIs
        previous_quarter_kpis: List of KPIs from previous quarter, or None
        verbose: Enable verbose output
        
    Returns:
        Normalized list of KPIs with canonical names and other_names populated
    """
    if not kpis:
        return kpis
    
    if verbose and previous_quarter_kpis:
        print(f'\n🔄 Normalizing KPI names against previous quarter ({len(previous_quarter_kpis)} KPIs)...')
    
    normalized_kpis = []
    normalized_count = 0
    
    for kpi in kpis:
        kpi_name = kpi.get('name', '')
        if not kpi_name:
            normalized_kpis.append(kpi)
            continue
        
        # Check if this name matches a previous quarter KPI
        canonical_name, matched_prev_kpi, was_matched = normalize_kpi_name(kpi_name, previous_quarter_kpis)
        
        # Get existing other_names from current KPI
        current_other_names = set(kpi.get('other_names', []))
        
        if was_matched and matched_prev_kpi:
            # Found a match - use canonical name from previous quarter
            if canonical_name != kpi_name:
                if verbose:
                    print(f'  🔄 Normalized: "{kpi_name}" → "{canonical_name}"')
                normalized_count += 1
                # Add the variant name to other_names if different
                current_other_names.add(kpi_name)
            
            # Include previous other_names
            prev_other_names = matched_prev_kpi.get('other_names', [])
            current_other_names.update(prev_other_names)
            
            # Also ensure the current variant name is in other_names if it's different
            if kpi_name != canonical_name:
                current_other_names.add(kpi_name)
            
            # Update KPI with canonical name
            kpi['name'] = canonical_name
            
            # CRITICAL: Normalize unit to match previous quarter exactly
            prev_unit = matched_prev_kpi.get('unit', '')
            current_unit = kpi.get('unit', '')
            if prev_unit and prev_unit != current_unit:
                # Unit mismatch detected
                # Check if this is a critical type mismatch (percentage vs dollar)
                is_critical_mismatch = detect_unit_type_mismatch(prev_unit, current_unit)
                # Always use previous quarter's unit for consistency (FIX APPLIED FIRST)
                kpi['unit'] = prev_unit
                
                # Then report the issue (after fix is applied)
                if is_critical_mismatch:
                    print(f'  🚨 CRITICAL UNIT TYPE MISMATCH for "{canonical_name}" (RESOLVED):')
                    print(f'     Previous quarter unit: "{prev_unit}"')
                    print(f'     Current quarter unit was: "{current_unit}"')
                    print(f'     ✅ Corrected to: "{prev_unit}" to maintain consistency')
                elif verbose:
                    print(f'  ⚠️  Unit mismatch for "{canonical_name}" (RESOLVED): current="{current_unit}" → corrected to "{prev_unit}"')
            elif prev_unit:
                # Units match or current unit is empty - use previous unit
                kpi['unit'] = prev_unit
        else:
            # No match - this is potentially a new KPI or variant
            # Keep the name as-is for now, but we'll check again in frequency update
            pass
        
        # Update other_names (only if we have any)
        if current_other_names:
            kpi['other_names'] = sorted(list(current_other_names))
        elif 'other_names' not in kpi:
            kpi['other_names'] = []
        
        normalized_kpis.append(kpi)
    
    if verbose and normalized_count > 0:
        print(f'   ✅ Normalized {normalized_count} KPI name(s)')
    
    return normalized_kpis


def update_kpi_frequencies_from_previous_quarter(
    kpis: List[Dict[str, Any]],
    previous_quarter_kpis: Optional[List[Dict[str, Any]]],
    verbose: bool = False
) -> List[Dict[str, Any]]:
    """Update KPI frequencies by checking against previous quarter KPIs
    
    Args:
        kpis: List of extracted KPIs (should already be normalized)
        previous_quarter_kpis: List of KPIs from previous quarter, or None
        verbose: Enable verbose output
        
    Returns:
        Updated list of KPIs with calculated frequencies
    """
    if not kpis:
        return kpis
    
    if verbose and previous_quarter_kpis:
        print(f'\n📊 Updating frequencies from previous quarter ({len(previous_quarter_kpis)} KPIs)...')
    
    # Create a lookup map: canonical KPI name -> KPI from previous quarter
    previous_kpi_map = {}
    if previous_quarter_kpis:
        for prev_kpi in previous_quarter_kpis:
            kpi_name = prev_kpi.get('name', '')
            if kpi_name:
                previous_kpi_map[kpi_name] = prev_kpi
    
    # Update each KPI's frequency
    updated_kpis = []
    new_kpi_count = 0
    
    for kpi in kpis:
        kpi_name = kpi.get('name', '')
        if not kpi_name:
            updated_kpis.append(kpi)
            continue
        
        # Check if this KPI was in the previous quarter (by canonical name)
        if kpi_name in previous_kpi_map:
            # Found in previous quarter - increment frequency
            matched_prev_kpi = previous_kpi_map[kpi_name]
            previous_frequency = matched_prev_kpi.get('frequency', 1)
            kpi['frequency'] = previous_frequency + 1
            
            # Merge other_names from previous quarter
            prev_other_names = set(matched_prev_kpi.get('other_names', []))
            current_other_names = set(kpi.get('other_names', []))
            merged_other_names = sorted(list(prev_other_names | current_other_names))
            if merged_other_names:
                kpi['other_names'] = merged_other_names
        else:
            # New KPI - not found in previous quarter
            kpi['frequency'] = 1
            if verbose:
                print(f'  🆕 New KPI: "{kpi_name}" (first occurrence)')
            new_kpi_count += 1
        
        updated_kpis.append(kpi)
    
    if verbose:
        existing_count = len(kpis) - new_kpi_count
        print(f'   ✅ Updated frequencies: {new_kpi_count} new KPIs, {existing_count} existing KPIs')
    
    return updated_kpis


def validate_kpi_units(
    kpis: List[Dict[str, Any]],
    previous_quarter_kpis: Optional[List[Dict[str, Any]]],
    verbose: bool = False
) -> List[Dict[str, Any]]:
    """Validate and report unit consistency issues with previous quarter KPIs
    
    Args:
        kpis: List of extracted KPIs (should already be normalized)
        previous_quarter_kpis: List of KPIs from previous quarter, or None
        verbose: Enable verbose output
        
    Returns:
        List of KPIs (unchanged, but warnings printed if issues found)
    """
    if not kpis or not previous_quarter_kpis:
        return kpis
    
    if verbose:
        print(f'\n🔍 Validating unit consistency with previous quarter...')
    
    # Create lookup map
    previous_kpi_map = {}
    for prev_kpi in previous_quarter_kpis:
        kpi_name = prev_kpi.get('name', '')
        if kpi_name:
            previous_kpi_map[kpi_name] = prev_kpi
    
    issues_found = 0
    for kpi in kpis:
        kpi_name = kpi.get('name', '')
        if not kpi_name or kpi_name not in previous_kpi_map:
            continue
        
        prev_kpi = previous_kpi_map[kpi_name]
        prev_unit = prev_kpi.get('unit', '')
        current_unit = kpi.get('unit', '')
        
        if not prev_unit or not current_unit:
            continue
        
        # Check for exact match
        if prev_unit != current_unit:
            # Check if it's a critical type mismatch
            if detect_unit_type_mismatch(prev_unit, current_unit):
                print(f'\n🚨 CRITICAL: Unit type mismatch detected for "{kpi_name}":')
                print(f'   Previous quarter: "{prev_unit}"')
                print(f'   Current quarter:  "{current_unit}"')
                print(f'   This is a CRITICAL ERROR - percentage and dollar units cannot be mixed!')
                issues_found += 1
            elif verbose:
                print(f'  ⚠️  Unit difference for "{kpi_name}": previous="{prev_unit}" vs current="{current_unit}"')
    
    if verbose:
        if issues_found == 0:
            print(f'   ✅ All units consistent with previous quarter')
        else:
            print(f'   ⚠️  Found {issues_found} unit consistency issue(s)')
    
    return kpis


def print_kpi_comparison(
    extracted_kpis: List[Dict[str, Any]],
    previous_quarter_kpis: Optional[List[Dict[str, Any]]],
    quarter_key: str,
    prev_quarter_key: Optional[str] = None
) -> None:
    """Print a comparison of extracted KPIs with previous quarter KPIs
    
    Args:
        extracted_kpis: List of KPIs extracted for current quarter
        previous_quarter_kpis: List of KPIs from previous quarter, or None
        quarter_key: Current quarter key
        prev_quarter_key: Previous quarter key (for display purposes), or None
    """
    print('\n' + '='*80)
    print(f'KPI EXTRACTION RESULTS: {quarter_key}')
    print('='*80)
    
    if not extracted_kpis:
        print('⚠️  No KPIs extracted')
        print('='*80 + '\n')
        return
    
    # Create lookup map for previous quarter KPIs
    prev_kpi_map = {}
    if previous_quarter_kpis:
        for prev_kpi in previous_quarter_kpis:
            name = prev_kpi.get('name', '')
            if name:
                prev_kpi_map[name] = prev_kpi
    
    # Categorize KPIs
    matched_kpis = []
    new_kpis = []
    
    for kpi in extracted_kpis:
        kpi_name = kpi.get('name', '')
        if kpi_name in prev_kpi_map:
            matched_kpis.append((kpi, prev_kpi_map[kpi_name]))
        else:
            new_kpis.append(kpi)
    
    # Print matched KPIs (comparing current vs previous)
    if matched_kpis:
        print(f'\n📊 MATCHED KPIs ({len(matched_kpis)} KPIs from previous quarter):')
        print('-'*80)
        for current_kpi, prev_kpi in matched_kpis:
            name = current_kpi.get('name', 'Unknown')
            current_value = current_kpi.get('value', 'N/A')
            current_unit = current_kpi.get('unit', '')
            prev_value = prev_kpi.get('value', 'N/A')
            prev_unit = prev_kpi.get('unit', '')
            
            # Check for unit consistency
            unit_match = current_unit == prev_unit
            unit_status = '✅' if unit_match else '⚠️'
            
            print(f'  {unit_status} {name}')
            print(f'     Current ({quarter_key}): {current_value} {current_unit}')
            prev_q_label = prev_quarter_key if prev_quarter_key else 'Previous'
            print(f'     Previous ({prev_q_label}): {prev_value} {prev_unit}')
            
            if not unit_match:
                print(f'     ⚠️  UNIT MISMATCH: previous="{prev_unit}" vs current="{current_unit}"')
            
            # Show change if available
            change = current_kpi.get('change')
            change_type = current_kpi.get('change_type')
            if change:
                print(f'     Change: {change} ({change_type})')
            print()
    
    # Print new KPIs
    if new_kpis:
        print(f'\n🆕 NEW KPIs ({len(new_kpis)} KPIs not in previous quarter):')
        print('-'*80)
        for kpi in new_kpis:
            name = kpi.get('name', 'Unknown')
            value = kpi.get('value', 'N/A')
            unit = kpi.get('unit', '')
            group = kpi.get('group', 'N/A')
            print(f'  • {name}: {value} {unit} ({group})')
        print()
    
    # Print missing KPIs (in previous but not in current)
    missing_kpis = []
    if previous_quarter_kpis:
        current_kpi_names = {kpi.get('name', '') for kpi in extracted_kpis}
        missing_kpis = [
            prev_kpi for prev_kpi in previous_quarter_kpis
            if prev_kpi.get('name', '') not in current_kpi_names
        ]
        
        if missing_kpis:
            print(f'\n⚠️  MISSING KPIs ({len(missing_kpis)} KPIs from previous quarter not found):')
            print('-'*80)
            for prev_kpi in missing_kpis:
                name = prev_kpi.get('name', 'Unknown')
                prev_value = prev_kpi.get('value', 'N/A')
                prev_unit = prev_kpi.get('unit', '')
                frequency = prev_kpi.get('frequency', 1)
                summary = prev_kpi.get('summary', 'No summary available')
                print(f'  • {name}: {prev_value} {prev_unit} (frequency: {frequency})')
                print(f'    Summary: {summary}')
            print()
    
    # Summary
    print('-'*80)
    print(f'Summary: {len(matched_kpis)} matched, {len(new_kpis)} new, {len(missing_kpis)} missing')
    print('='*80 + '\n')


def extract_missing_kpi(
    ticker: str,
    quarter_key: str,
    missing_kpi: Dict[str, Any],
    pdf_files: List[tuple[bytes, Dict]],
    html_texts: List[tuple[str, Dict]],
    verbose: bool = False
) -> Optional[Dict[str, Any]]:
    """Extract a single missing KPI using a targeted prompt
    
    Args:
        ticker: Stock ticker symbol
        quarter_key: Quarter key in format YYYYQN
        missing_kpi: The missing KPI from previous quarter to search for
        pdf_files: List of (content_bytes, doc_meta) tuples
        html_texts: List of (text, doc_meta) tuples
        verbose: Enable verbose output
        
    Returns:
        KPI dictionary if found, None otherwise
    """
    try:
        kpi_name = missing_kpi.get('name', '')
        prev_value = missing_kpi.get('value', 'N/A')
        prev_unit = missing_kpi.get('unit', '')
        prev_group = missing_kpi.get('group', 'N/A')
        prev_context = missing_kpi.get('context', '')
        prev_summary = missing_kpi.get('summary', '')
        prev_source = missing_kpi.get('source', '')
        prev_other_names = missing_kpi.get('other_names', [])
        prev_frequency = missing_kpi.get('frequency', 1)
        
        if not kpi_name:
            return None
        
        # Load missing KPI response schema (includes explanation field)
        response_schema_raw = load_json_schema('missing_kpi_response_schema.json')
        # Clean schema for Gemini compatibility
        response_schema = clean_schema_for_gemini(response_schema_raw)
        
        # Load targeted prompt template
        targeted_prompt = load_prompt_template(
            'missing_kpi_extraction_prompt.txt',
            ticker=ticker,
            quarter_key=quarter_key,
            kpi_name=kpi_name,
            prev_value=prev_value,
            prev_unit=prev_unit,
            prev_group=prev_group,
            prev_context=prev_context,
            prev_summary=prev_summary
        )

        # Add document context
        if html_texts:
            html_context_parts = []
            for i, (text, doc_meta) in enumerate(html_texts, 1):
                text_preview = text[:2000] + ('...' if len(text) > 2000 else '')
                html_context_parts.append(
                    f"Document {i}: {doc_meta.get('title', 'Unknown')} ({doc_meta.get('document_type', 'unknown')})\n"
                    f"Text content:\n{text_preview}"
                )
            html_context = '\n\n'.join(html_context_parts)
            targeted_prompt += f"\n\nBelow are text documents to search:\n{html_context}"
        
        # Verbose output is now handled in extract_missing_kpis function
        
        # Initialize Gemini
        gemini_api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_AI_API_KEY')
        if not gemini_api_key:
            return None
        
        genai.configure(api_key=gemini_api_key)
        model_name = get_gemini_model()
        model = genai.GenerativeModel(model_name)
        
        # Prepare content parts
        content_parts = [targeted_prompt]
        
        # Add PDF files
        for pdf_content, doc_meta in pdf_files:
            pdf_base64 = base64.b64encode(pdf_content).decode('utf-8')
            content_parts.append({
                'mime_type': 'application/pdf',
                'data': pdf_base64
            })
        
        # Generate with structured output
        response = model.generate_content(
            content_parts,
            generation_config={
                'temperature': 0.2,  # Lower temperature for more focused search
                'max_output_tokens': 2000,  # Reasonable limit to prevent overly verbose responses
                'response_mime_type': 'application/json',
                'response_schema': response_schema
            }
        )
        
        # Parse JSON response
        try:
            # Get response text - handle both string and response object
            if hasattr(response, 'text'):
                response_text = response.text
            elif isinstance(response, str):
                response_text = response
            else:
                # Try to get text from parts
                response_text = str(response)
            
            # Extract JSON if wrapped in markdown code blocks
            response_text = extract_json_from_llm_response(response_text)
            
            # Parse JSON
            result = json.loads(response_text)
        except json.JSONDecodeError as e:
            if verbose:
                error_msg = str(e)
                print(f'     ⚠️  JSON parsing error for "{kpi_name}": {error_msg}')
                response_preview = response_text[:1000] if 'response_text' in locals() else str(response)[:1000]
                print(f'     Response preview (first 1000 chars): {response_preview}')
                if 'response_text' in locals() and len(response_text) > 1000:
                    print(f'     Response preview (last 500 chars): ...{response_text[-500:]}')
            return None
        except AttributeError as e:
            # Response might not have expected attributes
            if verbose:
                print(f'     ⚠️  Invalid response format for "{kpi_name}": {e}')
                print(f'     Response type: {type(response)}')
            return None
        except Exception as e:
            if verbose:
                print(f'     ⚠️  Error parsing response for "{kpi_name}": {e}')
                import traceback
                traceback.print_exc()
            return None
        
        if result.get('found') and result.get('kpi'):
            found_kpi = result['kpi']
            # Ensure unit matches previous quarter exactly
            found_kpi['unit'] = prev_unit
            # Ensure name matches exactly
            found_kpi['name'] = kpi_name
            # Ensure group matches
            found_kpi['group'] = prev_group
            # Preserve summary if not provided
            if not found_kpi.get('summary') and prev_summary:
                found_kpi['summary'] = prev_summary
            # Preserve context if not provided
            if not found_kpi.get('context') and prev_context:
                found_kpi['context'] = prev_context
            # Merge other_names
            if prev_other_names:
                current_other_names = set(found_kpi.get('other_names', []))
                current_other_names.update(prev_other_names)
                found_kpi['other_names'] = sorted(list(current_other_names))
            # Set frequency (will be updated later, but set initial value)
            found_kpi['frequency'] = prev_frequency + 1
            if verbose:
                print(f'     ✅ Found: "{kpi_name}" = {found_kpi.get("value", "N/A")} {prev_unit}')
            return found_kpi
        else:
            # KPI not found - display explanation
            explanation = result.get('explanation', 'No explanation provided')
            similar_kpis = result.get('similar_kpis', [])
            
            if verbose:
                print(f'     ❌ Not found in documents')
                print(f'     📝 Explanation: {explanation}')
                
                if similar_kpis:
                    print(f'     🔍 Similar KPIs found ({len(similar_kpis)}):')
                    for similar in similar_kpis:
                        similar_name = similar.get('name', 'Unknown')
                        similar_value = similar.get('value', 'N/A')
                        reason = similar.get('reason_not_matched', 'No reason provided')
                        print(f'       • "{similar_name}": {similar_value}')
                        print(f'         Reason not matched: {reason}')
            
            return None
        
    except Exception as e:
        if verbose:
            print(f'     ⚠️  Error searching for "{kpi_name}": {e}')
        return None


def extract_missing_kpis(
    ticker: str,
    quarter_key: str,
    extracted_kpis: List[Dict[str, Any]],
    previous_quarter_kpis: Optional[List[Dict[str, Any]]],
    pdf_files: List[tuple[bytes, Dict]],
    html_texts: List[tuple[str, Dict]],
    verbose: bool = False
) -> List[Dict[str, Any]]:
    """Extract missing KPIs individually using targeted prompts
    
    Args:
        ticker: Stock ticker symbol
        quarter_key: Quarter key in format YYYYQN
        extracted_kpis: Already extracted KPIs
        previous_quarter_kpis: KPIs from previous quarter
        pdf_files: List of (content_bytes, doc_meta) tuples
        html_texts: List of (text, doc_meta) tuples
        verbose: Enable verbose output
        
    Returns:
        Updated list of KPIs including any found missing KPIs
    """
    if not previous_quarter_kpis:
        return extracted_kpis
    
    # Find missing KPIs
    current_kpi_names = {kpi.get('name', '') for kpi in extracted_kpis}
    missing_kpis = [
        prev_kpi for prev_kpi in previous_quarter_kpis
        if prev_kpi.get('name', '') not in current_kpi_names
    ]
    
    if not missing_kpis:
        return extracted_kpis
    
    if verbose:
        print(f'\n🔍 Searching for {len(missing_kpis)} missing KPI(s) using targeted extraction...')
        print('-'*80)
    
    found_kpis = []
    for missing_kpi in missing_kpis:
        kpi_name = missing_kpi.get('name', '')
        frequency = missing_kpi.get('frequency', 1)
        summary = missing_kpi.get('summary', 'No summary available')
        
        # Only search for KPIs with frequency > 1 (repeated metrics, not one-off)
        # This avoids searching for metrics that might have been intentionally dropped
        if frequency > 1:
            if verbose:
                print(f'     📊 Missing KPI: "{kpi_name}"')
                print(f'        Summary: {summary}')
                print(f'     🔍 Searching for missing KPI: "{kpi_name}"...')
            
            found_kpi = extract_missing_kpi(
                ticker,
                quarter_key,
                missing_kpi,
                pdf_files,
                html_texts,
                verbose
            )
            if found_kpi:
                found_kpis.append(found_kpi)
        elif verbose:
            print(f'     ⏭️  Skipping "{kpi_name}" (frequency={frequency}, likely one-off metric)')
            print(f'        Summary: {summary}')
    
    if found_kpis:
        if verbose:
            print(f'   ✅ Found {len(found_kpis)} missing KPI(s)')
        # Merge found KPIs into extracted KPIs
        extracted_kpis.extend(found_kpis)
    elif verbose:
        print(f'   ⚠️  No missing KPIs found in documents')
    
    return extracted_kpis


def calculate_kpi_frequency(kpi_name: str, previous_kpis: Optional[List[Dict[str, Any]]]) -> int:
    """Calculate frequency for a KPI based on previous quarter data (legacy function)
    
    Args:
        kpi_name: Name of the KPI
        previous_kpis: List of KPIs from previous quarter
        
    Returns:
        Frequency (number of quarters this KPI has been reported)
    """
    if not previous_kpis:
        return 1  # First time reported
    
    # Find this KPI in previous quarter
    for prev_kpi in previous_kpis:
        if prev_kpi.get('name') == kpi_name:
            prev_freq = prev_kpi.get('frequency', 1)
            return prev_freq + 1
    
    return 1  # Not found in previous quarter, so it's new


def extract_kpis(
    ticker: str,
    quarter_key: str,
    pdf_files: List[tuple[bytes, Dict]],
    html_texts: List[tuple[str, Dict]],
    verbose: bool = False,
    previous_quarter_data: Optional[Dict[str, Any]] = None
) -> Optional[List[Dict[str, Any]]]:
    """Extract custom KPIs from IR documents using structured output
    
    Args:
        ticker: Stock ticker symbol
        quarter_key: Quarter key in format YYYYQN
        pdf_files: List of (content_bytes, doc_meta) tuples
        html_texts: List of (text, doc_meta) tuples
        verbose: Enable verbose output
        previous_quarter_data: Optional data from previous quarter
        
    Returns:
        List of KPI dictionaries or None if extraction failed
    """
    try:
        # Load KPI schema - already simplified for Gemini compatibility
        kpi_schema = load_json_schema('kpi_schema.json')
        
        # Create array schema for response (array of KPIs)
        array_schema = {
            "type": "array",
            "items": kpi_schema
        }
        
        # Prepare prompt
        previous_kpis = previous_quarter_data.get('custom_kpis', []) if previous_quarter_data else []
        
        prev_kpi_summary = ""
        if previous_kpis:
            kpis_by_group = {}
            for kpi in previous_kpis:
                group = kpi.get('group', 'Other')
                if group not in kpis_by_group:
                    kpis_by_group[group] = []
                name = kpi.get('name', 'Unknown')
                unit = kpi.get('unit', '')
                summary = kpi.get('summary', '')
                # Format: "Name (unit)" if unit exists, or just "Name"
                if unit:
                    name_with_unit = f"{name} ({unit})"
                else:
                    name_with_unit = name
                # Add summary if available
                if summary:
                    name_with_unit += f" - {summary}"
                kpis_by_group[group].append(name_with_unit)
            
            prev_kpi_summary = "\nPrevious quarter KPIs by group:\n"
            for group, items in kpis_by_group.items():
                prev_kpi_summary += f"  - {group}:\n"
                for item in items:
                    prev_kpi_summary += f"    • {item}\n"
        
        previous_context = ""
        if previous_quarter_data:
            prev_quarter = previous_quarter_data.get('quarter_key', 'previous quarter')
            previous_context = f"""
PREVIOUS QUARTER CONTEXT ({prev_quarter}):
{prev_kpi_summary}

Use this previous quarter context to:
1. Maintain consistency in KPI extraction (extract similar KPIs if they exist)
2. Identify new KPIs or discontinued ones
"""
        
        # Prepare document context
        html_context = ""
        if html_texts:
            html_context_parts = []
            for i, (text, doc_meta) in enumerate(html_texts, 1):
                text_preview = text[:3000] + ('...' if len(text) > 3000 else '')
                html_context_parts.append(
                    f"Document {i}: {doc_meta.get('title', 'Unknown')} ({doc_meta.get('document_type', 'unknown')})\n"
                    f"Text content:\n{text_preview}"
                )
            html_context = '\n\n'.join(html_context_parts)
        
        # Load and render prompt template
        prompt = load_prompt_template(
            'kpi_extraction_prompt.txt',
            ticker=ticker,
            quarter_key=quarter_key,
            previous_quarter_context=previous_context,
            previous_quarter_note=' and the previous quarter context provided above' if previous_quarter_data else '',
            previous_quarter_kpi_step='Step 0: Review previous quarter KPIs (if provided above) to understand what metrics were tracked. Maintain consistency - if a KPI was tracked in the previous quarter, look for it in this quarter as well. This ensures continuity and allows for trend analysis.\n\n' if previous_quarter_data else '',
            previous_quarter_segment_note='Compare with previous quarter segments to identify new segments or discontinued segments.' if previous_quarter_data else '',
            consistency_note='Maintain consistency with previous quarter KPIs - if a metric was tracked before, ensure you extract it again this quarter (even if the value is zero or not mentioned, note that it was not reported).' if previous_quarter_data else ''
        )
        
        if html_context:
            prompt += f"\n\nBelow are additional text documents:\n{html_context}"
        
        # Initialize Gemini
        gemini_api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_AI_API_KEY')
        if not gemini_api_key:
            print('Error: GEMINI_API_KEY or GOOGLE_AI_API_KEY not set')
            return None
        
        genai.configure(api_key=gemini_api_key)
        model_name = get_gemini_model()
        model = genai.GenerativeModel(model_name)
        
        # Prepare content parts
        content_parts = [prompt]
        
        # Add PDF files
        for pdf_content, doc_meta in pdf_files:
            pdf_base64 = base64.b64encode(pdf_content).decode('utf-8')
            content_parts.append({
                'mime_type': 'application/pdf',
                'data': pdf_base64
            })
            if verbose:
                print(f'  📄 Added PDF: {doc_meta.get("title", "Unknown")} ({len(pdf_content) / 1024:.1f}KB)')
        
        if verbose:
            print(f'\nCalling Gemini API for KPI extraction with {len(pdf_files)} PDF(s) and {len(html_texts)} text document(s)...')
        
        # Generate with structured output
        response = model.generate_content(
            content_parts,
            generation_config={
                'temperature': 0.3,
                'max_output_tokens': 8000,
                'response_mime_type': 'application/json',
                'response_schema': array_schema
            }
        )
        
        # Parse JSON response
        kpis = json.loads(response.text)
        
        # Note: Frequencies will be calculated programmatically before saving
        # We don't calculate them here since we need all previous quarters
        
        if verbose:
            print(f'✅ Extracted {len(kpis)} KPIs')
            # Print comparison with previous quarter
            prev_quarter_key = previous_quarter_data.get('quarter_key', 'previous quarter') if previous_quarter_data else None
            print_kpi_comparison(kpis, previous_kpis, quarter_key, prev_quarter_key)
        
        return kpis
        
    except Exception as e:
        print(f'Error extracting KPIs: {e}')
        if verbose:
            import traceback
            traceback.print_exc()
        return None


def print_kpi_matrix(results: Dict[str, List[Dict[str, Any]]]) -> None:
    """Print a matrix showing which KPIs appear in which quarters
    
    Args:
        results: Dictionary mapping quarter_key to list of KPIs
    """
    if not results:
        return
    
    # Collect all unique KPI names across all quarters
    all_kpi_names = set()
    for quarter_key, kpis in results.items():
        for kpi in kpis:
            kpi_name = kpi.get('name', '')
            if kpi_name:
                all_kpi_names.add(kpi_name)
    
    # Sort KPI names for consistent display
    sorted_kpi_names = sorted(all_kpi_names)
    
    if not sorted_kpi_names:
        print('\n⚠️  No KPIs found to display')
        return
    
    # Sort quarters chronologically
    sorted_quarters = sorted(results.keys())
    
    print(f'\n{"="*80}')
    print('KPI METRICS MATRIX')
    print(f'{"="*80}')
    print(f'Metrics: {len(sorted_kpi_names)} | Quarters: {len(sorted_quarters)}')
    print(f'{"="*80}\n')
    
    # Create a lookup map for each quarter's KPIs
    quarter_kpis = {}
    for quarter_key in sorted_quarters:
        quarter_kpis[quarter_key] = {
            kpi.get('name', ''): kpi for kpi in results[quarter_key]
            if kpi.get('name', '')
        }
    
    # Calculate column widths - make it compact
    max_metric_name_width = min(
        max(len(name) for name in sorted_kpi_names) if sorted_kpi_names else 30,
        35  # Cap metric name width
    )
    cell_width = 4  # Compact width for quarter cells (just the number)
    
    # Header row - show quarter indices (1, 2, 3, ...)
    header = f"{'Metric':<{max_metric_name_width}}"
    for i in range(1, len(sorted_quarters) + 1):
        header += f"{str(i):>{cell_width}}"
    print(header)
    print('-' * len(header))
    
    # Data rows - one row per metric, showing presence in each quarter
    for kpi_name in sorted_kpi_names:
        # Truncate metric name if too long
        display_name = kpi_name[:max_metric_name_width] if len(kpi_name) > max_metric_name_width else kpi_name
        row = f"{display_name:<{max_metric_name_width}}"
        for quarter_key in sorted_quarters:
            if kpi_name in quarter_kpis[quarter_key]:
                kpi = quarter_kpis[quarter_key][kpi_name]
                frequency = kpi.get('frequency', 1)
                # Show just the frequency number (compact)
                row += f"{str(frequency):>{cell_width}}"
            else:
                row += f"{'-':>{cell_width}}"
        print(row)
    
    # Print quarter labels below the matrix for reference (compact)
    print('\nQuarters:', ' '.join(f"{i}:{q}" for i, q in enumerate(sorted_quarters, 1)))
    
    # Summary footer
    print(f'\n{"="*80}')
    print('SUMMARY BY METRIC:')
    print(f'{"="*80}')
    
    # Count appearances for each metric
    metric_counts = {}
    for quarter_key, kpis in results.items():
        for kpi in kpis:
            kpi_name = kpi.get('name', '')
            if kpi_name:
                if kpi_name not in metric_counts:
                    metric_counts[kpi_name] = {'count': 0, 'max_frequency': 0}
                metric_counts[kpi_name]['count'] += 1
                metric_counts[kpi_name]['max_frequency'] = max(
                    metric_counts[kpi_name]['max_frequency'],
                    kpi.get('frequency', 1)
                )
    
    # Sort by frequency (most consistent metrics first)
    sorted_metrics = sorted(
        metric_counts.items(),
        key=lambda x: (x[1]['max_frequency'], x[1]['count']),
        reverse=True
    )
    
    for kpi_name, stats in sorted_metrics:
        appearance_rate = (stats['count'] / len(sorted_quarters)) * 100 if sorted_quarters else 0
        print(f"  {kpi_name}: appears {stats['count']}/{len(sorted_quarters)} quarters "
              f"({appearance_rate:.0f}%), max frequency: {stats['max_frequency']}")
    
    print(f'{"="*80}\n')


def normalize_annual_q4_values(
    timeseries_values: List[Dict[str, Any]],
    sorted_quarters: List[str],
    verbose: bool = False
) -> tuple[List[Dict[str, Any]], int]:
    """Detect and normalize annual Q4 values to quarterly
    
    Args:
        timeseries_values: List of quarter value dictionaries
        sorted_quarters: Sorted list of quarter keys
        verbose: Enable verbose output
        
    Returns:
        Tuple of (normalized_timeseries_values, count_of_normalized_values)
    """
    normalized_count = 0
    normalized_values = timeseries_values.copy()
    
    # Group quarters by year
    years_data = {}  # year -> {q1: value, q2: value, q3: value, q4: value, ...}
    
    for i, quarter_key in enumerate(sorted_quarters):
        year = int(quarter_key[:4])
        quarter_num = int(quarter_key[5])
        
        if year not in years_data:
            years_data[year] = {}
        
        if i < len(normalized_values) and normalized_values[i].get('value') is not None:
            try:
                # Try to parse value as float (handle strings like "100.5B", "50M", etc.)
                value_str = str(normalized_values[i]['value'])
                # Remove common suffixes and parse
                value_str_clean = value_str.replace(',', '').strip()
                
                # Handle billions, millions, thousands
                multiplier = 1.0
                if value_str_clean.upper().endswith('B'):
                    multiplier = 1e9
                    value_str_clean = value_str_clean[:-1]
                elif value_str_clean.upper().endswith('M'):
                    multiplier = 1e6
                    value_str_clean = value_str_clean[:-1]
                elif value_str_clean.upper().endswith('K'):
                    multiplier = 1e3
                    value_str_clean = value_str_clean[:-1]
                
                # Remove currency symbols and parse
                value_str_clean = value_str_clean.replace('$', '').replace('%', '').strip()
                
                value_float = float(value_str_clean) * multiplier
                years_data[year][f'q{quarter_num}'] = {
                    'value': value_float,
                    'index': i,
                    'original_value': normalized_values[i]['value']
                }
            except (ValueError, TypeError):
                # Can't parse, skip
                continue
    
    # Check each year for annual Q4 values
    for year, quarters in years_data.items():
        if 'q4' not in quarters:
            continue
        
        q4_data = quarters['q4']
        q4_value = q4_data['value']
        
        # Get Q1-Q3 values for this year
        q1_q3_values = []
        for q in ['q1', 'q2', 'q3']:
            if q in quarters:
                q1_q3_values.append(quarters[q]['value'])
        
        if len(q1_q3_values) < 2:  # Need at least 2 quarters to compare
            continue
        
        # Calculate average of Q1-Q3
        avg_q1_q3 = sum(q1_q3_values) / len(q1_q3_values)
        sum_q1_q3 = sum(q1_q3_values)
        
        # Skip if Q4 or Q1-Q3 values are zero or too small (to avoid division issues)
        if abs(q4_value) < 1e-6 or abs(avg_q1_q3) < 1e-6:
            continue
        
        # Check if Q4 appears to be annual (roughly 4x average or close to sum of Q1-Q3)
        # Use a tolerance range: 3.5x to 4.5x average, or 0.9x to 1.1x of (sum Q1-Q3)
        ratio_to_avg = q4_value / avg_q1_q3 if abs(avg_q1_q3) > 1e-6 else 0
        ratio_to_sum = q4_value / sum_q1_q3 if abs(sum_q1_q3) > 1e-6 else 0
        
        is_annual = False
        if 3.5 <= ratio_to_avg <= 4.5:
            # Q4 is roughly 4x the average of Q1-Q3
            is_annual = True
        elif 0.9 <= ratio_to_sum <= 1.1:
            # Q4 is roughly equal to sum of Q1-Q3 (missing one quarter scenario)
            is_annual = True
        
        if is_annual:
            # Convert annual Q4 to quarterly by dividing by 4
            q4_index = q4_data['index']
            original_value = normalized_values[q4_index]['value']
            quarterly_value = q4_value / 4.0
            
            # Format back to string preserving original format if possible
            if isinstance(original_value, str):
                # Try to preserve the format (e.g., "100.5B" -> "25.1B")
                if 'B' in original_value.upper():
                    quarterly_str = f"{quarterly_value / 1e9:.2f}B"
                elif 'M' in original_value.upper():
                    quarterly_str = f"{quarterly_value / 1e6:.2f}M"
                elif 'K' in original_value.upper():
                    quarterly_str = f"{quarterly_value / 1e3:.2f}K"
                else:
                    quarterly_str = str(quarterly_value)
                normalized_values[q4_index]['value'] = quarterly_str
            else:
                normalized_values[q4_index]['value'] = quarterly_value
            
            normalized_values[q4_index]['was_annual'] = True
            normalized_values[q4_index]['original_annual_value'] = original_value
            normalized_count += 1
            
            if verbose:
                print(f'   🔄 Normalized {year}Q4: {original_value} (annual) → {normalized_values[q4_index]["value"]} (quarterly)')
    
    return normalized_values, normalized_count


def create_kpi_timeseries(
    results: Dict[str, List[Dict[str, Any]]],
    min_coverage: float = 0.6,
    verbose: bool = False
) -> Dict[str, Any]:
    """Create timeseries for KPIs with sufficient data coverage
    
    Args:
        results: Dictionary mapping quarter_key to list of KPIs
        min_coverage: Minimum data coverage threshold (0.6 = 60%)
        verbose: Enable verbose output
        
    Returns:
        Dictionary containing KPI timeseries data
    """
    if not results:
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
    
    # Sort quarters chronologically
    sorted_quarters = sorted(results.keys())
    total_quarters = len(sorted_quarters)
    min_quarters_required = int(total_quarters * min_coverage)
    
    if verbose:
        print(f'\n📊 Creating KPI timeseries...')
        print(f'   Total quarters: {total_quarters}')
        print(f'   Minimum coverage: {min_coverage * 100:.0f}% ({min_quarters_required} quarters)')
    
    # Collect all unique KPI names and their appearances across quarters
    kpi_data = {}  # kpi_name -> {quarter_key: kpi_dict, ...}
    kpi_metadata = {}  # kpi_name -> {group, unit, frequency, etc.}
    
    for quarter_key, kpis in results.items():
        for kpi in kpis:
            kpi_name = kpi.get('name', '')
            if not kpi_name:
                continue
            
            if kpi_name not in kpi_data:
                kpi_data[kpi_name] = {}
                kpi_metadata[kpi_name] = {
                    'group': kpi.get('group', 'Other'),
                    'unit': kpi.get('unit', ''),
                    'max_frequency': 0
                }
            
            kpi_data[kpi_name][quarter_key] = kpi
            kpi_metadata[kpi_name]['max_frequency'] = max(
                kpi_metadata[kpi_name]['max_frequency'],
                kpi.get('frequency', 1)
            )
    
    # Filter KPIs by coverage threshold
    kpi_timeseries = []
    filtered_out = []
    total_normalized = 0  # Track total normalized Q4 values across all KPIs
    
    for kpi_name, quarter_data in kpi_data.items():
        coverage_count = len(quarter_data)
        coverage_rate = coverage_count / total_quarters if total_quarters > 0 else 0
        
        if coverage_count >= min_quarters_required:
            # Build timeseries for this KPI
            timeseries_values = []
            
            for quarter_key in sorted_quarters:
                if quarter_key in quarter_data:
                    kpi = quarter_data[quarter_key]
                    timeseries_values.append({
                        'quarter': quarter_key,
                        'value': kpi.get('value', None),
                        'unit': kpi.get('unit', ''),
                        'change': kpi.get('change', None),
                        'change_type': kpi.get('change_type', None),
                        'frequency': kpi.get('frequency', 1),
                        'context': kpi.get('context', ''),
                        'source': kpi.get('source', '')
                    })
                else:
                    # Include missing quarters as null values to maintain continuity
                    timeseries_values.append({
                        'quarter': quarter_key,
                        'value': None,
                        'unit': kpi_metadata[kpi_name]['unit'],
                        'change': None,
                        'change_type': None,
                        'frequency': 0,
                        'context': None,
                        'source': None
                    })
            
            # Normalize annual Q4 values to quarterly
            timeseries_values, normalized_count = normalize_annual_q4_values(
                timeseries_values,
                sorted_quarters,
                verbose
            )
            total_normalized += normalized_count
            
            kpi_timeseries.append({
                'name': kpi_name,
                'group': kpi_metadata[kpi_name]['group'],
                'unit': kpi_metadata[kpi_name]['unit'],
                'coverage': coverage_rate,
                'coverage_count': coverage_count,
                'total_quarters': total_quarters,
                'max_frequency': kpi_metadata[kpi_name]['max_frequency'],
                'values': timeseries_values
            })
        else:
            filtered_out.append({
                'name': kpi_name,
                'coverage': coverage_rate,
                'coverage_count': coverage_count
            })
    
    # Sort by coverage (highest first), then by name
    kpi_timeseries.sort(key=lambda x: (-x['coverage'], x['name']))
    
    if verbose:
        print(f'   ✅ Included KPIs: {len(kpi_timeseries)} (≥{min_coverage * 100:.0f}% coverage)')
        if filtered_out:
            print(f'   ⚠️  Filtered out: {len(filtered_out)} KPIs (<{min_coverage * 100:.0f}% coverage)')
        if total_normalized > 0:
            print(f'   🔄 Normalized {total_normalized} annual Q4 value(s) to quarterly')
    
    return {
        'kpis': kpi_timeseries,
        'metadata': {
            'total_quarters': total_quarters,
            'quarters': sorted_quarters,
            'min_coverage': min_coverage,
            'min_quarters_required': min_quarters_required,
                'total_kpis_extracted': len(kpi_data),
                'kpis_included': len(kpi_timeseries),
                'kpis_filtered_out': len(filtered_out),
                'annual_q4_normalized': total_normalized,
                'created_at': datetime.now().isoformat()
        }
    }


def get_all_quarters_with_documents(ticker: str) -> List[str]:
    """Get all quarters that have IR documents, sorted chronologically
    
    Args:
        ticker: Stock ticker symbol
        
    Returns:
        List of quarter keys sorted chronologically (earliest first)
    """
    try:
        firebase = FirebaseCache()
        upper_ticker = ticker.upper()
        
        # Get all IR documents
        docs_ref = (firebase.db.collection('tickers')
                   .document(upper_ticker)
                   .collection('ir_documents'))
        
        all_docs = docs_ref.stream()
        
        # Extract unique quarter keys
        quarter_keys = set()
        for doc in all_docs:
            doc_data = doc.to_dict()
            quarter_key = doc_data.get('quarter_key')
            if quarter_key:
                quarter_keys.add(quarter_key)
        
        # Sort chronologically (YYYYQN format)
        sorted_quarters = sorted(quarter_keys, key=lambda q: (int(q[:4]), int(q[5])))
        
        return sorted_quarters
        
    except Exception as e:
        print(f'Error getting quarters for {ticker}: {e}')
        return []


def main():
    parser = argparse.ArgumentParser(
        description='Extract custom KPIs from quarterly investor relations documents',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Extract KPIs for a specific quarter
  python extract_kpis.py AAPL 2025Q1
  
  # Extract with verbose output
  python extract_kpis.py AAPL 2025Q1 --verbose
  
  # Extract without storing (for testing)
  python extract_kpis.py AAPL 2025Q1 --no-store
  
  # Extract KPIs for all quarters starting from 2022Q1
  python extract_kpis.py AAPL --all-quarters --start-quarter 2022Q1
        '''
    )
    
    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT)')
    parser.add_argument('quarter', nargs='?', help='Quarter in format YYYYQN (e.g., 2025Q1). Required unless --all-quarters is used.')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose output')
    parser.add_argument('--no-store', action='store_true', help='Extract KPIs without storing to Firebase')
    parser.add_argument('--all-quarters', action='store_true', help='Process all quarters iteratively (earliest to latest)')
    parser.add_argument('--start-quarter', help='Start processing from this quarter (only used with --all-quarters)')
    
    args = parser.parse_args()
    
    try:
        firebase = FirebaseCache()
        
        if args.all_quarters:
            # Process all quarters starting from start_quarter
            all_quarters = get_all_quarters_with_documents(args.ticker.upper())
            
            if not all_quarters:
                print(f'No quarters with documents found for {args.ticker}')
                sys.exit(1)
            
            # Filter to start from specified quarter if provided
            if args.start_quarter:
                try:
                    import re
                    if not re.match(r'^\d{4}Q[1-4]$', args.start_quarter):
                        print(f'Error: Invalid start-quarter format. Use YYYYQN (e.g., 2022Q1)')
                        sys.exit(1)
                    start_idx = all_quarters.index(args.start_quarter)
                    all_quarters = all_quarters[start_idx:]
                except ValueError:
                    print(f'Warning: Start quarter {args.start_quarter} not found, starting from earliest')
            
            if args.verbose:
                print(f'\n📊 Extracting KPIs for {len(all_quarters)} quarters starting from {all_quarters[0]}')
                print(f'   Quarters: {", ".join(all_quarters)}')
            
            previous_quarter_data = None
            results = {}
            
            for i, quarter_key in enumerate(all_quarters, 1):
                print(f'\n{"="*80}')
                print(f'Extracting KPIs Quarter {i}/{len(all_quarters)}: {quarter_key}')
                print(f'{"="*80}')
                
                # Prepare documents
                pdf_files, html_texts, documents = prepare_documents_for_llm(
                    args.ticker.upper(), 
                    quarter_key, 
                    args.verbose
                )
                
                if not pdf_files and not html_texts:
                    print(f'⚠️  No documents available for {quarter_key}, skipping')
                    continue
                
                # Try to load previous quarter data from storage if not in memory
                if previous_quarter_data is None and i > 1:
                    prev_quarter_idx = i - 2
                    if prev_quarter_idx >= 0:
                        prev_quarter_key = all_quarters[prev_quarter_idx]
                        stored_prev = firebase.get_quarterly_analysis(args.ticker.upper(), prev_quarter_key)
                        if stored_prev:
                            previous_quarter_data = stored_prev
                            if args.verbose:
                                print(f'   Loaded previous quarter ({prev_quarter_key}) from storage')
                
                if previous_quarter_data and args.verbose:
                    print(f'   Using previous quarter ({previous_quarter_data.get("quarter_key")}) context')
                
                # Extract KPIs
                kpis = extract_kpis(
                    args.ticker.upper(),
                    quarter_key,
                    pdf_files,
                    html_texts,
                    args.verbose,
                    previous_quarter_data
                )
                
                if kpis:
                    # Extract missing KPIs using targeted prompts
                    previous_quarter_kpis = previous_quarter_data.get('custom_kpis', []) if previous_quarter_data else None
                    kpis = extract_missing_kpis(
                        args.ticker.upper(),
                        quarter_key,
                        kpis,
                        previous_quarter_kpis,
                        pdf_files,
                        html_texts,
                        args.verbose
                    )
                    # Normalize names and calculate frequencies from previous quarter before saving
                    
                    # First normalize names
                    kpis = normalize_kpi_names(
                        kpis,
                        previous_quarter_kpis,
                        args.verbose
                    )
                    
                    # Then update frequencies
                    kpis = update_kpi_frequencies_from_previous_quarter(
                        kpis,
                        previous_quarter_kpis,
                        args.verbose
                    )
                    
                    # Finally validate unit consistency
                    kpis = validate_kpi_units(
                        kpis,
                        previous_quarter_kpis,
                        args.verbose
                    )
                    
                    results[quarter_key] = kpis
                    # Store KPIs to Firebase unless --no-store
                    if not args.no_store:
                        try:
                            firebase.store_quarterly_analysis(args.ticker.upper(), quarter_key, {
                                'ticker': args.ticker.upper(),
                                'quarter_key': quarter_key,
                                'custom_kpis': kpis,
                                'created_at': datetime.now().isoformat(),
                                'source_documents': [doc.get('document_id') for doc in documents if doc.get('document_id')],
                                'num_documents': len(documents),
                                'num_pdfs': len(pdf_files),
                                'num_html': len(html_texts)
                            }, args.verbose)
                            print(f'\n✅ Extracted and stored {len(kpis)} KPIs for {quarter_key}')
                        except Exception as e:
                            print(f'⚠️  Error storing KPIs for {quarter_key}: {e}')
                    else:
                        print(f'\n✅ Extracted {len(kpis)} KPIs (not stored)')
                    
                    # Use as context for next quarter
                    previous_quarter_data = {
                        'quarter_key': quarter_key,
                        'custom_kpis': kpis
                    }
                else:
                    print(f'⚠️  Failed to extract KPIs for {quarter_key}')
            
            # Summary
            print(f'\n{"="*80}')
            print(f'✅ Completed KPI extraction for {len(results)} quarters')
            print(f'{"="*80}')
            for quarter_key, kpis in results.items():
                print(f'{quarter_key}: {len(kpis)} KPIs')
            
            # Print KPI matrix
            print_kpi_matrix(results)
            
            # Create and store KPI timeseries (only for KPIs with >60% coverage)
            if results and not args.no_store:
                try:
                    timeseries_data = create_kpi_timeseries(results, min_coverage=0.6, verbose=args.verbose)
                    timeseries_data['ticker'] = args.ticker.upper()
                    
                    firebase.cache_kpi_timeseries(args.ticker.upper(), timeseries_data)
                    
                    if args.verbose:
                        print(f'\n📈 KPI Timeseries Summary:')
                        print(f'   Total KPIs extracted: {timeseries_data["metadata"]["total_kpis_extracted"]}')
                        print(f'   KPIs included (≥60% coverage): {timeseries_data["metadata"]["kpis_included"]}')
                        print(f'   KPIs filtered out: {timeseries_data["metadata"]["kpis_filtered_out"]}')
                        print(f'   Stored at: tickers/{args.ticker.upper()}/timeseries/kpi')
                except Exception as e:
                    print(f'⚠️  Error creating/storing KPI timeseries: {e}')
                    if args.verbose:
                        import traceback
                        traceback.print_exc()
        
        else:
            # Single quarter KPI extraction
            if not args.quarter:
                parser.error('Quarter is required (or use --all-quarters)')
            
            # Validate quarter format
            import re
            if not re.match(r'^\d{4}Q[1-4]$', args.quarter):
                print(f'Error: Invalid quarter format. Use YYYYQN (e.g., 2025Q1)')
                sys.exit(1)
            
            if args.verbose:
                print(f'Extracting KPIs for {args.ticker} {args.quarter}...')
            
            # Prepare documents
            pdf_files, html_texts, documents = prepare_documents_for_llm(
                args.ticker.upper(), 
                args.quarter, 
                args.verbose
            )
            
            if not pdf_files and not html_texts:
                print(f'No documents available for KPI extraction')
                sys.exit(1)
            
            # Get previous quarter data if available
            previous_quarter_data = None
            
            # Calculate previous quarter
            year_str, q_str = args.quarter.split('Q')
            year = int(year_str)
            quarter = int(q_str)
            if quarter == 1:
                prev_year = year - 1
                prev_quarter = 4
            else:
                prev_year = year
                prev_quarter = quarter - 1
            prev_quarter_key = f"{prev_year}Q{prev_quarter}"
            
            prev_analysis = firebase.get_quarterly_analysis(args.ticker.upper(), prev_quarter_key)
            if prev_analysis:
                previous_quarter_data = prev_analysis
            
            # Extract KPIs
            kpis = extract_kpis(
                args.ticker.upper(),
                args.quarter,
                pdf_files,
                html_texts,
                args.verbose,
                previous_quarter_data
            )
            
            if kpis:
                # Extract missing KPIs using targeted prompts
                previous_quarter_kpis = previous_quarter_data.get('custom_kpis', []) if previous_quarter_data else None
                kpis = extract_missing_kpis(
                    args.ticker.upper(),
                    args.quarter,
                    kpis,
                    previous_quarter_kpis,
                    pdf_files,
                    html_texts,
                    args.verbose
                )
            
            if not kpis:
                print(f'Failed to extract KPIs for {args.ticker} {args.quarter}')
                sys.exit(1)
            
            # Normalize names and calculate frequencies from previous quarter before saving
            previous_quarter_kpis = previous_quarter_data.get('custom_kpis', []) if previous_quarter_data else None
            
            # First normalize names
            kpis = normalize_kpi_names(
                kpis,
                previous_quarter_kpis,
                args.verbose
            )
            
            # Then update frequencies
            kpis = update_kpi_frequencies_from_previous_quarter(
                kpis,
                previous_quarter_kpis,
                args.verbose
            )
            
            # Finally validate unit consistency
            kpis = validate_kpi_units(
                kpis,
                previous_quarter_kpis,
                args.verbose
            )
            
            # Store KPIs to Firebase unless --no-store
            if not args.no_store:
                try:
                    firebase.store_quarterly_analysis(args.ticker.upper(), args.quarter, {
                        'ticker': args.ticker.upper(),
                        'quarter_key': args.quarter,
                        'custom_kpis': kpis,
                        'created_at': datetime.now().isoformat(),
                        'source_documents': [doc.get('document_id') for doc in documents if doc.get('document_id')],
                        'num_documents': len(documents),
                        'num_pdfs': len(pdf_files),
                        'num_html': len(html_texts)
                    }, args.verbose)
                    print(f'\n✅ Extracted and stored {len(kpis)} KPIs for {args.ticker} {args.quarter}')
                except Exception as e:
                    print(f'⚠️  Error storing KPIs: {e}')
            else:
                print(f'\n✅ Extracted {len(kpis)} KPIs (not stored)')
            
            # Display results
            print(f'\nExtracted KPIs:')
            print('='*80)
            for i, kpi in enumerate(kpis, 1):
                print(f"\n{i}. {kpi.get('name', 'N/A')}")
                print(f"   Value: {kpi.get('value', 'N/A')} {kpi.get('unit', '')}")
                print(f"   Group: {kpi.get('group', 'N/A')}")
                print(f"   Frequency: {kpi.get('frequency', 'N/A')}")
                if kpi.get('change'):
                    print(f"   Change: {kpi.get('change', 'N/A')} ({kpi.get('change_type', 'N/A')})")
            
            if args.verbose:
                print(f'\nFull KPI data:')
                print(json.dumps(kpis, indent=2))
    
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
