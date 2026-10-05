import { MODEL_CAPABILITIES } from './agent-data.js';

// The models endpoint supplies IDs, not modality metadata, so capabilities
// are listed by exact model ID: similarly named models inherit nothing.
export function modelSupportsVision(modelId) {
  return (
    Object.hasOwn(MODEL_CAPABILITIES, modelId) &&
    MODEL_CAPABILITIES[modelId].vision === true
  );
}

/** Vision model IDs, newline-separated, for the runbooks' shell lookup. */
export function visionModelList() {
  return Object.keys(MODEL_CAPABILITIES).filter(modelSupportsVision).join('\n');
}
