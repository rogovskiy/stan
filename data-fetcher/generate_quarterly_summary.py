#!/usr/bin/env python3
"""
Generate Quarterly Summary

Reads all IR documents for a quarter and generates:
- Summary paragraph with bullet points
- Growth theses
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

from services.ir_document_service import IRDocumentService
from services.quarterly_analysis_service import QuarterlyAnalysisService
from extraction_utils import (
    load_prompt_template,
    load_json_schema,
    get_gemini_model,
    extract_json_from_llm_response,
    clean_schema_for_gemini
)
from document_text_extractor import extract_text_from_html
from pathlib import Path

# Load environment variables from .env.local
load_dotenv('.env.local')


def prepare_documents_for_llm(ticker: str, quarter_key: str, verbose: bool = False) -> tuple[List[tuple[bytes, Dict]], List[tuple[str, Dict]], List[Dict]]:
    """Prepare documents for LLM processing - shared utility
    
    Args:
        ticker: Stock ticker symbol
        quarter_key: Quarter key in format YYYYQN
        verbose: Enable verbose output
        
    Returns:
        Tuple of (pdf_files, html_texts, documents)
    """
    ir_doc_service = IRDocumentService()
    documents = ir_doc_service.get_ir_documents_for_quarter(ticker, quarter_key)
    
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
        
        doc_content = ir_doc_service.get_ir_document_content(ticker, doc_id)
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


def print_kpi_summary_table(quarter_key: str, kpis: List[Dict[str, Any]], verbose: bool = False) -> None:
    """Print a summary table of KPIs for a quarter
    
    Args:
        quarter_key: Quarter identifier
        kpis: List of KPI dictionaries
        verbose: If True, show more details
    """
    if not kpis:
        if verbose:
            print(f'\n  ⚠️  No KPIs available for {quarter_key}')
        return
    
    # Group KPIs by group
    kpis_by_group = {}
    for kpi in kpis:
        group = kpi.get('group', 'Other')
        if group not in kpis_by_group:
            kpis_by_group[group] = []
        kpis_by_group[group].append(kpi)
    
    print(f'\n  📊 KPIs for {quarter_key}:')
    print(f'  {"="*76}')
    
    for group, group_kpis in sorted(kpis_by_group.items()):
        print(f'\n  {group}:')
        print(f'  {"-"*76}')
        
        # Print table header
        if verbose:
            print(f'  {"Name":<35} {"Value":<15} {"Frequency":<10} {"Change":<15}')
        else:
            print(f'  {"Name":<40} {"Value":<20} {"Frequency":<10}')
        
        print(f'  {"-"*76}')
        
        # Print each KPI
        for kpi in sorted(group_kpis, key=lambda x: x.get('name', '')):
            name = kpi.get('name', 'N/A')
            value = kpi.get('value', 'N/A')
            unit = kpi.get('unit', '')
            frequency = kpi.get('frequency', 1)
            change = kpi.get('change', '')
            change_type = kpi.get('change_type', '')
            
            # Format value with unit
            value_str = f"{value} {unit}".strip() if value != 'N/A' else 'N/A'
            
            # Format change
            if change and verbose:
                change_str = f"{change} ({change_type})" if change_type else str(change)
            else:
                change_str = ""
            
            # Truncate name if too long
            display_name = name[:35] if len(name) > 35 else name
            
            if verbose:
                print(f'  {display_name:<35} {value_str:<15} {frequency:<10} {change_str:<15}')
            else:
                print(f'  {display_name:<40} {value_str:<20} {frequency:<10}')
    
    print(f'  {"="*76}')
    print(f'  Total: {len(kpis)} KPIs across {len(kpis_by_group)} groups\n')


def get_all_quarters_with_documents(ticker: str) -> List[str]:
    """Get all quarters that have IR documents, sorted chronologically - shared utility
    
    Args:
        ticker: Stock ticker symbol
        
    Returns:
        List of quarter keys sorted chronologically (earliest first)
    """
    try:
        ir_doc_service = IRDocumentService()
        upper_ticker = ticker.upper()
        
        # Get all IR documents
        docs_ref = (ir_doc_service.db.collection('tickers')
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


def generate_quarterly_summary(
    ticker: str,
    quarter_key: str,
    verbose: bool = False,
    previous_quarter_data: Optional[Dict[str, Any]] = None,
    extracted_kpis: Optional[List[Dict[str, Any]]] = None
) -> Optional[Dict[str, Any]]:
    """Generate quarterly summary and growth theses from IR documents
    
    Args:
        ticker: Stock ticker symbol
        quarter_key: Quarter key in format YYYYQN (e.g., "2025Q1")
        verbose: Enable verbose output
        previous_quarter_data: Optional data from previous quarter for context
        extracted_kpis: Optional list of extracted KPIs to include in context
        
    Returns:
        Dictionary with summary and growth_theses
    """
    try:
        # Prepare documents
        pdf_files, html_texts, documents = prepare_documents_for_llm(ticker, quarter_key, verbose)
        
        if not pdf_files and not html_texts:
            print(f'No documents available for {ticker} {quarter_key}')
            return None
        
        # Initialize Gemini
        gemini_api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_AI_API_KEY')
        if not gemini_api_key:
            print('Error: GEMINI_API_KEY or GOOGLE_AI_API_KEY not set')
            return None
        
        genai.configure(api_key=gemini_api_key)
        model_name = get_gemini_model()
        model = genai.GenerativeModel(model_name)
        
        # Load schema for structured output
        schema = load_json_schema('quarterly_analysis_schema.json')
        cleaned_schema = clean_schema_for_gemini(schema)
        
        # Prepare context strings for prompt
        previous_quarter_context = ""
        if previous_quarter_data:
            prev_quarter = previous_quarter_data.get('quarter_key', 'previous quarter')
            prev_summary = previous_quarter_data.get('summary', '')
            prev_theses = previous_quarter_data.get('growth_theses', [])
            
            previous_quarter_context = f"""
