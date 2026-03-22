/**
 * Firestore / Storage prompt document IDs for thesis chat agents.
 * Upload template text via /prompts/{id} (see prompt-seeds/*.txt in repo for initial content).
 *
 * Placeholders in templates (replaced server-side):
 * - position_thesis_builder: {{name}}, {{lockNote}}, {{continuationNote}}, {{thesisContextBlock}}
 * - position_thesis_onboard: {{draftJsonSnippet}}
 * - position_thesis_onboard_structurize: {{draftJsonSnippet}}, {{freeText}}
 * - position_thesis_reality_check: {{name}}, {{thesisContextBlock}}
 */
export const PROMPT_POSITION_THESIS_BUILDER = 'position_thesis_builder' as const;
export const PROMPT_POSITION_THESIS_ONBOARD = 'position_thesis_onboard' as const;
export const PROMPT_POSITION_THESIS_ONBOARD_STRUCTURIZE =
  'position_thesis_onboard_structurize' as const;
export const PROMPT_POSITION_THESIS_REALITY_CHECK = 'position_thesis_reality_check' as const;
