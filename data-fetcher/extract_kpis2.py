#!/usr/bin/env python3
"""
Extract KPIs from Quarterly IR Documents (Simplified)

Minimal version that extracts custom KPIs from quarterly investor relations documents
for a single quarter. Focuses on extracting company-specific metrics that are not in 
standard financial statements.
"""

import os
import json
import argparse
import sys
import base64
import re
from datetime import datetime
from typing import Dict, List, Optional, Any
from dotenv import load_dotenv
import google.generativeai as genai

from firebase_cache import FirebaseCache
from document_text_extractor import extract_text_from_html
from pathlib import Path
from extraction_utils import (
    get_gemini_model,
    extract_json_from_llm_response,
    load_prompt_template,
    load_json_schema,
    clean_schema_for_gemini,
    load_example_document,
    get_previous_quarter_key
)

# Load environment variables from .env.local
load_dotenv('.env.local')

# Get the directory where this script is located
SCRIPT_DIR = Path(__file__).parent
PROMPTS_DIR = SCRIPT_DIR / 'prompts'
SCHEMAS_DIR = SCRIPT_DIR


def prepare_documents_for_llm(ticker: str, quarter_key: str, verbose: bool = False, document_type_filter: Optional[str] = None) -> tuple[List[tuple[bytes, Dict]], List[tuple[str, Dict]], List[Dict]]:
    """Prepare documents for LLM processing"""
    firebase = FirebaseCache()
    documents = firebase.get_ir_documents_for_quarter(ticker, quarter_key)
    
    if not documents:
        if verbose:
            print(f'No documents found for {ticker} {quarter_key}')
        return [], [], []
    
    # Filter out Consolidated Financial Statements
    documents = [
        doc for doc in documents
        if not (
            'consolidated financial' in doc.get('title', '').lower() or
            'consolidated financial' in doc.get('document_type', '').lower() or
            doc.get('document_type', '').lower() == 'financial_statements'
        )
    ]
    
    # Filter by document type if specified
    if document_type_filter:
        documents = [
            doc for doc in documents
            if doc.get('document_type', '').lower() == document_type_filter.lower()
        ]
    
    if verbose:
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
                print(f'  📄 Preparing PDF: {doc.get("title", "Unknown")} ({len(doc_content) / 1024:.1f}KB)')
            pdf_files.append((doc_content, doc))
        else:
            if verbose:
                print(f'  📝 Extracting text from HTML: {doc.get("title", "Unknown")}')
            text = extract_text_from_html(doc_content)
            if text:
                html_texts.append((text[:50000], doc))
    
    return pdf_files, html_texts, documents


def detect_unit_type_mismatch(unit1: str, unit2: str) -> bool:
    """Detect if two units represent different types (e.g., percentage vs dollar)"""
    if not unit1 or not unit2:
        return False
    
    unit1_lower = unit1.lower().strip()
    unit2_lower = unit2.lower().strip()
    
    percentage_units = ['%', 'percent', 'percentage', 'pct']
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
    """Check if a KPI name matches a previous quarter KPI by name or other_names"""
    if not previous_quarter_kpis:
        return kpi_name, None, False
    
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
                return prev_kpi.get('name', ''), prev_kpi, True
    
    return kpi_name, None, False


