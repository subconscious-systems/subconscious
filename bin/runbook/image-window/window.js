// Keeps Pi's requests to Subconscious at the newest MAX_IMAGES images.
//
// Pi resends every screenshot on every turn, so a long session's upload grows
// without end. The Subconscious gateway keeps only the newest 100 images before
// it forwards a request, but that does not stop Pi uploading all of them. This
// applies the same rule before the request leaves Pi: each image past the
// newest MAX_IMAGES is replaced by the text part the gateway would leave in its
// place, so the gateway receives exactly the request its own window would have
// produced and Subconscious Cache still reuses the rest.

export const MAX_IMAGES = 100;
export const IMAGE_LABEL = 'image';
const SUBCONSCIOUS_MODEL = /^subconscious\//;

function isImage(part) {
  return part?.type === 'image_url';
}

function countImages(messages) {
  return messages
    .flatMap((message) =>
      Array.isArray(message.content) ? message.content : [],
    )
    .filter(isImage).length;
}

/**
 * Returns a new OpenAI chat payload with the oldest images past `max`
 * replaced by the label, or undefined when there is nothing to change.
 */
export function windowImages(payload, max = MAX_IMAGES) {
  if (!SUBCONSCIOUS_MODEL.test(payload?.model ?? '')) return undefined;
  if (!Array.isArray(payload.messages)) return undefined;
  let excess = countImages(payload.messages) - max;
  if (excess <= 0) return undefined;
  const messages = payload.messages.map((message) => {
    if (excess <= 0 || !Array.isArray(message.content)) return message;
    const content = message.content.map((part) => {
      if (excess <= 0 || !isImage(part)) return part;
      excess -= 1;
      return { type: 'text', text: IMAGE_LABEL };
    });
    return { ...message, content };
  });
  return { ...payload, messages };
}

/**
 * Wraps a fetch so every JSON request body goes through windowImages first.
 * Anything else, or a body that is not JSON, is sent unchanged: a problem here
 * must never break a coding session.
 */
export function windowFetch(fetchFn) {
  return async (input, init) => {
    if (typeof init?.body !== 'string') return fetchFn(input, init);
    let windowed;
    try {
      windowed = windowImages(JSON.parse(init.body));
    } catch {
      return fetchFn(input, init);
    }
    if (!windowed) return fetchFn(input, init);
    return fetchFn(input, { ...init, body: JSON.stringify(windowed) });
  };
}
