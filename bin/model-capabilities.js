import { readFileSync } from 'node:fs';

// The models endpoint currently supplies IDs, not modality metadata. Keep
// explicit capabilities in the same registry used to generate the Unix lookup.
const { modelCapabilities = {} } = JSON.parse(
  readFileSync(new URL('./registry.generated.json', import.meta.url), 'utf8'),
);

export function modelSupportsVision(modelId) {
  return (
    Object.hasOwn(modelCapabilities, modelId) &&
    modelCapabilities[modelId].vision === true
  );
}
