#!/usr/bin/env python3
"""
Generate Quarterly Text Analysis

Reads all IR documents for a quarter and generates a detailed raw text analysis
using LLM. The analysis is stored in Firebase Storage as a text file.
"""

import os
import json
import argparse
import sys
import base64
from pathlib import Path
from typing import Optional, Dict, Any
from dotenv import load_dotenv
import google.generativeai as genai

from services.ir_document_service import IRDocumentService
from services.quarterly_text_analysis_service import QuarterlyTextAnalysisService
from generate_quarterly_summary import (
    prepare_documents_for_llm,
    get_all_quarters_with_documents,
    get_gemini_model,
    clean_schema_for_gemini
)
from document_text_extractor import extract_text_from_html

# Load environment variables from .env.local
load_dotenv('.env.local')

# Get the directory where this script is located
SCRIPT_DIR = Path(__file__).parent
PROMPTS_DIR = SCRIPT_DIR / 'prompts'
SCHEMAS_DIR = SCRIPT_DIR


def load_prompt_template(template_name: str, **kwargs) -> str:
    """Load and render a prompt template file
    
    Args:
        template_name: Name of template file (e.g., 'quarterly_text_analysis_prompt.txt')
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
        schema_name: Name of schema file (e.g., 'quarterly_text_analysis_extraction_schema.json')
        
    Returns:
        Schema as dictionary
    """
    schema_path = SCHEMAS_DIR / schema_name
    if not schema_path.exists():
        raise FileNotFoundError(f"Schema file not found: {schema_path}")
    
    with open(schema_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def print_extracted_data(extracted_data: Dict[str, Any]) -> None:
    """Print extracted structured data in a readable format"""
    print('\n' + '='*80)
    print('EXTRACTED DATA:')
    print('='*80)
    
    # Business Model
    business_model = extracted_data.get('business_model', {})
    print('\n📊 Business Model:')
    print(f'   Summary: {business_model.get("summary", "N/A")}')
    print(f'   Industry: {business_model.get("industry", "N/A")}')
    print(f'   Maturity Level: {business_model.get("maturity_level", "N/A")}')
    
    # Initiatives
    initiatives = extracted_data.get('initiatives', [])
    print(f'\n🚀 Strategic Initiatives ({len(initiatives)}):')
    for i, initiative in enumerate(initiatives, 1):
        print(f'   {i}. {initiative.get("title", "N/A")} [{initiative.get("status", "N/A")}]')
        print(f'      {initiative.get("summary", "N/A")}')
    
    # Changes
    changes = extracted_data.get('changes', [])
    print(f'\n🔄 Changes Since Last Quarter ({len(changes)}):')
    for i, change in enumerate(changes, 1):
        change_type = change.get("type", "N/A")
        change_emoji = {"good": "✅", "bad": "⚠️", "neutral": "ℹ️"}.get(change_type, "•")
        print(f'   {change_emoji} [{change_type.upper()}] {change.get("sentence", "N/A")}')
    
    print('='*80 + '\n')


def extract_json_from_llm_response(response_text: str) -> str:
    """Extract JSON from LLM response (handles markdown code blocks)"""
    if '```json' in response_text:
        return response_text.split('```json')[1].split('```')[0].strip()
    elif '```' in response_text:
        return response_text.split('```')[1].split('```')[0].strip()
    return response_text.strip()


def extract_structured_data(
    ticker: str,
    quarter_key: str,
    analysis_text: str,
    verbose: bool = False
) -> Optional[Dict[str, Any]]:
    """Extract structured data from text analysis using LLM
    
    Args:
        ticker: Stock ticker symbol
        quarter_key: Quarter key in format YYYYQN
        analysis_text: The generated text analysis
        verbose: Enable verbose output
        
    Returns:
        Dictionary with extracted structured data, or None if extraction failed
    """
    try:
        # Initialize Gemini
        gemini_api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_AI_API_KEY')
        if not gemini_api_key:
            print('Error: GEMINI_API_KEY or GOOGLE_AI_API_KEY not set')
            return None
        
        genai.configure(api_key=gemini_api_key)
        model_name = get_gemini_model()
        model = genai.GenerativeModel(model_name)
        
        # Load schema for structured output
        schema = load_json_schema('quarterly_text_analysis_extraction_schema.json')
        cleaned_schema = clean_schema_for_gemini(schema)
        
        # Load and render extraction prompt
        prompt = load_prompt_template(
            'quarterly_text_analysis_extraction_prompt.txt',
            ticker=ticker,
            quarter_key=quarter_key,
            analysis_text=analysis_text
        )
        
        if verbose:
            print('\n' + '='*80)
            print('EXTRACTION PROMPT:')
            print('='*80)
            print(prompt[:2000] + '...' if len(prompt) > 2000 else prompt)
            print('='*80 + '\n')
            print('Calling Gemini API for data extraction...')
        
        # Generate with structured output
        response = model.generate_content(
            prompt,
            generation_config={
                'temperature': 0.2,
                'max_output_tokens': 4000,
                'response_mime_type': 'application/json',
                'response_schema': cleaned_schema
            }
        )
        
        # Parse JSON response
        try:
            extracted_data = json.loads(response.text)
        except json.JSONDecodeError:
            # Try extracting JSON from markdown blocks if needed
            json_text = extract_json_from_llm_response(response.text)
            extracted_data = json.loads(json_text)
        
        return extracted_data
        
    except Exception as e:
        print(f'Error extracting structured data: {e}')
        if verbose:
            import traceback
            traceback.print_exc()
        return None


def generate_quarterly_text_analysis(
    ticker: str,
    quarter_key: str,
    verbose: bool = False
) -> Optional[str]:
    """Generate quarterly text analysis from IR documents
    
    Args:
        ticker: Stock ticker symbol
        quarter_key: Quarter key in format YYYYQN (e.g., "2025Q1")
        verbose: Enable verbose output
        
    Returns:
        Generated text analysis as string, or None if generation failed
    """
    try:
        # Initialize services
        text_analysis_service = QuarterlyTextAnalysisService()
        
        # Get previous quarter analysis if available
        previous_quarter_key = text_analysis_service.get_previous_quarter_key(quarter_key)
        previous_quarter_analysis = ""
        has_previous_analysis = False
        
        if previous_quarter_key:
            prev_analysis = text_analysis_service.get_text_analysis(ticker, previous_quarter_key)
            if prev_analysis:
                previous_quarter_analysis = f"\n\nPREVIOUS QUARTER ANALYSIS ({previous_quarter_key}):\n\n{prev_analysis}"
                has_previous_analysis = True
                if verbose:
                    print(f'✅ Loaded previous quarter analysis from {previous_quarter_key} ({len(prev_analysis)} characters)')
            else:
                if verbose:
                    print(f'ℹ️  No previous quarter analysis found for {previous_quarter_key}')
        
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
        
        # Prepare document context summary
        document_context_parts = []
        document_context_parts.append(f"Available documents for {quarter_key}:")
        for i, doc in enumerate(documents, 1):
            doc_title = doc.get('title', 'Unknown')
            doc_type = doc.get('document_type', 'unknown')
            document_context_parts.append(f"  {i}. {doc_title} ({doc_type})")
        
        # Add HTML text content previews
        if html_texts:
            document_context_parts.append("\nText documents:")
            for i, (text, doc_meta) in enumerate(html_texts, 1):
                text_preview = text[:2000] + ('...' if len(text) > 2000 else '')
                document_context_parts.append(
                    f"\nDocument {i}: {doc_meta.get('title', 'Unknown')} ({doc_meta.get('document_type', 'unknown')})\n"
                    f"Text content preview:\n{text_preview}"
                )
        
        document_context = '\n'.join(document_context_parts)
        
        # Load and render prompt template
        prompt = load_prompt_template(
            'quarterly_text_analysis_prompt.txt',
            ticker=ticker,
            quarter_key=quarter_key,
            previous_quarter_analysis=previous_quarter_analysis if previous_quarter_analysis else "No previous quarter analysis available.",
            document_context=document_context
        )
        
        if verbose:
            print('\n' + '='*80)
            print('QUARTERLY TEXT ANALYSIS PROMPT:')
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
            print(f'\nCalling Gemini API for text analysis with {len(pdf_files)} PDF(s) and {len(html_texts)} text document(s)...')
        
        # Generate text analysis (no structured output)
        response = model.generate_content(
            content_parts,
            generation_config={
                'temperature': 0.3,
                'max_output_tokens': 8000  # Higher limit for detailed analysis
            }
        )
        
        # Extract text from response
        analysis_text = response.text
        
        if verbose:
            print(f'✅ Generated text analysis for {ticker} {quarter_key}')
            print(f'   Analysis length: {len(analysis_text)} characters')
        
        # Store to Firebase Storage and Firestore
        download_url = text_analysis_service.store_text_analysis(
            ticker,
            quarter_key,
            analysis_text,
            len(documents),
            has_previous_analysis,
            verbose
        )
        
        # Extract structured data from the analysis
        if verbose:
            print('\nExtracting structured data from analysis...')
        
        extracted_data = extract_structured_data(
            ticker,
            quarter_key,
            analysis_text,
            False  # Don't show verbose extraction prompt
        )
        
        if extracted_data:
            # Store extracted data in Firestore
            text_analysis_service.update_extracted_data(
                ticker,
                quarter_key,
                extracted_data,
                verbose
            )
            
            # Display extracted data in verbose mode
            if verbose:
                print_extracted_data(extracted_data)
                print(f'📥 Download Analysis: {download_url}')
        else:
            print('⚠️  Failed to extract structured data (text analysis still stored)')
            if verbose:
                print(f'📥 Download Analysis: {download_url}')
        
        return analysis_text
        
    except Exception as e:
        print(f'Error generating quarterly text analysis: {e}')
        if verbose:
            import traceback
            traceback.print_exc()
        return None


def main():
    parser = argparse.ArgumentParser(
        description='Generate detailed quarterly text analysis from IR documents',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Generate text analysis for a specific quarter
  python generate_quarterly_text_analysis.py AAPL 2025Q1
  
  # Generate with verbose output
  python generate_quarterly_text_analysis.py AAPL 2025Q1 --verbose
  
  # Process all quarters iteratively
  python generate_quarterly_text_analysis.py AAPL --all-quarters
  
  # Process all quarters starting from a specific quarter
  python generate_quarterly_text_analysis.py AAPL --all-quarters --start-quarter 2024Q1
        '''
    )
    
    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT)')
    parser.add_argument('quarter', nargs='?', help='Quarter in format YYYYQN (e.g., 2025Q1). Required unless --all-quarters is used.')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose output')
    parser.add_argument('--all-quarters', action='store_true', help='Process all quarters iteratively (earliest to latest)')
    parser.add_argument('--start-quarter', help='Start processing from this quarter (only used with --all-quarters)')
    
    args = parser.parse_args()
    
    try:
        if args.all_quarters:
            # Process all quarters iteratively
            all_quarters = get_all_quarters_with_documents(args.ticker.upper())
            
            if not all_quarters:
                print(f'No quarters with documents found for {args.ticker}')
                sys.exit(1)
            
            # Filter to start from specified quarter if provided
            if args.start_quarter:
                import re
                if not re.match(r'^\d{4}Q[1-4]$', args.start_quarter):
                    print(f'Error: Invalid start-quarter format. Use YYYYQN (e.g., 2024Q1)')
                    sys.exit(1)
                try:
                    start_idx = all_quarters.index(args.start_quarter)
                    all_quarters = all_quarters[start_idx:]
                except ValueError:
                    print(f'Warning: Start quarter {args.start_quarter} not found, starting from earliest')
            
            if args.verbose:
                print(f'\n📊 Processing {len(all_quarters)} quarters for {args.ticker}')
                print(f'   Quarters: {", ".join(all_quarters)}')
            
            results = {}
            
            for i, quarter_key in enumerate(all_quarters, 1):
                print(f'\n{"="*80}')
                print(f'Processing Quarter {i}/{len(all_quarters)}: {quarter_key}')
                print(f'{"="*80}')
                
                # Generate text analysis
                analysis_text = generate_quarterly_text_analysis(
                    args.ticker.upper(),
                    quarter_key,
                    args.verbose
                )
                
                if analysis_text:
                    results[quarter_key] = len(analysis_text)
                    print(f'\n✅ Generated and stored text analysis for {quarter_key} ({len(analysis_text)} characters)')
                else:
                    print(f'⚠️  Failed to generate text analysis for {quarter_key}')
            
            print(f'\n{"="*80}')
            print(f'✅ Completed processing {len(results)} quarters')
            print(f'{"="*80}')
            
            # Display summary if verbose
            if args.verbose and results:
                print('\n📊 Summary across all quarters:')
                for quarter_key, char_count in results.items():
                    print(f'  {quarter_key}: {char_count:,} characters')
        
        else:
            # Single quarter processing
            if not args.quarter:
                parser.error('Quarter is required unless --all-quarters is specified')
            
            # Validate quarter format
            import re
            if not re.match(r'^\d{4}Q[1-4]$', args.quarter):
                print(f'Error: Invalid quarter format. Use YYYYQN (e.g., 2025Q1)')
                sys.exit(1)
            
            # Generate text analysis
            analysis_text = generate_quarterly_text_analysis(
                args.ticker.upper(),
                args.quarter,
                args.verbose
            )
            
            if not analysis_text:
                print(f'Failed to generate quarterly text analysis for {args.ticker} {args.quarter}')
                sys.exit(1)
            
            print('\n✅ Quarterly text analysis generated and stored')
    
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

