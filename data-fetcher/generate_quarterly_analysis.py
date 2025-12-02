#!/usr/bin/env python3
"""
Generate Quarterly Analysis

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

from firebase_cache import FirebaseCache
from document_text_extractor import get_document_text, extract_text_from_html
from io import BytesIO

# Load environment variables from .env.local
load_dotenv('.env.local')


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


def generate_quarterly_analysis(ticker: str, quarter_key: str, verbose: bool = False, extract_custom_kpis: bool = False, previous_quarter_data: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """Generate quarterly analysis from IR documents
    
    Args:
        ticker: Stock ticker symbol
        quarter_key: Quarter key in format YYYYQN (e.g., "2025Q1")
        verbose: Enable verbose output
        extract_custom_kpis: If True, extract custom KPIs not in standard financial statements
        previous_quarter_data: Optional data from previous quarter for context and change detection
        
    Returns:
        Dictionary with summary, growth_theses, and optionally custom_kpis
    """
    try:
        # Get documents for the quarter
        firebase = FirebaseCache()
        documents = firebase.get_ir_documents_for_quarter(ticker, quarter_key)
        
        if not documents:
            print(f'No documents found for {ticker} {quarter_key}')
            return None
        
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
            print(f'No documents remaining after filtering for {ticker} {quarter_key}')
            return None
        
        # Initialize Gemini client
        gemini_api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_AI_API_KEY')
        if not gemini_api_key:
            print('Error: GEMINI_API_KEY or GOOGLE_AI_API_KEY not set')
            return None
        
        genai.configure(api_key=gemini_api_key)
        model_name = get_gemini_model()
        
        if verbose:
            print(f'\nProcessing documents for {model_name}...')
        
        # Separate PDFs and HTML files
        pdf_files = []  # List of (content_bytes, doc_meta) tuples
        html_texts = []  # List of (text, doc_meta) tuples
        
        for doc in documents:
            doc_id = doc.get('document_id')
            if not doc_id:
                continue
            
            # Get document content
            doc_content = firebase.get_ir_document_content(ticker, doc_id)
            if not doc_content:
                if verbose:
                    print(f'  ⚠️  Could not retrieve content for: {doc.get("title", "Unknown")}')
                continue
            
            # Determine file type
            storage_ref = doc.get('document_storage_ref', '')
            is_pdf = storage_ref.endswith('.pdf') or doc_content.startswith(b'%PDF')
            
            if is_pdf:
                # Store PDF content for Gemini (supports PDFs directly)
                if verbose:
                    print(f'  📄 Preparing PDF: {doc.get("title", "Unknown")}')
                
                # Check file size (Gemini limit is 50MB per file, 20MB total request)
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
                # Extract text from HTML
                if verbose:
                    print(f'  📝 Extracting text from HTML: {doc.get("title", "Unknown")}')
                text = extract_text_from_html(doc_content)
                if text:
                    html_texts.append((text[:50000], doc))  # Limit text length
        
        if not pdf_files and not html_texts:
            print(f'Failed to process any documents')
            return None
        
        if verbose:
            print(f'\n✅ Processed {len(pdf_files)} PDF(s) and {len(html_texts)} HTML document(s)')
        
        if verbose:
            print(f'\nGenerating quarterly analysis using {model_name}...')
        
        # Helper function to create the prompt
        def create_prompt(docs_context: str = "") -> str:
            context_part = f"\n\nBelow are additional text documents:\n{docs_context}" if docs_context else ""
            
            # Add previous quarter context if available
            previous_context = ""
            if previous_quarter_data:
                prev_quarter = previous_quarter_data.get('quarter_key', 'previous quarter')
                prev_summary = previous_quarter_data.get('summary', '')
                prev_kpis = previous_quarter_data.get('custom_kpis', [])
                prev_theses = previous_quarter_data.get('growth_theses', [])
                
                prev_kpi_summary = ""
                if prev_kpis:
                    # Group KPIs by group for easier reference
                    kpis_by_group = {}
                    for kpi in prev_kpis:
                        group = kpi.get('group') or 'Other'
                        if group not in kpis_by_group:
                            kpis_by_group[group] = []
                        kpis_by_group[group].append(kpi.get('name', 'Unknown'))
                    
                    prev_kpi_summary = "\nPrevious quarter KPIs by group:\n"
                    for group, names in kpis_by_group.items():
                        prev_kpi_summary += f"  - {group}: {', '.join(names)}\n"
                
                previous_context = f"""

