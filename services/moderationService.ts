import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';

// Local profanity matcher — no network, no API key. Handles common obfuscation
// (leetspeak, repeated letters) while avoiding false positives like "class" or
// "Scunthorpe". The server runs the same check authoritatively on submit; this
// client copy just gives instant feedback before the upload starts.
const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

export const CAPTION_REJECTION_MESSAGE =
  "Let's keep it friendly — please remove any inappropriate language.";

export const validateCaption = (text: string): { isValid: boolean; reason?: string } => {
  if (!text.trim()) return { isValid: true };
  if (matcher.hasMatch(text)) {
    return { isValid: false, reason: CAPTION_REJECTION_MESSAGE };
  }
  return { isValid: true };
};
