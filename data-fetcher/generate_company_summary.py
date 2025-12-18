#!/usr/bin/env python3
"""
Generate Company Summary

Uses LLM to generate company summary, business model, and competitive moat
based on public knowledge. No document parsing required for Phase 1.
"""

import os
import json
import argparse
import sys
from datetime import datetime
from typing import Dict, Optional, Any
from dotenv import load_dotenv
import google.generativeai as genai
import yfinance as yf

from services.company_summary_service import CompanySummaryService

# Load environment variables from .env.local
load_dotenv('.env.local')


def get_gemini_model() -> str:
    """Get Gemini model from env var or return default"""
    return os.getenv('GEMINI_MODEL', 'gemini-2.0-flash')


def extract_json_from_llm_response(response_text: str) -> str:
    """Extract JSON from LLM response (handles markdown code blocks)"""
    if '```json' in response_text:
        return response_text.split('```json')[1].split('```')[0].strip()
    elif '```' in response_text:
        return response_text.split('```')[1].split('```')[0].strip()
    return response_text.strip()


def get_company_name(ticker: str, verbose: bool = False) -> str:
    """Get company name from ticker using yfinance
    
    Args:
        ticker: Stock ticker symbol
        verbose: Enable verbose output
        
    Returns:
        Company name, or ticker if lookup fails
    """
    try:
        stock = yf.Ticker(ticker)
        info = stock.info
        
        # Try multiple possible fields for company name
        company_name = (
            info.get('longName') or 
            info.get('shortName') or 
            info.get('name') or
            ticker
        )
        
        if verbose and company_name != ticker:
            print(f'Found company name: {company_name}')
        
        return company_name
    except Exception as e:
        if verbose:
            print(f'Warning: Could not fetch company name from yfinance: {e}')
        return ticker


def generate_company_summary(ticker: str, verbose: bool = False) -> Optional[Dict[str, Any]]:
    """Generate company summary using LLM's public knowledge
    
    Args:
        ticker: Stock ticker symbol
        verbose: Enable verbose output
        
    Returns:
        Dictionary with summary, business_model, and competitive_moat
    """
    try:
        # Get actual company name to avoid confusion
        company_name = get_company_name(ticker, verbose)
        
        # Initialize Gemini API
        gemini_api_key = os.getenv('GEMINI_API_KEY')
        if not gemini_api_key:
            print('Error: GEMINI_API_KEY not set')
            return None
        
        genai.configure(api_key=gemini_api_key)
        model_name = get_gemini_model()
        
        if verbose:
            print(f'Generating company summary for {ticker} ({company_name}) using {model_name}...')
        
        # Prepare prompt for Gemini - include both ticker and company name for clarity
        system_instruction = "You are a financial analyst providing structured company analysis. Return only valid JSON."
        prompt = f"""You are a financial analyst providing a comprehensive overview of {ticker} ({company_name}).

Based on your knowledge of this company, provide a structured analysis in JSON format with the following fields:

1. **summary**: A concise 2-3 sentences paragraph overview of the company, including what it does, its main products/services, and its position in the market.

2. **business_model**: A 2-3 paragraph description of how the company makes money, its revenue streams, and key business segments.

3. **competitive_moat**: A 2-3 paragraph analysis of the company's competitive advantages, barriers to entry, and what makes it defensible against competitors.

Return ONLY valid JSON in this exact structure:
{{
  "summary": "2-3 sentences company overview...",
  "business_model": "2-3 paragraph description of revenue model...",
  "competitive_moat": "2-3 paragraph analysis of competitive advantages..."
}}

Do not include any markdown formatting or explanatory text outside the JSON."""
        
        full_prompt = f"{system_instruction}\n\n{prompt}"
        
        if verbose:
            print('\n' + '='*80)
            print('PROMPT SENT TO GEMINI:')
            print('='*80)
            print(prompt)
            print('='*80 + '\n')
        
        # Configure and call Gemini
        generation_config = genai.types.GenerationConfig(
            temperature=0.3,
            max_output_tokens=2000,
        )
        
        model = genai.GenerativeModel(model_name)
        response = model.generate_content(
            full_prompt,
            generation_config=generation_config
        )
        
        # Extract text from response
        try:
            result_text = response.text.strip()
        except (ValueError, AttributeError) as text_error:
            # Response might be blocked or have no text
            if verbose:
                print(f'Warning: Could not extract text from Gemini response: {text_error}')
                if hasattr(response, 'prompt_feedback') and response.prompt_feedback:
                    print(f'Prompt feedback: {response.prompt_feedback}')
            return None
        
        if verbose:
            print('='*80)
            print('LLM RESPONSE:')
            print('='*80)
            print(result_text)
            print('='*80 + '\n')
        
        # Extract JSON from response
        result_text = extract_json_from_llm_response(result_text)
        summary_data = json.loads(result_text)
        
        # Add metadata
        summary_data['ticker'] = ticker.upper()
        summary_data['last_updated'] = datetime.now().isoformat()
        summary_data['source'] = 'llm_public_knowledge'
        
        if verbose:
            print(f'✅ Generated company summary for {ticker}')
        
        return summary_data
        
    except json.JSONDecodeError as e:
        print(f'Error parsing Gemini response: {e}')
        if verbose:
            response_preview = result_text[:500] if 'result_text' in locals() else "N/A"
            print(f'Response: {response_preview}')
        return None
    except Exception as e:
        print(f'Error generating company summary for {ticker}: {e}')
        if verbose:
            import traceback
            traceback.print_exc()
        return None


def main():
    parser = argparse.ArgumentParser(
        description='Generate company summary using LLM public knowledge',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Generate and store company summary
  python generate_company_summary.py AAPL
  
  # Generate with verbose output
  python generate_company_summary.py AAPL --verbose
        '''
    )
    
    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT)')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose output')
    parser.add_argument('--no-store', action='store_true', help='Generate summary without storing to Firebase')
    
    args = parser.parse_args()
    
    try:
        # Generate summary
        summary_data = generate_company_summary(args.ticker.upper(), args.verbose)
        
        if not summary_data:
            print(f'Failed to generate company summary for {args.ticker}')
            sys.exit(1)
        
        # Store to Firebase unless --no-store is specified
        if not args.no_store:
            company_summary_service = CompanySummaryService()
            company_summary_service.store_company_summary(args.ticker.upper(), summary_data)
            print(f'\n✅ Company summary stored for {args.ticker}')
        else:
            print('\n✅ Company summary generated (not stored):')
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

