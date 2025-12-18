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
from kpi_definitions_service import KPIDefinitionsService
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
                # Handle both full KPIs (with 'name') and simplified KPIs (with 'id')
                name = kpi.get('name') or kpi.get('id', 'Unknown')
                
                # Handle both full value objects and simplified values
                if isinstance(kpi.get('value'), dict):
                    value_obj = kpi.get('value', {})
                    value = value_obj.get('number', 'N/A')
                    unit = value_obj.get('unit', '')
                    multiplier = value_obj.get('multiplier')
                    if multiplier:
                        value_str = f"{value} {multiplier}"
                    else:
                        value_str = str(value)
                else:
                    # Simplified format: just a number
                    value = kpi.get('value', 'N/A')
                    value_str = str(value)
                    unit = ''
                
                formatted.append(f"- {name}: {value_str} {unit}")
            return '\n'.join(formatted) if formatted else "None"
        
        prev_kpis_str = format_kpis_for_prompt(previous_quarter_kpis)
        current_kpis_str = format_kpis_for_prompt(current_quarter_kpis)
        
        # Load schema and clean it
        unification_schema_raw = load_json_schema('kpi_unification_schema.json', SCHEMAS_DIR)
        # Schema is already an array, just clean it
        unification_schema = clean_schema_for_gemini(unification_schema_raw)
        
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
                'response_schema': unification_schema
            }
        )
        
        # Check for critical errors that should stop processing
        if response.candidates and len(response.candidates) > 0:
            candidate = response.candidates[0]
            finish_reason = candidate.finish_reason
            
            # Check if response was blocked (no content parts available)
            # finish_reason values: 0=STOP, 1=MAX_TOKENS, 2=SAFETY, 3=RECITATION, 4=OTHER
            has_content = (hasattr(candidate, 'content') and candidate.content and 
                          hasattr(candidate.content, 'parts') and candidate.content.parts)
            
            if finish_reason in [2, 3] or not has_content:
                error_msg = f'\n❌ CRITICAL ERROR: Unification request was blocked (finish_reason: {finish_reason})'
                
                # Map finish_reason to human-readable description
                finish_reason_map = {
                    0: 'STOP (normal completion)',
                    1: 'MAX_TOKENS (hit token limit)',
                    2: 'SAFETY (content blocked for safety)',
                    3: 'RECITATION (content blocked due to recitation)',
                    4: 'OTHER (unknown reason)'
                }
                reason_desc = finish_reason_map.get(finish_reason, f'UNKNOWN ({finish_reason})')
                error_msg += f'\n   Finish reason: {finish_reason} ({reason_desc})'
                
                # Category descriptions for better understanding
                category_descriptions = {
                    'HARM_CATEGORY_HARASSMENT': 'Harassment - content that harasses, intimidates, or bullies',
                    'HARM_CATEGORY_HATE_SPEECH': 'Hate Speech - content that expresses hatred or promotes violence',
                    'HARM_CATEGORY_SEXUALLY_EXPLICIT': 'Sexually Explicit - sexually explicit or pornographic content',
                    'HARM_CATEGORY_DANGEROUS_CONTENT': 'Dangerous Content - content that promotes dangerous activities',
                }
                
                # Show safety ratings if available (always show, not just in verbose)
                if hasattr(candidate, 'safety_ratings') and candidate.safety_ratings:
                    error_msg += '\n\n   Response Safety Ratings (shows which categories triggered the block):'
                    for rating in candidate.safety_ratings:
                        category = getattr(rating, 'category', 'UNKNOWN')
                        probability = getattr(rating, 'probability', 'UNKNOWN')
                        threshold = getattr(rating, 'threshold', 'UNKNOWN')
                        blocked = getattr(rating, 'blocked', False)
                        
                        category_desc = category_descriptions.get(str(category), '')
                        if category_desc:
                            category_desc = f' - {category_desc}'
                        
                        block_indicator = ' ⛔ BLOCKED' if blocked else ''
                        error_msg += f'\n     • {category}{category_desc}'
                        error_msg += f'\n       Probability: {probability}, Threshold: {threshold}{block_indicator}'
                elif finish_reason == 2:
                    error_msg += '\n   (Safety ratings not available, but content was blocked for safety)'
                
                # Show prompt feedback if available
                if hasattr(response, 'prompt_feedback') and response.prompt_feedback:
                    feedback = response.prompt_feedback
                    error_msg += '\n\n   Prompt Feedback (input prompt safety assessment):'
                    if hasattr(feedback, 'block_reason'):
                        error_msg += f'\n     Block reason: {feedback.block_reason}'
                    if hasattr(feedback, 'safety_ratings') and feedback.safety_ratings:
                        error_msg += '\n     Prompt safety ratings:'
                        for rating in feedback.safety_ratings:
                            category = getattr(rating, 'category', 'UNKNOWN')
                            probability = getattr(rating, 'probability', 'UNKNOWN')
                            threshold = getattr(rating, 'threshold', 'UNKNOWN')
                            blocked = getattr(rating, 'blocked', False)
                            
                            category_desc = category_descriptions.get(str(category), '')
                            if category_desc:
                                category_desc = f' - {category_desc}'
                            
                            block_indicator = ' ⛔ BLOCKED' if blocked else ''
                            error_msg += f'\n       • {category}{category_desc}'
                            error_msg += f'\n         Probability: {probability}, Threshold: {threshold}{block_indicator}'
                
                error_msg += '\n\n   This is a critical bug - the API blocked the request and processing cannot continue.'
                error_msg += '\n   Possible causes:'
                error_msg += '\n     • Input data (KPI names/values) triggered safety filters'
                error_msg += '\n     • Prompt content was flagged as unsafe'
                error_msg += '\n     • Model detected potentially harmful content patterns'
                error_msg += '\n   Review the safety ratings above to identify which category caused the block.'
                
                print(error_msg)
                raise ValueError(f"Unification blocked by Gemini API (finish_reason: {finish_reason})")
        
        # Parse JSON response
        try:
            json_text = extract_json_from_llm_response(response.text)
            unification_results = json.loads(json_text)
            
            # Validate that we got an array
            if not isinstance(unification_results, list):
                print(f'\n❌ Unification response is not an array: {type(unification_results)}')
                if verbose:
                    print(f'Response: {response.text[:500]}')
                return None
            
            # Filter out any non-dict items (shouldn't happen, but handle gracefully)
            valid_results = []
            for i, result in enumerate(unification_results):
                if isinstance(result, dict):
                    valid_results.append(result)
                elif verbose:
                    print(f'   ⚠️  Skipping non-dict item at index {i}: {type(result)} - {str(result)[:100]}')
            
            if verbose:
                print(f'   ✅ Got {len(valid_results)} valid unification result(s)')
            
            return valid_results
        except ValueError as e:
            # Re-raise critical errors (like blocked responses)
            raise
        except json.JSONDecodeError as e:
            print(f'\n❌ JSON parsing error in unification: {e}')
            if verbose:
                print(f'Response: {response.text[:500]}')
            return None
        
    except ValueError as e:
        # Critical errors that should stop processing
        raise
    except Exception as e:
        print(f'Error unifying KPIs: {e}')
        if verbose:
            import traceback
            traceback.print_exc()
        return None