def normalize_kpi_names(
    kpis: List[Dict[str, Any]],
    previous_quarter_kpis: Optional[List[Dict[str, Any]]],
    verbose: bool = False
) -> List[Dict[str, Any]]:
    """Normalize KPI names by matching against previous quarter KPIs"""
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
        
        canonical_name, matched_prev_kpi, was_matched = normalize_kpi_name(kpi_name, previous_quarter_kpis)
        current_other_names = set(kpi.get('other_names', []))
        
        if was_matched and matched_prev_kpi:
            if canonical_name != kpi_name:
                if verbose:
                    print(f'  🔄 Normalized: "{kpi_name}" → "{canonical_name}"')
                normalized_count += 1
                current_other_names.add(kpi_name)
            
            prev_other_names = matched_prev_kpi.get('other_names', [])
            current_other_names.update(prev_other_names)
            
            if kpi_name != canonical_name:
                current_other_names.add(kpi_name)
            
            kpi['name'] = canonical_name
            
            # Normalize unit to match previous quarter exactly
            prev_unit = matched_prev_kpi.get('unit', '')
            current_unit = kpi.get('unit', '')
            if prev_unit and prev_unit != current_unit:
                is_critical_mismatch = detect_unit_type_mismatch(prev_unit, current_unit)
                kpi['unit'] = prev_unit
                
                if is_critical_mismatch:
                    print(f'  🚨 CRITICAL UNIT TYPE MISMATCH for "{canonical_name}" (RESOLVED):')
                    print(f'     Previous quarter unit: "{prev_unit}"')
                    print(f'     Current quarter unit was: "{current_unit}"')
                    print(f'     ✅ Corrected to: "{prev_unit}" to maintain consistency')
                elif verbose:
                    print(f'  ⚠️  Unit mismatch for "{canonical_name}" (RESOLVED): current="{current_unit}" → corrected to "{prev_unit}"')
            elif prev_unit:
                kpi['unit'] = prev_unit
        
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
    """Update KPI frequencies by checking against previous quarter KPIs"""
    if not kpis:
        return kpis
    
    if verbose and previous_quarter_kpis:
        print(f'\n📊 Updating frequencies from previous quarter ({len(previous_quarter_kpis)} KPIs)...')
    
    previous_kpi_map = {}
    if previous_quarter_kpis:
        for prev_kpi in previous_quarter_kpis:
            kpi_name = prev_kpi.get('name', '')
            if kpi_name:
                previous_kpi_map[kpi_name] = prev_kpi
    
    updated_kpis = []
    new_kpi_count = 0
    
    for kpi in kpis:
        kpi_name = kpi.get('name', '')
        if not kpi_name:
            updated_kpis.append(kpi)
            continue
        
        if kpi_name in previous_kpi_map:
            matched_prev_kpi = previous_kpi_map[kpi_name]
            previous_frequency = matched_prev_kpi.get('frequency', 1)
            kpi['frequency'] = previous_frequency + 1
            
            prev_other_names = set(matched_prev_kpi.get('other_names', []))
            current_other_names = set(kpi.get('other_names', []))
            merged_other_names = sorted(list(prev_other_names | current_other_names))
            if merged_other_names:
                kpi['other_names'] = merged_other_names
        else:
            kpi['frequency'] = 1
            if verbose:
                print(f'  🆕 New KPI: "{kpi_name}" (first occurrence)')
            new_kpi_count += 1
        
        updated_kpis.append(kpi)
    
    if verbose:
        existing_count = len(kpis) - new_kpi_count
        print(f'   ✅ Updated frequencies: {new_kpi_count} new KPIs, {existing_count} existing KPIs')
    
    return updated_kpis


