#!/usr/bin/env python3
"""
Extract Raw KPIs from Quarterly IR Documents

Extracts custom KPIs from quarterly investor relations documents for a single quarter.
Stores raw KPIs (as extracted) without unification. Unification will be done separately later.
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
from raw_kpi_service import RawKPIService
from document_text_extractor import extract_text_from_html
from pathlib import Path
from extraction_utils import (
    get_gemini_model,
    extract_json_from_llm_response,
    load_prompt_template,
    load_json_schema,
    clean_schema_for_gemini,
    load_example_document,
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


def extract_kpis(
    ticker: str,
    quarter_key: str,
    pdf_files: List[tuple[bytes, Dict]],
    html_texts: List[tuple[str, Dict]],
    verbose: bool = False
) -> Optional[List[Dict[str, Any]]]:
    """Extract custom KPIs from IR documents using structured output
    
    Returns raw KPIs as extracted from the documents, without any unification.
    """
    try:
        # Load KPI schema and clean it for Gemini compatibility
        kpi_schema_raw = load_json_schema('kpi_schema.json', SCHEMAS_DIR)
        kpi_schema = clean_schema_for_gemini(kpi_schema_raw)
        
        # Create array schema for response (array of KPIs)
        array_schema = {
            "type": "array",
            "items": kpi_schema
        }
        
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
        
        # Fetch prompt fragments (user-defined prompt) from Firebase before loading template
        firebase = FirebaseCache()
        prompt_fragments = firebase.get_prompt_fragments(ticker)
        user_defined_prompt = ''
        if prompt_fragments:
            if verbose:
                print(f'📝 Including {len(prompt_fragments)} user-defined prompt fragment(s)')
            for fragment in prompt_fragments:
                user_defined_prompt += f"### {fragment.get('title', 'Terminology')}\n"
                user_defined_prompt += f"{fragment.get('content', '')}\n\n"
        
        # Load and render prompt template (without previous quarter context)
        prompt = load_prompt_template(
            'kpi_extraction_prompt.txt',
            prompts_dir=PROMPTS_DIR,
            ticker=ticker,
            quarter_key=quarter_key,
            kpi_example_document=kpi_example_document,
            user_defined_prompt=user_defined_prompt,
            previous_quarter_context='',  # No previous quarter context for raw extraction
            previous_quarter_note='',  # No previous quarter note
            previous_quarter_kpi_step='',  # No previous quarter step
            previous_quarter_segment_note='',  # No previous quarter segment note
            consistency_note=''  # No consistency note
        )
        
        if html_context:
            prompt += f"\n\nBelow are additional text documents:\n{html_context}"
        
        # Print the full prompt in verbose mode
        if verbose:
            print(f'\n{"="*80}')
            print('FULL PROMPT:')
            print(f'{"="*80}')
            print(prompt)
            print(f'{"="*80}\n')
        
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
            print(f'✅ Extracted {len(kpis)} raw KPIs')
            
            # Check for qualifiers
            kpis_with_qualifiers = []
            for kpi in kpis:
                sem = kpi.get('semantic_interpretation', {})
                qualifiers = sem.get('qualifiers', {})
                if qualifiers and isinstance(qualifiers, dict) and len(qualifiers) > 0:
                    kpi_name = kpi.get('name', 'Unknown')
                    qualifiers_str = ', '.join([f"{k}: {v}" for k, v in qualifiers.items()])
                    kpis_with_qualifiers.append((kpi_name, qualifiers_str))
            
            if kpis_with_qualifiers:
                print(f'\n📋 KPIs with qualifiers ({len(kpis_with_qualifiers)}):')
                for kpi_name, qualifiers_str in kpis_with_qualifiers:
                    print(f'   - {kpi_name}: {qualifiers_str}')
            else:
                print(f'   ℹ️  No KPIs with qualifiers found')
        
        return kpis
        
    except Exception as e:
        print(f'Error extracting KPIs: {e}')
        if verbose:
            import traceback
            traceback.print_exc()
        return None


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
        import traceback
        traceback.print_exc()
        return []


def process_single_quarter(
    ticker: str,
    quarter: str,
    verbose: bool,
    document_type: Optional[str],
    no_store: bool
) -> Optional[List[Dict[str, Any]]]:
    """Process a single quarter and return extracted KPIs"""
    if verbose:
        doc_type_msg = f' (filtered to {document_type} documents)' if document_type else ''
        print(f'Extracting raw KPIs for {ticker} {quarter}{doc_type_msg}...')
    
    # Prepare documents
    pdf_files, html_texts, documents = prepare_documents_for_llm(
        ticker, 
        quarter, 
        verbose,
        document_type
    )
    
    if not pdf_files and not html_texts:
        if verbose:
            print(f'⚠️  No documents available for {quarter}, skipping')
        return None
    
    # Extract KPIs (raw extraction, no unification)
    kpis = extract_kpis(
        ticker,
        quarter,
        pdf_files,
        html_texts,
        verbose
    )
    
    if not kpis:
        if verbose:
            print(f'⚠️  Failed to extract KPIs for {ticker} {quarter}')
        return None
    
    # Store raw KPIs to Firebase unless --no-store
    if not no_store:
        try:
            if verbose:
                print(f'\n📝 Storing raw KPIs...')
            
            raw_kpi_service = RawKPIService()
            raw_kpi_service.store_raw_kpis(
                ticker,
                quarter,
                kpis,  # Store full KPI objects as extracted
                [doc.get('document_id') for doc in documents if doc.get('document_id')],
                verbose
            )
            print(f'\n✅ Extracted and stored {len(kpis)} raw KPIs for {ticker} {quarter}')
        except Exception as e:
            print(f'⚠️  Error storing raw KPIs: {e}')
            if verbose:
                import traceback
                traceback.print_exc()
    else:
        print(f'\n✅ Extracted {len(kpis)} raw KPIs (not stored)')
    
    return kpis


def parse_quarters(quarter_str: str) -> List[str]:
    """Parse comma-separated quarters and validate format"""
    import re
    quarters = [q.strip() for q in quarter_str.split(',')]
    
    # Validate each quarter format
    quarter_pattern = re.compile(r'^\d{4}Q[1-4]$')
    for quarter in quarters:
        if not quarter_pattern.match(quarter):
            raise ValueError(f'Invalid quarter format: {quarter}. Use YYYYQN (e.g., 2025Q1)')
    
    return quarters


def main():
    parser = argparse.ArgumentParser(
        description='Extract raw KPIs from quarterly investor relations documents (no unification)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Extract raw KPIs for a specific quarter
  python extract_kpis3.py AAPL 2025Q1
  
  # Extract for multiple quarters (comma-separated)
  python extract_kpis3.py AAPL 2025Q1,2025Q2,2025Q3
  
  # Extract with verbose output
  python extract_kpis3.py AAPL 2025Q1 --verbose
  
  # Extract only from earnings releases
  python extract_kpis3.py AAPL 2025Q1 --document-type earnings_release
  
  # Extract without storing (for testing)
  python extract_kpis3.py AAPL 2025Q1 --no-store
  
  # Extract KPIs for all quarters starting from 2022Q1
  python extract_kpis3.py AAPL --all-quarters --start-quarter 2022Q1
  
  # Extract from all quarters but only earnings releases
  python extract_kpis3.py AAPL --all-quarters --start-quarter 2022Q1 --document-type earnings_release
        '''
    )
    
    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT)')
    parser.add_argument('quarter', nargs='?', help='Quarter(s) in format YYYYQN (e.g., 2025Q1) or comma-separated (e.g., 2025Q1,2025Q2,2025Q3). Can be omitted if using --start-quarter for single quarter.')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose output')
    parser.add_argument('--no-store', action='store_true', help='Extract KPIs without storing to Firebase')
    parser.add_argument('--all-quarters', action='store_true', help='Process all quarters iteratively (earliest to latest)')
    parser.add_argument('--start-quarter', help='Start processing from this quarter. If used without --all-quarters, processes only this single quarter.')
    parser.add_argument('--document-type', help='Filter documents by type (e.g., earnings_release, presentation, sec_filing_10k, sec_filing_10q, sec_filing_8k, annual_report, proxy_statement, other)')
    
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
                print(f'\n📊 Extracting raw KPIs for {len(all_quarters)} quarters starting from {all_quarters[0]}')
                print(f'   Quarters: {", ".join(all_quarters)}')
            
            results = {}
            
            for i, quarter_key in enumerate(all_quarters, 1):
                print(f'\n{"="*80}')
                print(f'Extracting Raw KPIs Quarter {i}/{len(all_quarters)}: {quarter_key}')
                print(f'{"="*80}')
                
                kpis = process_single_quarter(
                    args.ticker.upper(),
                    quarter_key,
                    args.verbose,
                    args.document_type,
                    args.no_store
                )
                
                if kpis:
                    results[quarter_key] = kpis
                else:
                    print(f'⚠️  Failed to extract KPIs for {quarter_key}')
            
            # Summary
            print(f'\n{"="*80}')
            print(f'✅ Completed raw KPI extraction for {len(results)} quarters')
            print(f'{"="*80}')
            for quarter_key, kpis in results.items():
                print(f'{quarter_key}: {len(kpis)} KPIs')
        
        else:
            # Single or multiple quarters KPI extraction
            # Determine which quarter(s) to use: quarter argument, or --start-quarter
            quarter_input = args.quarter or args.start_quarter
            
            if not quarter_input:
                parser.error('Quarter is required. Provide as positional argument or use --start-quarter')
            
            # Parse quarters (handle comma-separated)
            try:
                quarters_to_process = parse_quarters(quarter_input)
            except ValueError as e:
                print(f'Error: {e}')
                sys.exit(1)
            
            # Process multiple quarters
            if len(quarters_to_process) > 1:
                if args.verbose:
                    print(f'\n📊 Extracting raw KPIs for {len(quarters_to_process)} quarters')
                    print(f'   Quarters: {", ".join(quarters_to_process)}')
                
                results = {}
                
                for i, quarter_key in enumerate(quarters_to_process, 1):
                    print(f'\n{"="*80}')
                    print(f'Extracting Raw KPIs Quarter {i}/{len(quarters_to_process)}: {quarter_key}')
                    print(f'{"="*80}')
                    
                    kpis = process_single_quarter(
                        args.ticker.upper(),
                        quarter_key,
                        args.verbose,
                        args.document_type,
                        args.no_store
                    )
                    
                    if kpis:
                        results[quarter_key] = kpis
                    else:
                        print(f'⚠️  Failed to extract KPIs for {quarter_key}')
                
                # Summary
                print(f'\n{"="*80}')
                print(f'✅ Completed raw KPI extraction for {len(results)} quarters')
                print(f'{"="*80}')
                for quarter_key, kpis in results.items():
                    print(f'{quarter_key}: {len(kpis)} KPIs')
            
            else:
                # Single quarter processing
                quarter_to_use = quarters_to_process[0]
                
                kpis = process_single_quarter(
                    args.ticker.upper(),
                    quarter_to_use,
                    args.verbose,
                    args.document_type,
                    args.no_store
                )
                
                if not kpis:
                    print(f'Failed to extract KPIs for {args.ticker} {quarter_to_use}')
                    sys.exit(1)
                
                # Display results
                print(f'\nExtracted Raw KPIs:')
                print('='*80)
                for i, kpi in enumerate(kpis, 1):
                    kpi_name = kpi.get('name', 'N/A')
                    value_obj = kpi.get('value', {})
                    value = value_obj.get('number', 'N/A') if isinstance(value_obj, dict) else kpi.get('value', 'N/A')
                    unit = value_obj.get('unit', '') if isinstance(value_obj, dict) else ''
                    multiplier = value_obj.get('multiplier', '') if isinstance(value_obj, dict) else ''
                    
                    print(f"\n{i}. {kpi_name}")
                    if multiplier:
                        print(f"   Value: {value} {multiplier} {unit}")
                    else:
                        print(f"   Value: {value} {unit}")
                    if kpi.get('summary'):
                        print(f"   Summary: {kpi.get('summary', '')}")
                    if kpi.get('semantic_interpretation'):
                        sem = kpi.get('semantic_interpretation', {})
                        measure = sem.get('measure_kind', 'N/A')
                        subject = sem.get('subject', 'N/A')
                        axis = sem.get('subject_axis', 'N/A')
                        unit_family = sem.get('unit_family', 'N/A')
                        print(f"   Semantic: {measure} | {subject} ({axis}) | {unit_family}")
                        
                        # Show qualifiers if present
                        qualifiers = sem.get('qualifiers', {})
                        if qualifiers and isinstance(qualifiers, dict) and len(qualifiers) > 0:
                            qualifiers_str = ', '.join([f"{k}: {v}" for k, v in qualifiers.items()])
                            print(f"   Qualifiers: {qualifiers_str}")
        
    
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