PREVIOUS QUARTER CONTEXT ({prev_quarter}):
{prev_summary[:500]}...

Previous Quarter Growth Theses:
{chr(10).join([f"  - {t.get('title', 'N/A')}: {t.get('summary', 'N/A')[:100]}" for t in prev_theses[:5]])}
{prev_kpi_summary}

Use this previous quarter context to:
1. Identify changes and trends from the previous quarter
2. Maintain consistency in KPI extraction (extract similar KPIs if they exist)
3. Assess execution quality and progress on previous quarter's themes
4. Identify new developments or deteriorating trends
"""
            
            return f"""You are a financial analyst analyzing quarterly investor relations documents for {ticker} for {quarter_key}.{previous_context}{context_part}

Based on the provided documents (PDFs and text){' and the previous quarter context provided above' if previous_quarter_data else ''}, provide a comprehensive quarterly analysis in JSON format with the following structure:

1. **summary**: A paragraph (3-5 sentences) summarizing the quarter's key highlights, followed by bullet points covering:
   - Financial performance (revenue, earnings, margins)
   - Key business metrics and growth drivers
   - Strategic initiatives or major developments
   - Management commentary highlights

2. **growth_theses**: An array of 3-7 investment thesis points explaining why someone would consider investing in this company based on this quarter's results. {'When previous quarter context is provided, compare with previous theses to identify: new themes, strengthened themes, weakened themes, or unchanged themes.' if previous_quarter_data else ''} Each thesis point should have:
   - **title**: Short, compelling title (1 line)
   - **summary**: 1-2 sentence summary suitable for a swipe card
   - **detailed_explanation**: 2-3 sentence detailed explanation with context{' and how it compares to previous quarter if applicable' if previous_quarter_data else ''}
   - **supporting_evidence**: Array of 2-4 specific pieces of evidence from the documents (quotes, metrics, or facts)
   - **strength**: "high", "medium", or "low" indicating conviction level
{f'''
3. **custom_kpis**: An array of ALL custom KPIs (Key Performance Indicators) that are NOT included in standard financial statements. 

CRITICAL: DO NOT include standard financial statement metrics such as:
- Revenue, Total Revenue, Net Revenue (these are standard income statement items)
- Net Income, Operating Income, EBIT, EBITDA (standard income statement items)
- Cash Flow from Operations, Free Cash Flow, Cash and Cash Equivalents (standard cash flow statement items)
- Total Assets, Total Liabilities, Shareholders' Equity, Working Capital (standard balance sheet items)
- EPS (Earnings Per Share), Diluted EPS (standard income statement items)
- Gross Margin, Operating Margin, Net Margin (standard income statement ratios)
- Any other metrics that appear in standard GAAP financial statements

ONLY extract CUSTOM, company-specific metrics that are unique to this business and not found in standard financial statements. These are metrics that management specifically highlights as key performance indicators for their business model.

**EXTRACTION PROCESS - Follow these steps systematically:**

{'Step 0: Review previous quarter KPIs (if provided above) to understand what metrics were tracked. Maintain consistency - if a KPI was tracked in the previous quarter, look for it in this quarter as well. This ensures continuity and allows for trend analysis.' if previous_quarter_data else ''}

Step 1: Scan ALL documents for business segment revenue breakdowns (e.g., iPhone Revenue, Services Revenue, Mac Revenue, iPad Revenue, Wearables Revenue, etc.). Extract each segment as a separate KPI. {'Compare with previous quarter segments to identify new segments or discontinued segments.' if previous_quarter_data else ''}

Step 2: Scan ALL documents for product-level metrics (units sold, ASP, per-product revenue, etc.). Extract each product metric as a separate KPI.

Step 3: Scan ALL documents for geographic/regional revenue breakdowns (Americas Revenue, Europe Revenue, Asia-Pacific Revenue, Greater China Revenue, etc.). Extract each region as a separate KPI.

Step 4: Scan ALL documents for user/subscriber metrics (Active Users, Paid Subscribers, Monthly Active Users, etc.). Extract each metric as a separate KPI.

Step 5: Scan ALL documents for operational metrics (engagement rates, retention, churn, conversion, etc.). Extract each metric as a separate KPI.

Step 6: Scan ALL documents for RSU/compensation metrics (RSU grants, stock-based compensation details, employee headcount, etc.). Extract each metric as a separate KPI.

Step 7: Scan ALL documents for any other custom metrics mentioned in management commentary, presentations, or earnings releases.

**IMPORTANT**: Extract EVERY metric you find in these categories. Do not skip any. If you see a table with 5 business segments, extract all 5. If you see 3 geographic regions, extract all 3. Be thorough and systematic. {'Maintain consistency with previous quarter KPIs - if a metric was tracked before, ensure you extract it again this quarter (even if the value is zero or not mentioned, note that it was not reported).' if previous_quarter_data else ''}

For each KPI found in the documents, extract:
   - **name**: The name of the KPI (e.g., "Monthly Active Users", "Cloud Revenue", "Subscription ARR", "Active Devices", "Paid Subscribers", "iPhone Revenue", "Services Revenue", "Mac Revenue", etc.)
   - **value**: The actual value/measurement for this quarter
   - **unit**: The unit of measurement (e.g., "millions", "percentage", "dollars", "count")
   - **change**: The change from previous quarter or year (if available)
   - **change_type**: "qoq" (quarter-over-quarter), "yoy" (year-over-year), or "sequential"
   - **context**: Brief context about what this KPI measures and why it's important
   - **source**: The document or section where this KPI was found
   - **group**: (Optional) A group name to categorize related KPIs together. Use groups like "Business Segments", "Product Sales", "Regional Revenue", "RSU/Compensation", "User Metrics", "Operational Metrics", "Geographic Breakdown", etc. If a KPI doesn't belong to a group, use null or omit this field.

**VERIFICATION CHECKLIST**: Before finalizing your response, verify you have extracted:
- [ ] All business segment revenues mentioned (check tables, charts, and text)
- [ ] All product-level metrics (units, ASP, revenue per product)
- [ ] All geographic/regional breakdowns
- [ ] All user/subscriber metrics
- [ ] All operational metrics (engagement, retention, churn, etc.)
- [ ] All RSU/compensation metrics
- [ ] Any other custom metrics mentioned

**Grouping Guidelines**:
- Business segment revenues → Group: "Business Segments"
- Product-level metrics → Group: "Product Sales"
- Geographic/regional metrics → Group: "Regional Revenue" or "Geographic Breakdown"
- User/subscriber metrics → Group: "User Metrics"
- Operational metrics → Group: "Operational Metrics"
- RSU/compensation → Group: "RSU/Compensation"
- Other metrics → Use appropriate group or null

**CRITICAL REMINDER**: Extract ALL metrics systematically. If a document mentions 8 business segments, extract all 8. If it mentions 5 geographic regions, extract all 5. Be comprehensive and thorough - do not stop after finding a few examples.
''' if extract_custom_kpis else ''}
Return ONLY valid JSON in this exact structure:
{{
  "summary": "Paragraph summary...\\n\\n• Bullet point 1\\n• Bullet point 2\\n• Bullet point 3",
  "growth_theses": [
    {{
      "title": "Thesis title",
      "summary": "1-2 sentence summary",
      "detailed_explanation": "2-3 sentence detailed explanation",
      "supporting_evidence": ["Evidence 1", "Evidence 2"],
      "strength": "high"
    }}
  ]{f''',
  "custom_kpis": [
    {{
      "name": "KPI Name",
      "value": "actual value",
      "unit": "unit of measurement",
      "change": "change value",
      "change_type": "qoq|yoy|sequential",
      "context": "What this KPI measures",
      "source": "Document or section reference",
      "group": "Business Segments|Product Sales|Regional Revenue|RSU/Compensation|User Metrics|Operational Metrics|Geographic Breakdown|null"
    }}
  ]''' if extract_custom_kpis else ''}
}}

