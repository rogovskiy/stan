#!/usr/bin/env python3
"""
Prompt Execution Log Service

Writes execution logs for run_llm_with_prompt_name to Firestore and Storage:
prompts/{prompt_id}/executions/{execution_id} with metrics and refs to input/output/parameters in Storage.
"""

from datetime import datetime, timezone

from services.firebase_base_service import FirebaseBaseService

PROMPTS_COLLECTION = "prompts"
STORAGE_PREFIX = "prompts"
EXECUTIONS_STORAGE_PREFIX = "executions"

# Parameters JSON longer than this is stored in object storage; shorter is inline in Firestore.
PARAMETERS_INLINE_MAX_BYTES = 1000


def _execution_storage_prefix(prompt_id: str, execution_id: str) -> str:
    return f"{STORAGE_PREFIX}/{prompt_id}/{EXECUTIONS_STORAGE_PREFIX}/{execution_id}"


class PromptExecutionLogService(FirebaseBaseService):
    """Service for logging prompt executions to Firestore and Storage."""

    def log_execution(
        self,
        prompt_id: str,
        execution_id: str,
        input_content: str,
        output_content: str,
        parameters_json_str: str,
        duration_ms: int,
        usage: dict,
        prompt_version: int,
    ) -> None:
        """
        Write one execution log: upload input/output (and parameters if large) to Storage,
        then write the execution doc to Firestore prompts/{prompt_id}/executions/{execution_id}.
        """
        base_path = _execution_storage_prefix(prompt_id, execution_id)
        input_ref = f"{base_path}/input.txt"
        output_ref = f"{base_path}/output.txt"

        self.bucket.blob(input_ref).upload_from_string(
            input_content, content_type="text/plain; charset=utf-8"
        )
        self.bucket.blob(output_ref).upload_from_string(
            output_content, content_type="text/plain; charset=utf-8"
        )

        doc_data = {
            "createdAt": datetime.now(timezone.utc),
            "promptVersion": prompt_version,
            "durationMs": duration_ms,
            "promptTokenCount": usage.get("prompt_tokens", 0) or 0,
            "responseTokenCount": usage.get("response_tokens", 0) or 0,
            "totalTokenCount": usage.get("total_tokens", 0) or 0,
            "inputStorageRef": input_ref,
            "outputStorageRef": output_ref,
        }

        if len(parameters_json_str) > PARAMETERS_INLINE_MAX_BYTES:
            params_ref = f"{base_path}/parameters.json"
            self.bucket.blob(params_ref).upload_from_string(
                parameters_json_str, content_type="application/json; charset=utf-8"
            )
            doc_data["parametersStorageRef"] = params_ref
        else:
            doc_data["parameters"] = parameters_json_str

        ref = (
            self.db.collection(PROMPTS_COLLECTION)
            .document(prompt_id)
            .collection("executions")
            .document(execution_id)
        )
        ref.set(doc_data)
