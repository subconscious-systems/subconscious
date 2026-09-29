// The image window: keep a request to Subconscious at the newest screenshots.
//
// Every coding agent resends its whole history, every screenshot included, on
// every turn, so a long screenshot session's upload grows without end. The
// Subconscious gateway keeps only the newest images before it forwards a
// request, but that does not stop the agent uploading all of them. subc's Pi
// extension (index.ts) and OpenCode plugin apply this rule before the request
// leaves the machine:
//
//   keep the newest screenshots, up to MAX_IMAGES and about SOFT_IMAGE_BYTES
//   in total; replace every older one with the text IMAGE_LABEL.
//
// The label is what keeps Subconscious Cache working. The gateway puts the
// same label before every image, so replacing an image with it removes only
// the image's own tokens and nothing around it moves; the cache then reuses
// the rest of the conversation and each turn only reads the new screenshot.
//
// The cache reuses across one removed image per turn, not several, so the
// window never removes more than one screenshot per turn. A big screenshot can
// take the total over SOFT_IMAGE_BYTES for a few turns while the window
// catches up one screenshot at a time. Only if a request would pass
// HARD_IMAGE_BYTES does it drop
// straight back to the soft limit, which costs that turn's cache hit instead
// of failing the request.

export const MAX_IMAGES = 30;
export const IMAGE_LABEL = 'image';
const MIB = 1024 * 1024;
/** Where trimming starts; room below the hard limit to catch up. */
export const DEFAULT_SOFT_IMAGE_MIB = 25;
/** Never forwarded above this. */
export const DEFAULT_HARD_IMAGE_MIB = 30;
export const SOFT_IMAGE_BYTES =
  positiveNumber(
    process.env.SUBCONSCIOUS_IMAGE_WINDOW_SOFT_MIB,
    DEFAULT_SOFT_IMAGE_MIB,
  ) * MIB;
export const HARD_IMAGE_BYTES =
  positiveNumber(
    process.env.SUBCONSCIOUS_IMAGE_WINDOW_HARD_MIB,
    DEFAULT_HARD_IMAGE_MIB,
  ) * MIB;
const SUBCONSCIOUS_MODEL = /^subconscious\//;
const LABEL_PART = Object.freeze({ type: 'text', text: IMAGE_LABEL });

function positiveNumber(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * How many of the oldest images to drop, given each image's size in order
 * (oldest first). The answer for a request is worked out turn by turn over
 * its history, as if each earlier screenshot had just arrived, so it depends
 * only on the request and consecutive turns differ by at most one removal
 * (except at the hard limit). The newest image is always kept.
 */
export function imagesToDrop(
  sizes,
  maxImages = MAX_IMAGES,
  softBytes = SOFT_IMAGE_BYTES,
  hardBytes = HARD_IMAGE_BYTES,
) {
  const total = [0];
  for (const size of sizes) total.push(total.at(-1) + size);
  const kept = (from, to) => total[to] - total[from];
  let dropped = 0;
  // Smallest drop count that meets both soft limits for the first k images.
  let needed = 0;
  for (let k = 1; k <= sizes.length; k++) {
    needed = Math.max(needed, k - maxImages);
    while (needed < k - 1 && kept(needed, k) > softBytes) needed += 1;
    dropped = Math.max(dropped, Math.min(dropped + 1, needed));
    if (kept(dropped, k) > hardBytes) dropped = needed;
  }
  return dropped;
}

function contentParts(message) {
  return Array.isArray(message.content) ? message.content : [];
}

function isChatImage(part) {
  return part?.type === 'image_url';
}

function chatImageSize(part) {
  const url =
    typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
  return typeof url === 'string' ? url.length : 0;
}

/**
 * Returns a new OpenAI chat payload with the oldest images replaced by the
 * label, or undefined when there is nothing to change.
 */
export function windowImages(
  payload,
  maxImages = MAX_IMAGES,
  softBytes = SOFT_IMAGE_BYTES,
  hardBytes = HARD_IMAGE_BYTES,
) {
  if (!SUBCONSCIOUS_MODEL.test(payload?.model ?? '')) return undefined;
  if (!Array.isArray(payload.messages)) return undefined;
  const sizes = payload.messages
    .flatMap(contentParts)
    .filter(isChatImage)
    .map(chatImageSize);
  let drop = imagesToDrop(sizes, maxImages, softBytes, hardBytes);
  if (drop === 0) return undefined;
  const messages = payload.messages.map((message) => {
    if (drop === 0 || !Array.isArray(message.content)) return message;
    const content = message.content.map((part) => {
      if (drop === 0 || !isChatImage(part)) return part;
      drop -= 1;
      return LABEL_PART;
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