PREVIOUS QUARTER CONTEXT ({prev_quarter}):
{prev_summary[:500]}...

Previous Quarter Growth Theses:
{chr(10).join([f"  - {t.get('title', 'N/A')}: {t.get('summary', 'N/A')[:100]}" for t in prev_theses[:5]])}

Use this previous quarter context to:
1. Identify changes and trends from the previous quarter
2. Assess execution quality and progress on previous quarter's themes
3. Identify new developments or deteriorating trends
"""
        
        extracted_kpis_context = ""
        if extracted_kpis:
            kpis_by_group = {}
            for kpi in extracted_kpis:
                group = kpi.get('group', 'Other')
                if group not in kpis_by_group:
                    kpis_by_group[group] = []
                kpis_by_group[group].append(kpi.get('name', 'Unknown'))
            
            extracted_kpis_context = "\nExtracted KPIs by group:\n"
            for group, names in kpis_by_group.items():
                extracted_kpis_context += f"  - {group}: {', '.join(names)}\n"
        
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
            'quarterly_analysis_prompt.txt',
            ticker=ticker,
            quarter_key=quarter_key,
            previous_quarter_context=previous_quarter_context,
            extracted_kpis_context=extracted_kpis_context,
            previous_quarter_note=' and the previous quarter context provided above' if previous_quarter_data else '',
            previous_quarter_thesis_note='When previous quarter context is provided, compare with previous theses to identify: new themes, strengthened themes, weakened themes, or unchanged themes.' if previous_quarter_data else ''
        )
        
        if html_context:
            prompt += f"\n\nBelow are additional text documents:\n{html_context}"
        
        if verbose:
            print('\n' + '='*80)
            print('QUARTERLY SUMMARY PROMPT:')
            print('='*80)
            print(prompt[:2000] + '...' if len(prompt) > 2000 else prompt)
            print('='*80 + '\n')
        
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
            print(f'\nCalling Gemini API for quarterly summary with {len(pdf_files)} PDF(s) and {len(html_texts)} text document(s)...')
        
        # Generate with structured output
        response = model.generate_content(
            content_parts,
            generation_config={
                'temperature': 0.3,
                'max_output_tokens': 4000,
                'response_mime_type': 'application/json',
                'response_schema': cleaned_schema
            }
        )
        
        # Parse JSON response
        analysis_data = json.loads(response.text)
        
        # Add metadata
        analysis_data['ticker'] = ticker.upper()
        analysis_data['quarter_key'] = quarter_key
        analysis_data['created_at'] = datetime.now().isoformat()
        analysis_data['source_documents'] = [doc.get('document_id') for doc in documents if doc.get('document_id')]
        analysis_data['num_documents'] = len(documents)
        analysis_data['num_pdfs'] = len(pdf_files)
        analysis_data['num_html'] = len(html_texts)
        
        if verbose:
            print(f'✅ Generated quarterly summary for {ticker} {quarter_key}')
            print(f'   Summary length: {len(analysis_data.get("summary", ""))} characters')
            print(f'   Growth theses: {len(analysis_data.get("growth_theses", []))} points')
        
        return analysis_data
        
    except Exception as e:
        print(f'Error generating quarterly summary: {e}')
        if verbose:
            import traceback
            traceback.print_exc()
        return None


def main():
    parser = argparse.ArgumentParser(
        description='Generate quarterly summary and growth theses from IR documents',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Generate quarterly summary for a specific quarter
  python generate_quarterly_summary.py AAPL 2025Q1
  
  # Generate with verbose output
  python generate_quarterly_summary.py AAPL 2025Q1 --verbose
  
  # Generate without storing (for testing)
  python generate_quarterly_summary.py AAPL 2025Q1 --no-store
  
  # Process all quarters iteratively
  python generate_quarterly_summary.py AAPL --all-quarters
  
  # Process all quarters starting from a specific quarter
  python generate_quarterly_summary.py AAPL --all-quarters --start-quarter 2024Q1
        '''
    )
    
    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT)')
    parser.add_argument('quarter', nargs='?', help='Quarter in format YYYYQN (e.g., 2025Q1). Required unless --all-quarters is used.')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose output')
    parser.add_argument('--no-store', action='store_true', help='Generate summary without storing to Firebase')
    parser.add_argument('--all-quarters', action='store_true', help='Process all quarters iteratively (earliest to latest)')
    parser.add_argument('--start-quarter', help='Start processing from this quarter (only used with --all-quarters)')
    
    args = parser.parse_args()
    
    try:
        ir_doc_service = IRDocumentService()
        quarterly_analysis_service = QuarterlyAnalysisService()
        
        if args.all_quarters:
            # Process all quarters iteratively
            all_quarters = get_all_quarters_with_documents(args.ticker.upper())
            
            if not all_quarters:
                print(f'No quarters with documents found for {args.ticker}')
                sys.exit(1)
            
            # Filter to start from specified quarter if provided
            if args.start_quarter:
                try:
                    import re
                    if not re.match(r'^\d{4}Q[1-4]$', args.start_quarter):
                        print(f'Error: Invalid start-quarter format. Use YYYYQN (e.g., 2024Q1)')
                        sys.exit(1)
                    start_idx = all_quarters.index(args.start_quarter)
                    all_quarters = all_quarters[start_idx:]
                except ValueError:
                    print(f'Warning: Start quarter {args.start_quarter} not found, starting from earliest')
            
            if args.verbose:
                print(f'\n📊 Processing {len(all_quarters)} quarters for {args.ticker}')
                print(f'   Quarters: {", ".join(all_quarters)}')
            
            results = {}
            previous_quarter_data = None
            
            for i, quarter_key in enumerate(all_quarters, 1):
                print(f'\n{"="*80}')
                print(f'Processing Quarter {i}/{len(all_quarters)}: {quarter_key}')
                print(f'{"="*80}')
                
                # Load previous quarter data if not in memory
                if previous_quarter_data is None and i > 1:
                    prev_quarter_idx = i - 2
                    if prev_quarter_idx >= 0:
                        prev_quarter_key = all_quarters[prev_quarter_idx]
                        stored_prev = quarterly_analysis_service.get_quarterly_analysis(args.ticker.upper(), prev_quarter_key)
                        if stored_prev:
                            previous_quarter_data = stored_prev
                            if args.verbose:
                                print(f'   Loaded previous quarter ({prev_quarter_key}) from storage')
                
                # Load extracted KPIs for this quarter if available
                quarter_analysis = quarterly_analysis_service.get_quarterly_analysis(args.ticker.upper(), quarter_key)
                extracted_kpis = quarter_analysis.get('custom_kpis', []) if quarter_analysis else None
                
                # Generate summary
                summary_data = generate_quarterly_summary(
                    args.ticker.upper(),
                    quarter_key,
                    args.verbose,
                    previous_quarter_data,
                    extracted_kpis
                )
                
                if summary_data:
                    # Merge with existing analysis data if any
                    if quarter_analysis:
                        summary_data.update({
                            'custom_kpis': quarter_analysis.get('custom_kpis', []),
                            'kpi_metrics': quarter_analysis.get('kpi_metrics', []),
                            'highlights': quarter_analysis.get('highlights', [])
                        })
                    
                    results[quarter_key] = summary_data
                    previous_quarter_data = summary_data
                    
                    # Display KPI summary table in verbose mode
                    if args.verbose and extracted_kpis:
                        print_kpi_summary_table(quarter_key, extracted_kpis, verbose=True)
                    
                    # Store to Firebase unless --no-store
                    if not args.no_store:
                        try:
                            quarterly_analysis_service.store_quarterly_analysis(args.ticker.upper(), quarter_key, summary_data, args.verbose)
                            print(f'\n✅ Generated and stored summary for {quarter_key}')
                        except Exception as e:
                            print(f'⚠️  Error storing {quarter_key}: {e}')
                    else:
                        print(f'\n✅ Generated summary (not stored)')
                else:
                    print(f'⚠️  Failed to generate summary for {quarter_key}')
            
            print(f'\n{"="*80}')
            print(f'✅ Completed processing {len(results)} quarters')
            print(f'{"="*80}')
            
            # Display summary of all quarters if verbose
            if args.verbose:
                print('\n📊 Summary across all quarters:')
                for quarter_key, summary_data in results.items():
                    kpis = summary_data.get('custom_kpis', [])
                    if kpis:
                        print(f'  {quarter_key}: {len(kpis)} KPIs, '
                              f'{len(summary_data.get("growth_theses", []))} growth theses')
        
        else:
            # Single quarter processing
            if not args.quarter:
                parser.error('Quarter is required unless --all-quarters is specified')
            
            # Validate quarter format
            import re
            if not re.match(r'^\d{4}Q[1-4]$', args.quarter):
                print(f'Error: Invalid quarter format. Use YYYYQN (e.g., 2025Q1)')
                sys.exit(1)
            
            # Load extracted KPIs if available
            quarter_analysis = quarterly_analysis_service.get_quarterly_analysis(args.ticker.upper(), args.quarter)
            extracted_kpis = quarter_analysis.get('custom_kpis', []) if quarter_analysis else None
            
            # Load previous quarter data
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
            
            previous_quarter_data = None
            prev_analysis = quarterly_analysis_service.get_quarterly_analysis(args.ticker.upper(), prev_quarter_key)
            if prev_analysis:
                previous_quarter_data = prev_analysis
            
            # Generate summary
            summary_data = generate_quarterly_summary(
                args.ticker.upper(),
                args.quarter,
                args.verbose,
                previous_quarter_data,
                extracted_kpis
            )
            
            if not summary_data:
                print(f'Failed to generate quarterly summary for {args.ticker} {args.quarter}')
                sys.exit(1)
            
            # Merge with existing analysis data if any
            if quarter_analysis:
                summary_data.update({
                    'custom_kpis': quarter_analysis.get('custom_kpis', []),
                    'kpi_metrics': quarter_analysis.get('kpi_metrics', []),
                    'highlights': quarter_analysis.get('highlights', [])
                })
            
            # Display KPI summary table in verbose mode
            if args.verbose and extracted_kpis:
                print_kpi_summary_table(args.quarter, extracted_kpis, verbose=True)
            
            # Store to Firebase unless --no-store
            if not args.no_store:
                quarterly_analysis_service.store_quarterly_analysis(args.ticker.upper(), args.quarter, summary_data, args.verbose)
                print('\n✅ Quarterly summary generated and stored')
                print('\nSummary preview:')
                print('='*80)
                print(f"Summary:\n{summary_data.get('summary', 'N/A')[:500]}...")
                print(f"\nGrowth Theses: {len(summary_data.get('growth_theses', []))} points")
                for i, thesis in enumerate(summary_data.get('growth_theses', [])[:3], 1):
                    print(f"\n{i}. {thesis.get('title', 'N/A')}")
                    print(f"   {thesis.get('summary', 'N/A')}")
            else:
                print('\n✅ Quarterly summary generated (not stored):')
                print(json.dumps(summary_data, indent=2))
    
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