def unify_kpis_with_llm(
    previous_quarter_kpis: List[Dict[str, Any]],
    current_quarter_kpis: List[Dict[str, Any]],
    previous_quarter_key: str,
    current_quarter_key: str,
    verbose: bool = False
) -> Optional[List[Dict[str, Any]]]:
    """Use LLM to unify/match KPIs between quarters
    
    Returns:
        List of unification results with result types: normalize, missing, match, new
    """
    try:
        # Format KPIs for prompt
        def format_kpis_for_prompt(kpis: List[Dict[str, Any]]) -> str:
            formatted = []
            for kpi in kpis:
                name = kpi.get('name', 'Unknown')
                value = kpi.get('value', 'N/A')
                unit = kpi.get('unit', '')
                group = kpi.get('group', 'N/A')
                formatted.append(f"- {name}: {value} {unit} (Group: {group})")
            return '\n'.join(formatted) if formatted else "None"
        
        prev_kpis_str = format_kpis_for_prompt(previous_quarter_kpis)
        current_kpis_str = format_kpis_for_prompt(current_quarter_kpis)
        
        # Load schema and clean it
        unification_schema_raw = load_json_schema('kpi_unification_schema.json', SCHEMAS_DIR)
        unification_schema = clean_schema_for_gemini(unification_schema_raw)
        
        # Create array schema
        array_schema = {
            "type": "array",
            "items": unification_schema
        }
        
        # Load and render prompt
        prompt = load_prompt_template(
            'kpi_unification_prompt.txt',
            prompts_dir=PROMPTS_DIR,
            previous_quarter_key=previous_quarter_key,
            current_quarter_key=current_quarter_key,
            previous_quarter_kpis=prev_kpis_str,
            current_quarter_kpis=current_kpis_str
        )
        
        # Initialize Gemini
        gemini_api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_AI_API_KEY')
        if not gemini_api_key:
            print('Error: GEMINI_API_KEY or GOOGLE_AI_API_KEY not set')
            return None
        
        genai.configure(api_key=gemini_api_key)
        model_name = get_gemini_model()
        model = genai.GenerativeModel(model_name)
        
        if verbose:
            print(f'\n🔄 Unifying KPIs between {previous_quarter_key} and {current_quarter_key}...')
        
        # Generate with structured output
        response = model.generate_content(
            prompt,
            generation_config={
                'temperature': 0.2,
                'max_output_tokens': 8192,
                'response_mime_type': 'application/json',
                'response_schema': array_schema
            }
        )
        
        # Parse JSON response
        try:
            json_text = extract_json_from_llm_response(response.text)
            unification_results = json.loads(json_text)
            
            if verbose:
                print(f'   ✅ Got {len(unification_results)} unification result(s)')
            
            return unification_results
        except json.JSONDecodeError as e:
            print(f'\n❌ JSON parsing error in unification: {e}')
            if verbose:
                print(f'Response: {response.text[:500]}')
            return None
        
    except Exception as e:
        print(f'Error unifying KPIs: {e}')
        if verbose:
            import traceback
            traceback.print_exc()
        return None