def convert_multiplier_value(number: float, from_multiplier: Optional[str], to_multiplier: Optional[str]) -> float:
    """Convert a number from one multiplier to another
    
    Args:
        number: The numeric value to convert
        from_multiplier: Current multiplier ("billion", "million", or None)
        to_multiplier: Target multiplier ("billion", "million", or None)
    
    Returns:
        Converted number value
    """
    # Define multiplier factors
    multiplier_factors = {
        'billion': 1e9,
        'million': 1e6,
        None: 1.0
    }
    
    from_factor = multiplier_factors.get(from_multiplier, 1.0)
    to_factor = multiplier_factors.get(to_multiplier, 1.0)
    
    # Convert to base units, then to target multiplier
    base_value = number * from_factor
    converted_value = base_value / to_factor
    
    return converted_value


def process_unification_results(
    unification_results: List[Dict[str, Any]],
    previous_quarter_kpis: List[Dict[str, Any]],
    current_quarter_kpis: List[Dict[str, Any]],
    pdf_files: List[tuple[bytes, Dict]],
    html_texts: List[tuple[str, Dict]],
    ticker: str,
    quarter_key: str,
    verbose: bool = False
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]], bool]:
    """Process unification results: update KPI definitions and recalculate values
    
    Key principles:
    - KPI IDs are immutable (based on first definition)
    - Only update name and group in definitions
    - Recalculate values when multipliers differ
    - Keep KPI objects updated for return
    
    Returns:
        Tuple of (processed current quarter KPIs, updated previous quarter KPIs, were_previous_updated)
    """
    if not unification_results:
        return current_quarter_kpis, previous_quarter_kpis, False
    
    from kpi_definitions_service import KPIDefinitionsService
    kpi_defs_service = KPIDefinitionsService()
    
    previous_quarter_updated = False
    
    # Create lookup maps by name
    prev_kpi_map = {kpi.get('name', ''): kpi for kpi in previous_quarter_kpis if kpi.get('name')}
    current_kpi_map = {kpi.get('name', ''): kpi for kpi in current_quarter_kpis if kpi.get('name')}
    
    # Track KPI ID mappings (name -> immutable ID)
    # The ID is based on the first name we see for a KPI (previous quarter takes precedence)
    name_to_id_map = {}
    
    def get_or_create_kpi_id(kpi_name: str, prefer_existing: bool = True) -> str:
        """Get or create immutable KPI ID for a name
        
        Args:
            kpi_name: KPI name
            prefer_existing: If True, try to find existing definition first
            
        Returns:
            Immutable KPI ID
        """
        if kpi_name in name_to_id_map:
            return name_to_id_map[kpi_name]
        
        # Try to find existing definition
        if prefer_existing:
            definition = kpi_defs_service.get_kpi_definition(ticker, kpi_name)
            if definition:
                kpi_id = definition.get('id')
                if kpi_id:
                    name_to_id_map[kpi_name] = kpi_id
                    return kpi_id
        
        # Generate new ID from name
        kpi_id = kpi_defs_service._generate_kpi_id(kpi_name)
        name_to_id_map[kpi_name] = kpi_id
        return kpi_id
    
    # Track which KPIs have been processed
    processed_kpi_names = set()
    normalized_count = 0
    missing_count = 0
    new_count = 0
    
    if verbose:
        print(f'\n📋 Processing {len(unification_results)} unification result(s)...')
        # Count result types for debugging
        result_types = {}
        for r in unification_results:
            if isinstance(r, list) and len(r) > 0:
                r = r[0]
            if isinstance(r, dict):
                rt = r.get('result', 'unknown')
                result_types[rt] = result_types.get(rt, 0) + 1
        if result_types:
            type_summary = ', '.join(f'{k}: {v}' for k, v in result_types.items())
            print(f'   Result types: {type_summary}')
    
    # Process each result and apply changes immediately
    for i, result in enumerate(unification_results, 1):
        # Handle case where result might be nested (schema issue)
        original_result = result
        if isinstance(result, list) and len(result) > 0:
            result = result[0]
        if not isinstance(result, dict):
            if verbose:
                print(f'   [{i}] ⚠️  Skipping invalid result: {result}')
            continue
        
        result_type = result.get('result')
        
        # Show what LLM said with appropriate symbol
        if verbose:
            llm_response = {k: v for k, v in result.items() if k != 'result'}
            symbol_map = {
                'normalize': '🔄',
                'match': '✅',
                'missing': '⚠️',
                'new': '🆕'
            }
            symbol = symbol_map.get(result_type, '❓')
            print(f'\n   [{i}] {symbol} LLM said: {result_type.upper()} - {llm_response}')
        
        if result_type == 'normalize':
            previous_name = result.get('previous')
            current_name = result.get('current')
            target_name = result.get('target')
            target_group = result.get('target_group')
            
            if not previous_name or not target_name:
                if verbose:
                    print(f'      ⚠️  Invalid normalize result: missing required fields (previous: {previous_name}, target: {target_name})')
                continue
            
            # Get immutable KPI ID (use previous name as base since it's the first occurrence)
            kpi_id = get_or_create_kpi_id(previous_name, prefer_existing=True)
            
            # Find the current quarter KPI - must exist for normalization
            current_kpi = None
            if current_name and current_name in current_kpi_map:
                current_kpi = current_kpi_map[current_name]
            elif target_name in current_kpi_map:
                # Try target name directly
                current_kpi = current_kpi_map[target_name]
                current_name = target_name
            else:
                # Try to find by searching current KPIs for similar names
                for kpi in current_quarter_kpis:
                    kpi_name = kpi.get('name', '')
                    # Check if it matches target or contains key words
                    if kpi_name == target_name or (target_name and target_name.lower() in kpi_name.lower()):
                        current_kpi = kpi
                        current_name = kpi_name
                        break
            
            if not current_kpi:
                if verbose:
                    # Show what we tried to find
                    tried_names = []
                    if current_name:
                        tried_names.append(f'current_name="{current_name}"')
                    if target_name:
                        tried_names.append(f'target_name="{target_name}"')
                    print(f'      ⚠️  Normalize skipped: "{previous_name}" + {", ".join(tried_names)} → "{target_name}" (current quarter KPI not found - cannot normalize)')
                continue
            
            # Map all names to the same ID
            name_to_id_map[previous_name] = kpi_id
            name_to_id_map[current_name] = kpi_id
            name_to_id_map[target_name] = kpi_id
            
            # Get or create KPI definition (ID is immutable, based on first name)
            definition = kpi_defs_service.get_kpi_definition_by_id(ticker, kpi_id)
            actions_taken = []
            
            if not definition:
                # Create definition from previous quarter KPI if available
                if previous_name in prev_kpi_map:
                    prev_kpi = prev_kpi_map[previous_name]
                    definition_data = {
                        'name': target_name,  # Use target name for new definition
                        'value': {
                            'unit': prev_kpi.get('value', {}).get('unit', ''),
                            'multiplier': prev_kpi.get('value', {}).get('multiplier')
                        },
                        'value_type': prev_kpi.get('value_type', 'quarterly'),
                        'summary': prev_kpi.get('summary', ''),
                        'source': prev_kpi.get('source', ''),
                        'group': target_group or prev_kpi.get('group', ''),
                        'frequency': 0,  # Will be set automatically when first value is written
                        'other_names': [previous_name, current_name] if current_name != target_name else [previous_name]
                    }
                else:
                    # Create from current KPI
                    definition_data = {
                        'name': target_name,
                        'value': {
                            'unit': current_kpi.get('value', {}).get('unit', ''),
                            'multiplier': current_kpi.get('value', {}).get('multiplier')
                        },
                        'value_type': current_kpi.get('value_type', 'quarterly'),
                        'summary': current_kpi.get('summary', ''),
                        'source': current_kpi.get('source', ''),
                        'group': target_group or current_kpi.get('group', ''),
                        'frequency': 0,  # Will be set automatically when first value is written
                        'other_names': [previous_name, current_name] if current_name != target_name else [previous_name]
                    }
                kpi_defs_service.set_kpi_definition(ticker, definition_data, verbose=verbose)
                definition = kpi_defs_service.get_kpi_definition_by_id(ticker, kpi_id)
            else:
                # Definition exists - use targeted updates for name and group only
                original_name = definition.get('name', '')
                original_group = definition.get('group', '')
                updates = {}
                
                if original_name != target_name:
                    updates['name'] = target_name
                    # Merge other_names
                    existing_other_names = set(definition.get('other_names', []))
                    updates['other_names'] = sorted(list(existing_other_names | {previous_name, current_name, original_name}))
                    # Show what was updated: previous → target
                    actions_taken.append(f'Updated definition name: "{previous_name}" → "{target_name}" (ID: {kpi_id})')
                
                if target_group and original_group != target_group:
                    updates['group'] = target_group
                    actions_taken.append(f'Updated definition group: "{original_group}" → "{target_group}"')
                
                # Apply targeted updates if needed
                if updates:
                    # Use the current definition name to find it, then update
                    current_def_name = definition.get('name', original_name)
                    kpi_defs_service.update_kpi_definition(ticker, current_def_name, updates, verbose=verbose)
            
            # Update KPI object for return (keep in sync with definition)
            current_kpi['name'] = target_name
            if target_group:
                current_kpi['group'] = target_group
            
            # Handle multiplier difference and recalculate value
            if previous_name in prev_kpi_map:
                prev_kpi = prev_kpi_map[previous_name]
                
                # Recalculate value if multipliers differ
                prev_value = prev_kpi.get('value', {})
                current_value = current_kpi.get('value', {})
                if isinstance(prev_value, dict) and isinstance(current_value, dict):
                    prev_multiplier = prev_value.get('multiplier')
                    current_multiplier = current_value.get('multiplier')
                    current_number = current_value.get('number')
                    
                    if prev_multiplier != current_multiplier and current_number is not None:
                        # Recalculate value based on multiplier difference
                        converted_number = convert_multiplier_value(
                            current_number,
                            current_multiplier,
                            prev_multiplier
                        )
                        current_kpi['value']['number'] = converted_number
                        current_kpi['value']['multiplier'] = prev_multiplier
                        multiplier_desc = f'"{current_multiplier}"' if current_multiplier else 'null'
                        prev_multiplier_desc = f'"{prev_multiplier}"' if prev_multiplier else 'null'
                        actions_taken.append(f'Recalculated value: {current_number} ({multiplier_desc}) → {converted_number} ({prev_multiplier_desc})')
                    elif prev_multiplier != current_multiplier:
                        # Just update multiplier if no number available
                        current_kpi['value']['multiplier'] = prev_multiplier
                        actions_taken.append(f'Updated multiplier: "{current_multiplier}" → "{prev_multiplier}"')
                
                # Update previous quarter KPI object
                prev_kpi['name'] = target_name
                if target_group:
                    prev_kpi['group'] = target_group
                previous_quarter_updated = True
            
            # Merge other metadata
            if previous_name in prev_kpi_map:
                prev_kpi = prev_kpi_map[previous_name]
                # Merge other_names
                prev_other_names = set(prev_kpi.get('other_names', []))
                current_other_names = set(current_kpi.get('other_names', []))
                current_kpi['other_names'] = sorted(list(prev_other_names | current_other_names | {previous_name, current_name}))
                
                # Normalize unit
                prev_unit = prev_kpi.get('value', {}).get('unit', '')
                current_unit = current_kpi.get('value', {}).get('unit', '')
                if prev_unit and prev_unit != current_unit:
                    current_kpi['value']['unit'] = prev_unit
                    actions_taken.append(f'Updated unit: "{current_unit}" → "{prev_unit}"')
            
            if verbose:
                if actions_taken:
                    for action in actions_taken:
                        print(f'        • {action}')
                else:
                    print(f'      ℹ️  No changes needed (already normalized)')
            
            processed_kpi_names.add(target_name)
        
        elif result_type == 'missing':
            previous_name = result.get('previous')
            missing_count += 1
            if verbose:
                if previous_name:
                    prev_kpi = prev_kpi_map.get(previous_name)
                    prev_info = f' (was: {prev_kpi.get("value", "N/A")} {prev_kpi.get("unit", "")})' if prev_kpi else ''
                    print(f'      ⚠️  Action: Marked as missing - "{previous_name}" from previous quarter not found in current quarter{prev_info}')
                else:
                    print(f'      ⚠️  Action: Marked as missing - KPI from previous quarter not found (name not specified)')
        
        elif result_type == 'match':
            previous_name = result.get('previous')
            current_name = result.get('current')
            
            # If current_name is None, try to find matching KPI in current quarter by name
            if previous_name and not current_name:
                if previous_name in current_kpi_map:
                    current_name = previous_name
            
            # Find and update the current quarter KPI
            if current_name and current_name in current_kpi_map:
                current_kpi = current_kpi_map[current_name]
                actions_taken = []
                
                # Get immutable KPI ID (use previous name as base)
                kpi_id = get_or_create_kpi_id(previous_name or current_name, prefer_existing=True)
                name_to_id_map[previous_name or current_name] = kpi_id
                if current_name:
                    name_to_id_map[current_name] = kpi_id
                
                # Get or create definition
                definition = kpi_defs_service.get_kpi_definition_by_id(ticker, kpi_id)
                if not definition:
                    if previous_name in prev_kpi_map:
                        # Create from previous quarter
                        prev_kpi = prev_kpi_map[previous_name]
                        definition_data = {
                            'name': previous_name,  # Use previous name as canonical
                            'value': {
                                'unit': prev_kpi.get('value', {}).get('unit', ''),
                                'multiplier': prev_kpi.get('value', {}).get('multiplier')
                            },
                            'value_type': prev_kpi.get('value_type', 'quarterly'),
                            'summary': prev_kpi.get('summary', ''),
                            'source': prev_kpi.get('source', ''),
                            'group': prev_kpi.get('group', ''),
                            'frequency': 0,  # Will be set automatically when first value is written
                            'other_names': [current_name] if current_name != previous_name else []
                        }
                        kpi_defs_service.set_kpi_definition(ticker, definition_data, verbose=verbose)
                        definition = kpi_defs_service.get_kpi_definition_by_id(ticker, kpi_id)
                
                # Use previous quarter name as canonical if different
                canonical_name = previous_name or current_name
                if current_name != canonical_name:
                    current_kpi['name'] = canonical_name
                    if definition:
                        # Targeted update: only update name and other_names
                        existing_other_names = set(definition.get('other_names', []))
                        kpi_defs_service.update_kpi_definition(ticker, definition.get('name', ''), {
                            'name': canonical_name,
                            'other_names': sorted(list(existing_other_names | {current_name}))
                        }, verbose=verbose)
                    actions_taken.append(f'Normalized name: "{current_name}" → "{canonical_name}" (ID: {kpi_id})')
                
                if previous_name in prev_kpi_map:
                    prev_kpi = prev_kpi_map[previous_name]
                    
                    # Merge other_names
                    prev_other_names = set(prev_kpi.get('other_names', []))
                    current_other_names = set(current_kpi.get('other_names', []))
                    current_kpi['other_names'] = sorted(list(prev_other_names | current_other_names))
                    
                    # Normalize unit
                    prev_unit = prev_kpi.get('value', {}).get('unit', '')
                    current_unit = current_kpi.get('value', {}).get('unit', '')
                    if prev_unit and prev_unit != current_unit:
                        current_kpi['value']['unit'] = prev_unit
                        actions_taken.append(f'Updated unit: "{current_unit}" → "{prev_unit}"')
                    
                    # Recalculate value if multipliers differ
                    prev_value = prev_kpi.get('value', {})
                    current_value = current_kpi.get('value', {})
                    if isinstance(prev_value, dict) and isinstance(current_value, dict):
                        prev_multiplier = prev_value.get('multiplier')
                        current_multiplier = current_value.get('multiplier')
                        current_number = current_value.get('number')
                        
                        if prev_multiplier != current_multiplier and current_number is not None:
                            # Recalculate value based on multiplier difference
                            converted_number = convert_multiplier_value(
                                current_number,
                                current_multiplier,
                                prev_multiplier
                            )
                            current_kpi['value']['number'] = converted_number
                            current_kpi['value']['multiplier'] = prev_multiplier
                            multiplier_desc = f'"{current_multiplier}"' if current_multiplier else 'null'
                            prev_multiplier_desc = f'"{prev_multiplier}"' if prev_multiplier else 'null'
                            actions_taken.append(f'Recalculated value: {current_number} ({multiplier_desc}) → {converted_number} ({prev_multiplier_desc})')
                        elif prev_multiplier != current_multiplier:
                            current_kpi['value']['multiplier'] = prev_multiplier
                            actions_taken.append(f'Updated multiplier: "{current_multiplier}" → "{prev_multiplier}"')
                
                if verbose:
                    if actions_taken:
                        for action in actions_taken:
                            print(f'      • {action}')
                    else:
                        print(f'      ℹ️  No changes needed (exact match, frequency already updated)')
                
                processed_kpi_names.add(canonical_name)
            elif verbose:
                print(f'      ⚠️  Action: KPI "{current_name or previous_name}" not found in current quarter - no action taken')
        
        elif result_type == 'new':
            # NEW results use "target" and "target_group" fields
            target_name = result.get('target')
            target_group = result.get('target_group')
            
            if not target_name:
                if verbose:
                    print(f'   ⚠️  Invalid "new" result: missing "target" field (required per prompt)')
                continue

            new_count += 1
            # Find the KPI in current quarter by name (try target name first, then search)
            current_kpi = None
            current_name = None
            
            if target_name in current_kpi_map:
                current_kpi = current_kpi_map[target_name]
                current_name = target_name
            else:
                # Try to find by searching current KPIs for similar names
                for kpi in current_quarter_kpis:
                    kpi_name = kpi.get('name', '')
                    if kpi_name == target_name or (target_name and target_name.lower() in kpi_name.lower()):
                        current_kpi = kpi
                        current_name = kpi_name
                        break
            
            if current_kpi:
                # Get or create immutable ID for new KPI
                kpi_id = get_or_create_kpi_id(target_name, prefer_existing=False)
                name_to_id_map[target_name] = kpi_id
                if current_name != target_name:
                    name_to_id_map[current_name] = kpi_id

                # Update KPI name and group to match target
                current_kpi['name'] = target_name
                # Definition will be created when storing, frequency will be set automatically
                if verbose:
                    print(f'      ✅ Action: New KPI "{target_name}" (ID: {kpi_id})')

                processed_kpi_names.add(current_name if current_name else target_name)
            elif verbose:
                print(f'      ⚠️  Action: KPI "{target_name}" not found in current quarter - no action taken')
    
    # Add any KPIs that weren't processed (shouldn't happen, but safety check)
    processed_kpis = []
    for kpi in current_quarter_kpis:
        kpi_name = kpi.get('name', '')
        if kpi_name not in processed_kpi_names:
            # KPI wasn't in unification results - frequency will be set automatically when value is stored
            processed_kpis.append(kpi)
        else:
            processed_kpis.append(kpi)
    
    # Return both current and updated previous quarter KPIs, and flag indicating if previous was updated
    return processed_kpis, previous_quarter_kpis, previous_quarter_updated
    
    if verbose:
        print(f'\n   ✅ Summary: {normalized_count} normalized, {frequency_updated_count} frequencies updated, {new_count} new, {missing_count} missing')
    
    return processed_kpis


