// Pi extension (Pi loads a folder's index.ts): keep requests to Subconscious at the newest 100 images, so a
// long screenshot session's upload stops growing. The rule lives in
// window.js (plain JS so the CLI's tests can import it).

import { windowImages } from './window.js';

export default function (pi: {
  on: (
    event: 'before_provider_request',
    handler: (event: { payload: unknown }) => unknown,
  ) => void;
}) {
  pi.on('before_provider_request', (event) => windowImages(event.payload));
}
