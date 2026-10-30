import { MODEL_CAPABILITIES } from './agent-data.js';

// Capabilities are listed by exact model ID: similarly named models inherit
// nothing. The canonical catalog's per-model modality metadata is preferred
// when a launch carries it; the packaged map is the offline fallback.
export function modelSupportsVision(modelId, entries = []) {
  const entry = entries.find((candidate) => candidate?.id === modelId);
  if (entry?.modalities) {
    const input = Array.isArray(entry.modalities.input)
      ? entry.modalities.input
      : [];
    return input.includes('image');
  }
  return (
    Object.hasOwn(MODEL_CAPABILITIES, modelId) &&
    MODEL_CAPABILITIES[modelId].vision === true
  );
}

/** Vision model IDs, newline-separated, for the runbooks' shell lookup. */
export function visionModelList(entries = []) {
  const ids = entries.length
    ? entries
        .map((entry) => entry.id)
        .filter((id) => modelSupportsVision(id, entries))
    : Object.keys(MODEL_CAPABILITIES).filter((id) =>
        modelSupportsVision(id, entries),
      );
  return ids.join('\n');
}

/**
 * Canonical catalog entries from the launch env's SUBC_MODEL_METADATA (a
 * JSON array), or an empty list when discovery did not run, was skipped,
 * or wrote malformed JSON.
 */
export function catalogEntriesFromMetadata(metadataJson) {
  if (typeof metadataJson !== 'string' || !metadataJson.trim()) return [];
  try {
    const entries = JSON.parse(metadataJson);
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

/**
 * The vision list for a runbook script, from the launch env's catalog
 * metadata with the packaged map as the fallback when discovery did not
 * run or failed.
 */
export function visionModelListFromMetadata(metadataJson) {
  const entries = catalogEntriesFromMetadata(metadataJson);
  return entries.length ? visionModelList(entries) : visionModelList();
}