def expand_simplified_kpis(simplified_kpis: List[Dict[str, Any]], ticker: str) -> List[Dict[str, Any]]:
    """Expand simplified KPIs (id + value) to full KPI objects using KPI definitions
    
    Args:
        simplified_kpis: List of simplified KPIs with 'id' and 'value' fields
        ticker: Stock ticker symbol
        
    Returns:
        List of full KPI objects
    """
    kpi_defs_service = KPIDefinitionsService()
    expanded_kpis = []
    
    for simplified_kpi in simplified_kpis:
        kpi_id = simplified_kpi.get('id') or simplified_kpi.get('name', '')
        kpi_value = simplified_kpi.get('value')
        
        if not kpi_id:
            continue
        
        # Get KPI definition by ID (kpi_id should be the immutable ID)
        definition = kpi_defs_service.get_kpi_definition_by_id(ticker, kpi_id)
        
        if definition:
            # Expand to full KPI
            full_kpi = {
                'name': definition.get('name', kpi_id),
                'value': {
                    'number': kpi_value,
                    'unit': definition.get('value', {}).get('unit', ''),
                    'multiplier': definition.get('value', {}).get('multiplier')
                },
                'value_type': definition.get('value_type', ''),
                'summary': definition.get('summary', ''),
                'source': definition.get('source', ''),
                'group': definition.get('group', ''),
                'frequency': definition.get('frequency', 1),
                'other_names': definition.get('other_names', [])
            }
            expanded_kpis.append(full_kpi)
        else:
            # If definition not found, try to get it by searching all definitions
            # (in case the ID format changed or there's a mismatch)
            all_definitions = kpi_defs_service.get_all_kpi_definitions(ticker)
            found_definition = None
            for defn in all_definitions:
                if defn.get('id') == kpi_id:
                    found_definition = defn
                    break
            
            if found_definition:
                # Expand using found definition
                full_kpi = {
                    'name': found_definition.get('name', kpi_id),
                    'value': {
                        'number': kpi_value,
                        'unit': found_definition.get('value', {}).get('unit', ''),
                        'multiplier': found_definition.get('value', {}).get('multiplier')
                    },
                    'value_type': found_definition.get('value_type', 'quarterly'),
                    'summary': found_definition.get('summary', ''),
                    'source': found_definition.get('source', ''),
                    'group': found_definition.get('group', ''),
                    'frequency': found_definition.get('frequency', 0),  # Frequency is managed automatically
                    'other_names': found_definition.get('other_names', [])
                }
                expanded_kpis.append(full_kpi)
            else:
                # Definition truly not found - skip this KPI with warning
                print(f'⚠️  Warning: KPI definition not found for ID "{kpi_id}" - skipping from unification')
                continue
    
    return expanded_kpis


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
        previous_kpis_raw = previous_quarter_data.get('custom_kpis', []) if previous_quarter_data else []
        
        # Check if KPIs are in simplified format (id + value) and expand them
        previous_kpis = []
        if previous_kpis_raw:
            # Check if first KPI has 'id' field (simplified format)
            if previous_kpis_raw and isinstance(previous_kpis_raw[0], dict) and 'id' in previous_kpis_raw[0]:
                # Expand simplified KPIs using definitions
                previous_kpis = expand_simplified_kpis(previous_kpis_raw, ticker.upper())
            else:
                # Already in full format
                previous_kpis = previous_kpis_raw
        
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
  
  # Clear all KPI data for a ticker
  python extract_kpis2.py AAPL --clear-all-kpis
        '''
    )
    
    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT)')
    parser.add_argument('quarter', nargs='?', help='Quarter in format YYYYQN (e.g., 2025Q1). Optional if using --clear-all-kpis')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose output')
    parser.add_argument('--no-store', action='store_true', help='Extract KPIs without storing to Firebase')
    parser.add_argument('--document-type', help='Filter documents by type (e.g., earnings_release, presentation, sec_filing_10k, sec_filing_10q, sec_filing_8k, annual_report, proxy_statement, other)')
    parser.add_argument('--clear-all-kpis', action='store_true', help='Clear all KPI data for the ticker (deletes all quarterly_analysis and kpi timeseries)')
    
    args = parser.parse_args()
    
    try:
        firebase = FirebaseCache()
        
        # Handle clear-all-kpis option
        if args.clear_all_kpis:
            kpi_defs_service = KPIDefinitionsService()
            kpi_defs_service.clear_all_kpi_data(args.ticker.upper(), verbose=args.verbose)
            sys.exit(0)
        
        # Validate quarter format (required if not clearing)
        if not args.quarter:
            parser.error('Quarter is required unless using --clear-all-kpis')
        
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
        previous_quarter_kpis_raw = previous_quarter_data.get('custom_kpis', []) if previous_quarter_data else None
        if previous_quarter_kpis_raw:
            # Expand simplified KPIs if needed (they might be in simplified format with 'id' instead of 'name')
            if previous_quarter_kpis_raw and len(previous_quarter_kpis_raw) > 0:
                first_kpi = previous_quarter_kpis_raw[0]
                if isinstance(first_kpi, dict) and 'id' in first_kpi and 'name' not in first_kpi:
                    # Expand simplified KPIs using definitions
                    previous_quarter_kpis = expand_simplified_kpis(previous_quarter_kpis_raw, args.ticker.upper())
                    if args.verbose:
                        print(f'📋 Expanded {len(previous_quarter_kpis_raw)} simplified KPIs to {len(previous_quarter_kpis)} full KPIs for unification')
                else:
                    # Already in full format
                    previous_quarter_kpis = previous_quarter_kpis_raw
            else:
                previous_quarter_kpis = previous_quarter_kpis_raw
            
            try:
                unification_results = unify_kpis_with_llm(
                    previous_quarter_kpis,
                    kpis,
                    prev_quarter_key,
                    args.quarter,
                    args.verbose
                )
            except ValueError as e:
                # Critical errors (like blocked responses) should stop processing
                print(f'\n❌ Fatal error during unification: {e}')
                sys.exit(1)

            if unification_results:
                kpis, updated_previous_quarter_kpis, previous_was_updated = process_unification_results(
                    unification_results,
                    previous_quarter_kpis,
                    kpis,
                    pdf_files,
                    html_texts,
                    args.ticker.upper(),
                    args.quarter,
                    args.verbose
                )
                
                # Note: We don't need to update the previous quarter document
                # - Names are stored in definitions (already updated during normalization)
                # - IDs are immutable and never change
                # - The quarterly analysis document already has the correct IDs
        else:
            # No previous quarter - frequency will be set automatically when values are written
            pass
        
        # Store KPIs to Firebase unless --no-store
        if not args.no_store:
            try:
                # Definitions are already created/updated during unification
                # Only create definitions for new KPIs that don't exist yet
                kpi_defs_service = KPIDefinitionsService()
                if args.verbose:
                    print(f'\n📝 Storing KPI values...')
                
                for kpi in kpis:
                    kpi_name = kpi.get('name', '')
                    if not kpi_name:
                        continue
                    
                    # Check if definition exists (it should for normalized/matched KPIs)
                    existing_definition = kpi_defs_service.get_kpi_definition(args.ticker.upper(), kpi_name)
                    
                    if not existing_definition:
                        # Definition doesn't exist - create it for new KPIs
                        kpi_definition = {
                            'name': kpi_name,
                            'value': {
                                'unit': kpi.get('value', {}).get('unit', ''),
                                'multiplier': kpi.get('value', {}).get('multiplier')
                            },
                            'value_type': kpi.get('value_type', 'quarterly'),
                            'summary': kpi.get('summary', ''),
                            'source': kpi.get('source', ''),
                            'group': kpi.get('group', ''),
                            'frequency': 0,  # Will be set automatically when first value is written
                            'other_names': kpi.get('other_names', [])
                        }
                        kpi_defs_service.set_kpi_definition(args.ticker.upper(), kpi_definition, verbose=args.verbose)
                    
                    # Store the KPI value for this quarter (definition already exists or was just created)
                    kpi_value = kpi.get('value', {}).get('number')
                    if kpi_value is not None:
                        kpi_defs_service.set_kpi_value(
                            args.ticker.upper(),
                            kpi_name,
                            args.quarter,
                            kpi_value,
                            verbose=args.verbose
                        )
                
                # Transform KPIs to only include immutable ID and value for quarterly storage
                simplified_kpis = []
                for kpi in kpis:
                    kpi_value = kpi.get('value', {})
                    # Get the immutable ID from the definition
                    kpi_name = kpi.get('name', '')
                    definition = kpi_defs_service.get_kpi_definition(args.ticker.upper(), kpi_name)
                    kpi_id = definition.get('id') if definition else kpi_defs_service._generate_kpi_id(kpi_name)
                    
                    simplified_kpi = {
                        'id': kpi_id,  # Immutable KPI ID
                        'value': kpi_value.get('number')  # Only the numeric value
                    }
                    simplified_kpis.append(simplified_kpi)
                
                firebase.store_quarterly_analysis(args.ticker.upper(), args.quarter, {
                    'ticker': args.ticker.upper(),
                    'quarter_key': args.quarter,
                    'custom_kpis': simplified_kpis,  # Store simplified version
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
        # Fetch frequencies from definitions (they're managed automatically)
        kpi_defs_service = KPIDefinitionsService()
        for i, kpi in enumerate(kpis, 1):
            kpi_name = kpi.get('name', 'N/A')
            # Get frequency from definition
            definition = kpi_defs_service.get_kpi_definition(args.ticker.upper(), kpi_name) if kpi_name != 'N/A' else None
            frequency = definition.get('frequency', 0) if definition else kpi.get('frequency', 'N/A')
            
            print(f"\n{i}. {kpi_name}")
            print(f"   Value: {kpi.get('value', 'N/A')} {kpi.get('unit', '')}")
            print(f"   Frequency: {frequency}")
            if kpi.get('change'):
                print(f"   Change: {kpi.get('change', 'N/A')} ({kpi.get('change_type', 'N/A')})")
        
    
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
