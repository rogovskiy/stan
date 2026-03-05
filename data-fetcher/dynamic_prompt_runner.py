#!/usr/bin/env python3
"""
Dynamic Prompt Runner

Executes an LLM call using a prompt looked up by name from Firestore/Storage
(admin prompts). Resolves model, temperature, and optional JSON schema from
the prompt's current version.
"""

import json
import logging
import time
import uuid
from typing import Any, Dict, Optional, Tuple, Union

from google import genai
from google.genai import types

from extraction_utils import (
    clean_schema_for_gemini,
    get_gemini_model,
    get_genai_client,
    render_template_str,
)
from services.prompt_config_service import PromptConfig, PromptConfigService
from services.prompt_execution_log_service import PromptExecutionLogService

logger = logging.getLogger(__name__)

DEFAULT_TEMPERATURE = 0.2
DEFAULT_MAX_OUTPUT_TOKENS = 8192


def _usage_from_response(response: Any) -> Dict[str, int]:
    """Extract token usage from a Gemini GenerateContent response."""
    u = getattr(response, "usage_metadata", None)
    if u is None:
        return {"prompt_tokens": 0, "response_tokens": 0, "total_tokens": 0}
    return {
        "prompt_tokens": getattr(u, "prompt_token_count", 0) or 0,
        "response_tokens": getattr(u, "candidates_token_count", 0) or 0,
        "total_tokens": getattr(u, "total_token_count", 0) or 0,
    }


def run_llm_with_prompt_name(
    prompt_name: str,
    template_vars: Dict[str, Any],
    *,
    api_key: Optional[str] = None,
    max_output_tokens: int = DEFAULT_MAX_OUTPUT_TOKENS,
) -> Tuple[Union[str, Dict[str, Any]], str]:
    """
    Load prompt config by name, render the prompt with template_vars, and run the LLM.
    Logs the execution and returns (result, execution_id) so callers can attach provenance.

    Prompt content and version params (model, temperature, schema, structured_output)
    are read from Firestore and Storage via PromptConfigService. If the prompt or
    its content blob is missing, PromptNotFoundError is raised.

    Args:
        prompt_name: Firestore document ID in the prompts collection (e.g. 'youtube_transcript_summary').
        template_vars: Variables to substitute in the prompt body (e.g. {'transcript': '...'}).
        api_key: Optional Gemini API key. If None, get_genai_client() is used (env vars).
        max_output_tokens: Max tokens for the response (default 8192). Not stored per-version in admin yet.

    Returns:
        (result, execution_id): result is response text (str) or parsed JSON (dict) when structured_output;
        execution_id is the log document ID for provenance.

    Raises:
        PromptNotFoundError: Prompt document or content blob not found.
        ValueError: Missing template variable or invalid schema JSON.
    """
    execution_id = uuid.uuid4().hex
    config = PromptConfigService().get_prompt_config(prompt_name)
    content = render_template_str(config.content, **template_vars)
    model = config.model if config.model and config.model.strip() else get_gemini_model()
    temperature = config.temperature if config.temperature is not None else DEFAULT_TEMPERATURE
    if api_key is not None and api_key.strip():
        client = genai.Client(api_key=api_key)
    else:
        client = get_genai_client()
    use_structured = config.structured_output and config.schema and config.schema.strip()
    use_grounding = config.grounding_enabled
    if use_structured and not use_grounding:
        try:
            schema_dict = json.loads(config.schema)
        except json.JSONDecodeError as e:
            raise ValueError(f"Prompt {prompt_name} has invalid schema JSON: {e}") from e
        cleaned = clean_schema_for_gemini(schema_dict)
        generate_config = types.GenerateContentConfig(
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            response_mime_type="application/json",
            response_json_schema=cleaned,
        )
    else:
        kwargs = dict(
            temperature=temperature,
            max_output_tokens=max_output_tokens,
        )
        if use_grounding:
            kwargs["tools"] = [types.Tool(google_search=types.GoogleSearch())]
        generate_config = types.GenerateContentConfig(**kwargs)

    start = time.perf_counter()
    response = client.models.generate_content(
        model=model,
        contents=content,
        config=generate_config,
    )
    duration_ms = int((time.perf_counter() - start) * 1000)

    if not response.text:
        raise ValueError("Gemini returned empty response")
    text = response.text.strip()

    usage = _usage_from_response(response)
    # Log template (replacement) variables passed into the prompt, not run config.
    parameters_str = json.dumps(template_vars, sort_keys=True, default=str)
    PromptExecutionLogService().log_execution(
        prompt_id=prompt_name,
        execution_id=execution_id,
        input_content=content,
        output_content=text,
        parameters_json_str=parameters_str,
        duration_ms=duration_ms,
        usage=usage,
        prompt_version=config.version,
    )

    if use_structured:
        try:
            result = json.loads(text)
        except json.JSONDecodeError:
            result = text
    else:
        result = text
    return (result, execution_id)