def process_unification_results(
    unification_results: List[Dict[str, Any]],
    previous_quarter_kpis: List[Dict[str, Any]],
    current_quarter_kpis: List[Dict[str, Any]],
    pdf_files: List[tuple[bytes, Dict]],
    html_texts: List[tuple[str, Dict]],
    ticker: str,
    quarter_key: str,
    verbose: bool = False
) -> List[Dict[str, Any]]:
    """Process unification results and apply normalizations, handle missing KPIs, etc."""
    if not unification_results:
        return current_quarter_kpis
    
    # Create lookup maps
    prev_kpi_map = {kpi.get('name', ''): kpi for kpi in previous_quarter_kpis if kpi.get('name')}
    current_kpi_map = {kpi.get('name', ''): kpi for kpi in current_quarter_kpis if kpi.get('name')}
    
    # Maps for normalizations: name -> canonical name, name -> canonical group
    normalized_names = {}  # old/new name -> target name
    normalized_groups = {}  # name -> target group
    
    if verbose:
        print(f'\n📋 Processing {len(unification_results)} unification result(s)...')
    
    # First pass: collect all normalizations
    for result in unification_results:
        result_type = result.get('result')
        
        if result_type == 'normalize':
            old_name = result.get('old')
            new_name = result.get('new')
            target_name = result.get('target')
            target_group = result.get('target_group')
            
            if target_name:
                if old_name:
                    normalized_names[old_name] = target_name
                if new_name:
                    normalized_names[new_name] = target_name
            if target_group:
                if old_name:
                    normalized_groups[old_name] = target_group
                if new_name:
                    normalized_groups[new_name] = target_group
            
            if verbose:
                print(f'   🔄 Normalize: "{old_name}" + "{new_name}" → "{target_name}" (group: {target_group})')
        
        elif result_type == 'missing':
            old_name = result.get('old')
            if verbose:
                print(f'   ⚠️  Missing: "{old_name}" from previous quarter not found')
        
        elif result_type == 'match':
            old_name = result.get('old')
            new_name = result.get('new')
            # Use the previous quarter's name as canonical
            if old_name and new_name and old_name != new_name:
                normalized_names[new_name] = old_name
            if verbose:
                print(f'   ✅ Match: "{old_name}" = "{new_name}"')
        
        elif result_type == 'new':
            new_name = result.get('new')
            if verbose:
                print(f'   🆕 New: "{new_name}"')
    
    # Apply normalizations to current KPIs
    processed_kpis = []
    for kpi in current_quarter_kpis:
        kpi_name = kpi.get('name', '')
        original_name = kpi_name
        
        # Apply name normalization
        if kpi_name in normalized_names:
            kpi['name'] = normalized_names[kpi_name]
            kpi_name = normalized_names[kpi_name]
        
        # Apply group normalization
        if kpi_name in normalized_groups:
            kpi['group'] = normalized_groups[kpi_name]
        
        # Update other_names to include the original name if it changed
        if original_name != kpi_name:
            other_names = set(kpi.get('other_names', []))
            other_names.add(original_name)
            kpi['other_names'] = sorted(list(other_names))
        
        processed_kpis.append(kpi)
    
    # Handle missing KPIs - could trigger extraction here
    missing_results = [r for r in unification_results if r.get('result') == 'missing']
    if missing_results and verbose:
        print(f'\n⚠️  {len(missing_results)} KPI(s) from previous quarter not found in current quarter')
        for result in missing_results:
            old_name = result.get('old')
            if old_name in prev_kpi_map:
                prev_kpi = prev_kpi_map[old_name]
                print(f'   - "{old_name}" (was: {prev_kpi.get("value", "N/A")} {prev_kpi.get("unit", "")})')
        # TODO: Could add targeted extraction here similar to extract_missing_kpis
    
    return processed_kpis


def process_kpis_with_previous_quarter(
    kpis: List[Dict[str, Any]],
    previous_quarter_kpis: Optional[List[Dict[str, Any]]],
    verbose: bool = False
) -> List[Dict[str, Any]]:
    """Process KPIs: normalize names, update frequencies, and ensure unit consistency"""
    if not kpis:
        return kpis
    
    kpis = normalize_kpi_names(kpis, previous_quarter_kpis, verbose)
    kpis = update_kpi_frequencies_from_previous_quarter(kpis, previous_quarter_kpis, verbose)
    
    return kpis


def extract_kpis(
    ticker: str,
    quarter_key: str,
    pdf_files: List[tuple[bytes, Dict]],
    html_texts: List[tuple[str, Dict]],
    verbose: bool = False,
    previous_quarter_data: Optional[Dict[str, Any]] = None
) -> Optional[List[Dict[str, Any]]]:
    """Extract custom KPIs from IR documents using structured output"""
    try:
        # Load KPI schema and clean it for Gemini compatibility
        kpi_schema_raw = load_json_schema('kpi_schema.json', SCHEMAS_DIR)
        kpi_schema = clean_schema_for_gemini(kpi_schema_raw)
        
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
                if unit:
                    name_with_unit = f"{name} ({unit})"
                else:
                    name_with_unit = name
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
        
        # Load KPI example document
        kpi_example_document = load_example_document('kpi_example.md', SCRIPT_DIR)
        
        # Load and render prompt template
        prompt = load_prompt_template(
            'kpi_extraction_prompt.txt',
            prompts_dir=PROMPTS_DIR,
            ticker=ticker,
            quarter_key=quarter_key,
            kpi_example_document=kpi_example_document,
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
                'max_output_tokens': 65536,
                'response_mime_type': 'application/json',
                'response_schema': array_schema
            }
        )
        
        # Parse JSON response
        try:
            json_text = extract_json_from_llm_response(response.text)
            kpis = json.loads(json_text)
        except json.JSONDecodeError as e:
            print(f'\n❌ JSON parsing error: {e}')
            print(f'\n{"="*80}')
            print('FULL RESPONSE TEXT:')
            print(f'{"="*80}')
            print(response.text)
            print(f'{"="*80}\n')
            
            # Try to fix common JSON issues
            try:
                fixed_json = re.sub(r',(\s*[}\]])', r'\1', json_text)
                kpis = json.loads(fixed_json)
                print('✅ Fixed JSON by removing trailing commas')
            except Exception as fix_error:
                raise ValueError(f"Failed to parse JSON response: {e}\nFix attempt also failed: {fix_error}")
        
        if verbose:
            print(f'✅ Extracted {len(kpis)} KPIs')
        
        return kpis
        
    except Exception as e:
        print(f'Error extracting KPIs: {e}')
        if verbose:
            import traceback
            traceback.print_exc()
        return None


