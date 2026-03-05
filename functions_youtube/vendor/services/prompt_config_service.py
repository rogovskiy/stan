#!/usr/bin/env python3
"""
Prompt Config Service

Reads prompt content and version metadata from Firestore and Storage (same layout as
admin prompts API). Used by dynamic_prompt_runner to execute LLM with prompt-by-name.
"""

from dataclasses import dataclass
from typing import Any, Dict, List

from services.firebase_base_service import FirebaseBaseService

PROMPTS_COLLECTION = "prompts"
STORAGE_PREFIX = "prompts"


class PromptNotFoundError(FileNotFoundError):
    """Raised when a prompt document or its content blob is missing."""

    def __init__(self, message: str, prompt_name: str) -> None:
        super().__init__(message)
        self.prompt_name = prompt_name


@dataclass
class PromptConfig:
    """Resolved config for a prompt (content + current version params)."""

    content: str
    version: int  # currentVersion whose content was loaded
    model: str | None
    temperature: float | None
    structured_output: bool
    schema: str | None  # raw JSON string, or None
    grounding_enabled: bool


def _version_path(prompt_name: str, version: int) -> str:
    return f"{STORAGE_PREFIX}/{prompt_name}/v{version}.txt"


def _parse_version_entry(entry: Any) -> Dict[str, Any]:
    if not isinstance(entry, dict):
        return {}
    return {
        "version": entry.get("version") if isinstance(entry.get("version"), (int, float)) else 0,
        "temperature": entry.get("temperature") if isinstance(entry.get("temperature"), (int, float)) else None,
        "model": entry.get("model") if isinstance(entry.get("model"), str) else None,
        "structuredOutput": entry.get("structuredOutput") is True,
        "schema": entry.get("schema") if isinstance(entry.get("schema"), str) else None,
        "groundingEnabled": entry.get("groundingEnabled") is True,
    }


class PromptConfigService(FirebaseBaseService):
    """Service for loading prompt config (content + params) by prompt name from Firestore/Storage."""

    def get_prompt_config(self, prompt_name: str) -> PromptConfig:
        """
        Load prompt content and current version params for the given prompt name.

        Reads Firestore prompts/{prompt_name} for currentVersion and versions,
        then downloads content from Storage prompts/{prompt_name}/v{currentVersion}.txt.

        Returns:
            PromptConfig with content, model, temperature, structured_output, schema.

        Raises:
            PromptNotFoundError: If the prompt document or content blob does not exist.
        """
        ref = self.db.collection(PROMPTS_COLLECTION).document(prompt_name)
        doc = ref.get()
        if not doc.exists:
            raise PromptNotFoundError(
                f"Prompt document not found: {prompt_name}",
                prompt_name=prompt_name,
            )
        data = doc.to_dict() or {}
        current_version = data.get("currentVersion")
        if not isinstance(current_version, (int, float)) or current_version < 1:
            raise PromptNotFoundError(
                f"Prompt {prompt_name} has no active version (currentVersion={current_version})",
                prompt_name=prompt_name,
            )
        current_version = int(current_version)
        raw_versions: List[Any] = data.get("versions") if isinstance(data.get("versions"), list) else []
        version_entry = None
        for e in raw_versions:
            parsed = _parse_version_entry(e)
            if parsed.get("version") == current_version:
                version_entry = parsed
                break
        if not version_entry:
            version_entry = {
                "temperature": None,
                "model": None,
                "structuredOutput": False,
                "schema": None,
                "groundingEnabled": False,
            }
        storage_path = _version_path(prompt_name, current_version)
        blob = self.bucket.blob(storage_path)
        if not blob.exists():
            raise PromptNotFoundError(
                f"Prompt content blob not found: {storage_path}",
                prompt_name=prompt_name,
            )
        content = blob.download_as_text()
        if content is None:
            content = ""
        return PromptConfig(
            content=content,
            version=current_version,
            model=version_entry.get("model"),
            temperature=(
                float(version_entry["temperature"])
                if version_entry.get("temperature") is not None
                else None
            ),
            structured_output=version_entry.get("structuredOutput", False),
            schema=version_entry.get("schema"),
            grounding_enabled=version_entry.get("groundingEnabled", False),
        )
