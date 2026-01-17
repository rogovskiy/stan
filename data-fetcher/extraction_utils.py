#!/usr/bin/env python3
"""
Extraction Utilities

Generic utility functions for LLM-based extraction tasks using prompts and schemas.
These utilities can be used by any extraction script (KPI extraction, summaries, etc.)
"""

import os
import json
from typing import Dict, Any, Optional
from pathlib import Path
import google.generativeai as genai


def get_gemini_model() -> str:
    """Get Gemini model from env var or return default
    
    Returns:
        Gemini model name (default: 'gemini-2.5-pro')
    """
    return os.getenv('GEMINI_MODEL', 'gemini-2.5-pro')


def initialize_gemini_model() -> genai.GenerativeModel:
    """Initialize and return a configured Gemini GenerativeModel instance.
    
    Reads API key from environment variables (GEMINI_API_KEY or GOOGLE_AI_API_KEY),
    configures the genai client, and returns a model instance.
    
    Returns:
        Configured GenerativeModel instance
        
    Raises:
        ValueError: If API key is not set in environment variables
    """
    gemini_api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_AI_API_KEY')
    if not gemini_api_key:
        raise ValueError('GEMINI_API_KEY or GOOGLE_AI_API_KEY environment variable is not set')
    
    genai.configure(api_key=gemini_api_key)
    model_name = get_gemini_model()
    return genai.GenerativeModel(model_name)


def extract_json_from_llm_response(response_text: str) -> str:
    """Extract JSON from LLM response (handles markdown code blocks)
    
    Args:
        response_text: Raw response text from LLM
        
    Returns:
        Extracted JSON string (without markdown formatting)
    """
    if '```json' in response_text:
        return response_text.split('```json')[1].split('```')[0].strip()
    elif '```' in response_text:
        return response_text.split('```')[1].split('```')[0].strip()
    return response_text.strip()


def load_prompt_template(template_name: str, prompts_dir: Optional[Path] = None, **kwargs) -> str:
    """Load and render a prompt template file
    
    Args:
        template_name: Name of template file (e.g., 'kpi_extraction_prompt.txt')
        prompts_dir: Directory containing prompt templates (defaults to 'prompts' relative to script)
        **kwargs: Variables to substitute in the template
        
    Returns:
        Rendered prompt string
        
    Raises:
        FileNotFoundError: If template file doesn't exist
        ValueError: If template variable is missing
    """
    if prompts_dir is None:
        # Default to 'prompts' directory relative to this file
        prompts_dir = Path(__file__).parent / 'prompts'
    
    template_path = prompts_dir / template_name
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


def load_json_schema(schema_name: str, schemas_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Load a JSON schema file
    
    Args:
        schema_name: Name of schema file (e.g., 'kpi_schema.json')
        schemas_dir: Directory containing schema files (defaults to script directory)
        
    Returns:
        Schema as dictionary
        
    Raises:
        FileNotFoundError: If schema file doesn't exist
    """
    if schemas_dir is None:
        # Default to script directory
        schemas_dir = Path(__file__).parent
    
    schema_path = schemas_dir / schema_name
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
                # Handle list types (e.g., ["string", "null"]) - Gemini doesn't support this
                # Convert to the first non-null type, or just "string" if it's a union with null
                if isinstance(value, list):
                    # Find first non-null type, or default to string
                    non_null_types = [t for t in value if t != 'null']
                    cleaned[key] = non_null_types[0] if non_null_types else 'string'
                else:
                    cleaned[key] = value
    
    return cleaned


def load_example_document(filename: str, base_dir: Optional[Path] = None) -> str:
    """Load an example document (markdown, text, etc.) for use in prompts
    
    Args:
        filename: Name of the example document file (e.g., 'kpi_example.md')
        base_dir: Base directory to search (defaults to script directory)
        
    Returns:
        Document content as string
        
    Raises:
        FileNotFoundError: If document file doesn't exist
    """
    if base_dir is None:
        base_dir = Path(__file__).parent
    
    doc_path = base_dir / filename
    if not doc_path.exists():
        raise FileNotFoundError(f"Example document not found: {doc_path}")
    
    with open(doc_path, 'r', encoding='utf-8') as f:
        return f.read()


def get_previous_quarter_key(quarter_key: str) -> str:
    """Calculate previous quarter key from current quarter key
    
    Args:
        quarter_key: Current quarter key in format YYYYQN (e.g., "2025Q1")
        
    Returns:
        Previous quarter key in format YYYYQN (e.g., "2024Q4")
        
    Examples:
        >>> get_previous_quarter_key("2025Q1")
        "2024Q4"
        >>> get_previous_quarter_key("2025Q2")
        "2025Q1"
    """
    year_str, q_str = quarter_key.split('Q')
    year = int(year_str)
    quarter = int(q_str)
    
    if quarter == 1:
        prev_year = year - 1
        prev_quarter = 4
    else:
        prev_year = year
        prev_quarter = quarter - 1
    
    return f"{prev_year}Q{prev_quarter}"