def main():
    parser = argparse.ArgumentParser(
        description='Extract custom KPIs from quarterly investor relations documents (simplified)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Extract KPIs for a specific quarter
  python extract_kpis2.py AAPL 2025Q1
  
  # Extract with verbose output
  python extract_kpis2.py AAPL 2025Q1 --verbose
  
  # Extract only from earnings releases
  python extract_kpis2.py AAPL 2025Q1 --document-type earnings_release
  
  # Extract without storing (for testing)
  python extract_kpis2.py AAPL 2025Q1 --no-store
        '''
    )
    
    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT)')
    parser.add_argument('quarter', help='Quarter in format YYYYQN (e.g., 2025Q1)')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose output')
    parser.add_argument('--no-store', action='store_true', help='Extract KPIs without storing to Firebase')
    parser.add_argument('--document-type', help='Filter documents by type (e.g., earnings_release, presentation, sec_filing_10k, sec_filing_10q, sec_filing_8k, annual_report, proxy_statement, other)')
    
    args = parser.parse_args()
    
    try:
        firebase = FirebaseCache()
        
        # Validate quarter format
        import re
        if not re.match(r'^\d{4}Q[1-4]$', args.quarter):
            print(f'Error: Invalid quarter format. Use YYYYQN (e.g., 2025Q1)')
            sys.exit(1)
        
        if args.verbose:
            doc_type_msg = f' (filtered to {args.document_type} documents)' if args.document_type else ''
            print(f'Extracting KPIs for {args.ticker} {args.quarter}{doc_type_msg}...')
        
        # Prepare documents
        pdf_files, html_texts, documents = prepare_documents_for_llm(
            args.ticker.upper(), 
            args.quarter, 
            args.verbose,
            args.document_type
        )
        
        if not pdf_files and not html_texts:
            print(f'No documents available for KPI extraction')
            sys.exit(1)
        
        # Get previous quarter data if available
        previous_quarter_data = None
        prev_quarter_key = get_previous_quarter_key(args.quarter)
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
        
        if not kpis:
            print(f'Failed to extract KPIs for {args.ticker} {args.quarter}')
            sys.exit(1)
        
        # Unify KPIs with previous quarter using LLM
        previous_quarter_kpis = previous_quarter_data.get('custom_kpis', []) if previous_quarter_data else None
        if previous_quarter_kpis:
            unification_results = unify_kpis_with_llm(
                previous_quarter_kpis,
                kpis,
                prev_quarter_key,
                args.quarter,
                args.verbose
            )
            
            if unification_results:
                kpis = process_unification_results(
                    unification_results,
                    previous_quarter_kpis,
                    kpis,
                    pdf_files,
                    html_texts,
                    args.ticker.upper(),
                    args.quarter,
                    args.verbose
                )
        
        # Normalize names, update frequencies, and ensure unit consistency
        kpis = process_kpis_with_previous_quarter(
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