Focus on actionable insights and investment rationale. Be specific with numbers and quotes from the documents.
{f'''CRITICAL FINAL INSTRUCTIONS: 

1. **Systematic Extraction**: Go through each document methodically. For each document:
   - Read all tables and extract every metric row
   - Read all bullet points and extract every metric mentioned
   - Read all charts/graphs and extract every data point
   - Read management commentary and extract every metric referenced

2. **Completeness Check**: After extraction, count:
   - How many business segments were mentioned? Extract ALL of them.
   - How many geographic regions were mentioned? Extract ALL of them.
   - How many product metrics were mentioned? Extract ALL of them.
   - How many user/subscriber metrics were mentioned? Extract ALL of them.

3. **No Skipping**: Do not skip metrics because you think you have "enough". Extract EVERY custom metric you find, regardless of how many there are.

4. **Format Variations**: Extract metrics even if they appear in different formats:
   - "$50.6 billion" or "50.6B" or "$50,600 million"
   - "increased 5%" or "+5%" or "5% growth"
   - "1.2 billion units" or "1.2B units"

5. **Exclusion Reminder**: Only extract CUSTOM metrics. Exclude all standard financial statement metrics (Revenue, Net Income, Cash Flow, Assets, Liabilities, EPS, Margins, etc.).

6. **Target**: Aim to extract 15-30+ custom KPIs if they are present in the documents. Do not stop at 10-12 KPIs - continue extracting until you have captured everything.

Remember: Consistency is key. Extract the same thoroughness every time, regardless of document length or complexity.''' if extract_custom_kpis else ''}"""
        
        # Prepare HTML text context if available
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
        
        # Create the prompt
        prompt = create_prompt(html_context)
        
        if verbose:
            print('\n' + '='*80)
            print('PROMPT SENT TO GEMINI:')
            print('='*80)
            print(prompt[:2000] + '...' if len(prompt) > 2000 else prompt)
            print('='*80 + '\n')
        
        # Prepare content parts for Gemini
        # Gemini supports PDFs directly via inlineData (base64 encoded)
        model = genai.GenerativeModel(model_name)
        
        content_parts = [prompt]
        
        # Add PDF files as inline data (base64 encoded)
        for pdf_content, doc_meta in pdf_files:
            # Encode PDF to base64
            pdf_base64 = base64.b64encode(pdf_content).decode('utf-8')
            content_parts.append({
                'mime_type': 'application/pdf',
                'data': pdf_base64
            })
            if verbose:
                print(f'  📄 Added PDF: {doc_meta.get("title", "Unknown")} ({len(pdf_content) / 1024:.1f}KB)')
        
        # Generate content with Gemini
        try:
            if verbose:
                print(f'\nCalling Gemini API with {len(pdf_files)} PDF(s) and {len(html_texts)} text document(s)...')
            
            response = model.generate_content(
                content_parts,
                generation_config={
                    'temperature': 0.3,
                    'max_output_tokens': 8000 if extract_custom_kpis else 4000,  # More tokens for KPI extraction
                }
            )
            
            result_text = response.text
            
            if verbose:
                print('='*80)
                print('GEMINI RESPONSE:')
                print('='*80)
                print(result_text)
                print('='*80 + '\n')
            
            # Extract JSON from response
            result_text = extract_json_from_llm_response(result_text)
            analysis_data = json.loads(result_text)
            
        except Exception as api_error:
            print(f'Error calling Gemini API: {api_error}')
            if verbose:
                import traceback
                traceback.print_exc()
            
            # Fallback: extract text from PDFs and use text-only
            if pdf_files:
                if verbose:
                    print(f'\n⚠️  Falling back to text extraction for PDFs...')
                
                from document_text_extractor import extract_text_from_pdf
                for pdf_content, doc_meta in pdf_files:
                    text = extract_text_from_pdf(pdf_content)
                    if text:
                        html_texts.append((text[:50000], doc_meta))
                
                # Update context with all text
                html_context_parts = []
                for i, (text, doc_meta) in enumerate(html_texts, 1):
                    text_preview = text[:3000] + ('...' if len(text) > 3000 else '')
                    html_context_parts.append(
                        f"Document {i}: {doc_meta.get('title', 'Unknown')} ({doc_meta.get('document_type', 'unknown')})\n"
                        f"Text content:\n{text_preview}"
                    )
                html_context = '\n\n'.join(html_context_parts)
                prompt = create_prompt(html_context)
                
                # Retry with text-only
                response = model.generate_content(
                    prompt,
                    generation_config={
                        'temperature': 0.3,
                        'max_output_tokens': 8000 if extract_custom_kpis else 4000,  # More tokens for KPI extraction
                    }
                )
                result_text = response.text
                
                if verbose:
                    print('='*80)
                    print('GEMINI RESPONSE (text-only fallback):')
                    print('='*80)
                    print(result_text)
                    print('='*80 + '\n')
                
                result_text = extract_json_from_llm_response(result_text)
                analysis_data = json.loads(result_text)
        
        # Add metadata
        analysis_data['ticker'] = ticker.upper()
        analysis_data['quarter_key'] = quarter_key
        analysis_data['created_at'] = datetime.now().isoformat()
        analysis_data['source_documents'] = [doc.get('document_id') for doc in documents if doc.get('document_id')]
        analysis_data['num_documents'] = len(documents)
        analysis_data['num_pdfs'] = len(pdf_files)
        analysis_data['num_html'] = len(html_texts)
        
        if verbose:
            print(f'✅ Generated quarterly analysis for {ticker} {quarter_key}')
            print(f'   Summary length: {len(analysis_data.get("summary", ""))} characters')
            print(f'   Growth theses: {len(analysis_data.get("growth_theses", []))} points')
            if extract_custom_kpis:
                print(f'   Custom KPIs: {len(analysis_data.get("custom_kpis", []))} metrics')
        
        return analysis_data
        
    except json.JSONDecodeError as e:
        print(f'Error parsing LLM response: {e}')
        if verbose:
            response_preview = result_text[:500] if 'result_text' in locals() else "N/A"
            print(f'Response: {response_preview}')
        return None
    except Exception as e:
        print(f'Error generating quarterly analysis for {ticker} {quarter_key}: {e}')
        if verbose:
            import traceback
            traceback.print_exc()
        return None


def process_all_quarters_iteratively(ticker: str, verbose: bool = False, extract_custom_kpis: bool = False, start_quarter: Optional[str] = None, no_store: bool = False) -> Dict[str, Dict[str, Any]]:
    """Process all quarters iteratively, passing previous quarter data to each analysis
    
    Args:
        ticker: Stock ticker symbol
        verbose: Enable verbose output
        extract_custom_kpis: If True, extract custom KPIs
        start_quarter: Optional quarter to start from (if None, starts from earliest)
        no_store: If True, don't store results to Firebase
        
    Returns:
        Dictionary mapping quarter_key to analysis data
    """
    firebase = FirebaseCache()
    
    # Get all quarters with documents
    all_quarters = get_all_quarters_with_documents(ticker)
    
    if not all_quarters:
        print(f'No quarters with documents found for {ticker}')
        return {}
    
    # Filter to start from specified quarter if provided
    if start_quarter:
        try:
            start_idx = all_quarters.index(start_quarter)
            all_quarters = all_quarters[start_idx:]
        except ValueError:
            print(f'Warning: Start quarter {start_quarter} not found, starting from earliest')
    
    if verbose:
        print(f'\n📊 Processing {len(all_quarters)} quarters iteratively for {ticker}')
        print(f'   Quarters: {", ".join(all_quarters)}')
    
    results = {}
    previous_quarter_data = None
    
    for i, quarter_key in enumerate(all_quarters, 1):
        print(f'\n{"="*80}')
        print(f'Processing Quarter {i}/{len(all_quarters)}: {quarter_key}')
        print(f'{"="*80}')
        
        # Try to load previous quarter data from storage if not in memory
        if previous_quarter_data is None and i > 1:
            prev_quarter_idx = i - 2
            if prev_quarter_idx >= 0:
                prev_quarter_key = all_quarters[prev_quarter_idx]
                stored_prev = firebase.get_quarterly_analysis(ticker.upper(), prev_quarter_key)
                if stored_prev:
                    previous_quarter_data = stored_prev
                    if verbose:
                        print(f'   Loaded previous quarter ({prev_quarter_key}) from storage')
        
        if previous_quarter_data and verbose:
            print(f'   Using previous quarter ({previous_quarter_data.get("quarter_key")}) context')
        
        # Generate analysis with previous quarter context
        analysis_data = generate_quarterly_analysis(
            ticker, 
            quarter_key, 
            verbose, 
            extract_custom_kpis,
            previous_quarter_data
        )
        
        if analysis_data:
            results[quarter_key] = analysis_data
            previous_quarter_data = analysis_data  # Use as context for next quarter
            
            # Store to Firebase unless --no-store is specified
            if not no_store:
                try:
                    firebase.store_quarterly_analysis(ticker.upper(), quarter_key, analysis_data, verbose)
                except Exception as e:
                    print(f'⚠️  Error storing {quarter_key}: {e}')
            
            if verbose:
                print(f'\n✅ Completed {quarter_key}')
                print(f'   Summary length: {len(analysis_data.get("summary", ""))} chars')
                print(f'   Growth theses: {len(analysis_data.get("growth_theses", []))}')
                if extract_custom_kpis:
                    print(f'   Custom KPIs: {len(analysis_data.get("custom_kpis", []))}')
        else:
            print(f'⚠️  Failed to generate analysis for {quarter_key}')
            # Continue with next quarter even if this one failed
    
    return results


def main():
    parser = argparse.ArgumentParser(
        description='Generate quarterly analysis from IR documents',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Generate quarterly analysis for a specific quarter
  python generate_quarterly_analysis.py AAPL 2025Q1
  
  # Generate with verbose output
  python generate_quarterly_analysis.py AAPL 2025Q1 --verbose
  
  # Generate without storing (for testing)
  python generate_quarterly_analysis.py AAPL 2025Q1 --no-store
  
  # Generate with custom KPI extraction
  python generate_quarterly_analysis.py AAPL 2025Q1 --extract-kpis
  
  # Process all quarters iteratively (earliest to latest)
  python generate_quarterly_analysis.py AAPL --all-quarters
  
  # Process all quarters starting from a specific quarter
  python generate_quarterly_analysis.py AAPL --all-quarters --start-quarter 2024Q1
        '''
    )
    
    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT)')
    parser.add_argument('quarter', nargs='?', help='Quarter in format YYYYQN (e.g., 2025Q1). Required unless --all-quarters is used.')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose output')
    parser.add_argument('--no-store', action='store_true', help='Generate analysis without storing to Firebase')
    parser.add_argument('--extract-kpis', action='store_true', dest='extract_custom_kpis', help='Extract custom KPIs not in standard financial statements')
    parser.add_argument('--all-quarters', action='store_true', help='Process all quarters iteratively (earliest to latest)')
    parser.add_argument('--start-quarter', help='Start processing from this quarter (only used with --all-quarters)')
    
    args = parser.parse_args()
    
    try:
        if args.all_quarters:
            # Process all quarters iteratively
            if args.quarter:
                print('Warning: --all-quarters ignores the quarter argument')
            
            results = process_all_quarters_iteratively(
                args.ticker.upper(), 
                args.verbose, 
                args.extract_custom_kpis,
                args.start_quarter,
                args.no_store
            )
            
            if not results:
                print(f'No quarterly analyses generated for {args.ticker}')
                sys.exit(1)
            
            print(f'\n{"="*80}')
            print(f'✅ Completed processing {len(results)} quarters')
            print(f'{"="*80}')
            
            # Store to Firebase unless --no-store is specified
            if not args.no_store:
                firebase = FirebaseCache()
                stored_count = 0
                for quarter_key, analysis_data in results.items():
                    try:
                        firebase.store_quarterly_analysis(args.ticker.upper(), quarter_key, analysis_data, args.verbose)
                        stored_count += 1
                    except Exception as e:
                        print(f'⚠️  Error storing {quarter_key}: {e}')
                
                print(f'\n✅ Stored {stored_count}/{len(results)} quarterly analyses to Firebase')
            
            # Summary
            for quarter_key, analysis_data in results.items():
                print(f'\n{quarter_key}:')
                print(f'  Summary: {len(analysis_data.get("summary", ""))} chars')
                print(f'  Growth theses: {len(analysis_data.get("growth_theses", []))}')
                if args.extract_custom_kpis:
                    print(f'  Custom KPIs: {len(analysis_data.get("custom_kpis", []))}')
            
            if args.no_store:
                print('\n✅ All quarterly analyses generated (not stored)')
                if args.verbose:
                    print(json.dumps(results, indent=2))
        
        else:
            # Single quarter processing
            if not args.quarter:
                parser.error('Quarter is required unless --all-quarters is specified')
            
            # Validate quarter format
            import re
            if not re.match(r'^\d{4}Q[1-4]$', args.quarter):
                print(f'Error: Invalid quarter format. Use YYYYQN (e.g., 2025Q1)')
                sys.exit(1)
            
            # Generate analysis
            analysis_data = generate_quarterly_analysis(args.ticker.upper(), args.quarter, args.verbose, args.extract_custom_kpis)
            
            if not analysis_data:
                print(f'Failed to generate quarterly analysis for {args.ticker} {args.quarter}')
                sys.exit(1)
            
            # Store to Firebase unless --no-store is specified
            if not args.no_store:
                # Store to Firebase
                firebase = FirebaseCache()
                firebase.store_quarterly_analysis(args.ticker.upper(), args.quarter, analysis_data, args.verbose)
                print('\n✅ Quarterly analysis generated and stored')
                print('\nAnalysis preview:')
                print('='*80)
                print(f"Summary:\n{analysis_data.get('summary', 'N/A')[:500]}...")
                print(f"\nGrowth Theses: {len(analysis_data.get('growth_theses', []))} points")
                for i, thesis in enumerate(analysis_data.get('growth_theses', [])[:3], 1):
                    print(f"\n{i}. {thesis.get('title', 'N/A')}")
                    print(f"   {thesis.get('summary', 'N/A')}")
                if args.extract_custom_kpis and analysis_data.get('custom_kpis'):
                    print(f"\nCustom KPIs: {len(analysis_data.get('custom_kpis', []))} metrics")
                    for i, kpi in enumerate(analysis_data.get('custom_kpis', []), 1):
                        print(f"\n{i}. {kpi.get('name', 'N/A')}: {kpi.get('value', 'N/A')} {kpi.get('unit', '')}")
                        if kpi.get('change'):
                            print(f"   Change: {kpi.get('change', 'N/A')} ({kpi.get('change_type', 'N/A')})")
            else:
                print('\n✅ Quarterly analysis generated (not stored):')
                print(json.dumps(analysis_data, indent=2))
    
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


