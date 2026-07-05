import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';

// Authoritative, server-side profanity check. Runs on every submission so it
// cannot be bypassed by posting directly to the API (unlike the old client-side
// AI check). Uses the same dataset as the client for consistent behavior.
const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

export const CAPTION_REJECTION_MESSAGE =
  "Let's keep it friendly — please remove any inappropriate language.";

// Returns a user-facing error message if the caption should be rejected,
// or null if it is clean (or empty).
export const captionModerationError = (caption = '') => {
  if (typeof caption !== 'string' || !caption.trim()) return null;
  return matcher.hasMatch(caption) ? CAPTION_REJECTION_MESSAGE : null;
};
