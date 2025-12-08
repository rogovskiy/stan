#!/usr/bin/env python3
"""
Generate Quarterly KPI Extraction

Extracts custom KPIs (Key Performance Indicators) from quarterly investor relations documents.
Focuses on extracting company-specific metrics that are not in standard financial statements.
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
                kpis_by_group[group].append(kpi.get('name', 'Unknown'))
            
            prev_kpi_summary = "\nPrevious quarter KPIs by group:\n"
            for group, names in kpis_by_group.items():
                prev_kpi_summary += f"  - {group}: {', '.join(names)}\n"
        
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
        
        if verbose:
            print('\n' + '='*80)
            print('KPI EXTRACTION PROMPT:')
            print('='*80)
            print(prompt[:2000] + '...' if len(prompt) > 2000 else prompt)
            print('='*80 + '\n')
        
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
  python generate_quarterly_analysis.py AAPL 2025Q1
  
  # Extract with verbose output
  python generate_quarterly_analysis.py AAPL 2025Q1 --verbose
  
  # Extract without storing (for testing)
  python generate_quarterly_analysis.py AAPL 2025Q1 --no-store
  
  # Extract KPIs for all quarters starting from 2022Q1
  python generate_quarterly_analysis.py AAPL --all-quarters --start-quarter 2022Q1
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
