#!/usr/bin/env python3
"""
Extraction Utilities

Generic utility functions for LLM-based extraction tasks using prompts and schemas.
These utilities can be used by any extraction script (KPI extraction, summaries, etc.)
Uses the google.genai package (not the deprecated google.generativeai).
"""

import os
import json
from typing import Any, Dict, Optional
from pathlib import Path

import base64
from google import genai
from google.genai import types


def get_gemini_model() -> str:
    """Get Gemini model from env var or return default.

    Returns:
        Gemini model name (default: 'gemini-2.5-pro')
    """
    return os.getenv('GEMINI_MODEL', 'gemini-2.5-pro')


def get_genai_client() -> genai.Client:
    """Create and return a Gemini API client using env API key.

    Returns:
        genai.Client instance

    Raises:
        ValueError: If API key is not set in environment variables
    """
    api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_AI_API_KEY')
    if not api_key:
        raise ValueError('GEMINI_API_KEY or GOOGLE_AI_API_KEY environment variable is not set')
    return genai.Client(api_key=api_key)


def initialize_gemini_model(
    model_name: Optional[str] = None,
    generation_config: Optional[Dict[str, Any]] = None,
) -> "GenaiModelAdapter":
    """Backward-compatible wrapper: returns an adapter that uses the google.genai client.

    Callers can use model.generate_content(contents, generation_config=...) as with the
    deprecated google.generativeai package. Prefer get_genai_client() and
    client.models.generate_content() for new code.
    """
    client = get_genai_client()
    model = model_name or get_gemini_model()
    return GenaiModelAdapter(client=client, model=model)


class GenaiModelAdapter:
    """Adapter so generate_content(contents, generation_config) works like the old SDK."""

    def __init__(self, client: genai.Client, model: str) -> None:
        self._client = client
        self._model = model

    def generate_content(
        self,
        contents: Any,
        generation_config: Optional[Dict[str, Any]] = None,
    ) -> Any:
        # Normalize generation_config: support dict or object with attributes (e.g. old SDK GenerationConfig)
        g = generation_config or {}
        if not isinstance(g, dict):
            g = {
                k: getattr(g, k)
                for k in ("temperature", "max_output_tokens", "response_mime_type", "response_schema")
                if hasattr(g, k)
            }
        config = types.GenerateContentConfig(
            temperature=g.get("temperature", 0.3),
            max_output_tokens=g.get("max_output_tokens", 8192),
            response_mime_type=g.get("response_mime_type"),
            response_json_schema=g.get("response_schema"),
        )
        if isinstance(contents, str):
            parts = [types.Part(text=contents)]
        else:
            parts = []
            for p in contents:
                if isinstance(p, str):
                    parts.append(types.Part(text=p))
                elif isinstance(p, dict) and "data" in p:
                    data = p["data"]
                    if isinstance(data, str):
                        data = base64.b64decode(data)
                    parts.append(
                        types.Part(
                            inline_data=types.Blob(
                                mime_type=p.get("mime_type", "application/pdf"),
                                data=data,
                            )
                        )
                    )
                elif isinstance(p, dict) and "uri" in p:
                    parts.append(
                        types.Part(
                            file_data=types.FileData(
                                file_uri=p["uri"],
                                mime_type=p.get("mime_type"),
                            )
                        )
                    )
                elif hasattr(p, "uri"):
                    parts.append(
                        types.Part(
                            file_data=types.FileData(
                                file_uri=p.uri,
                                mime_type=getattr(p, "mime_type", None),
                            )
                        )
                    )
                else:
                    parts.append(types.Part(text=str(p)))
        return self._client.models.generate_content(
            model=self._model,
            contents=parts,
            config=config,
        )


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
