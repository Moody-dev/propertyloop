import { BadRequestException } from '@nestjs/common';
import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from 'obscenity';

// App Store guideline 1.2 requires "a method for filtering objectionable
// material from being posted" for any app with user-generated content.
// `obscenity` ships a maintained, regularly-updated English profanity/slur
// dataset and normalizes common evasions (leetspeak, spacing, repeated
// letters) before matching — far more robust than a hand-rolled word list.
//
// The dataset flags some blacklisted words as substrings (e.g. "ass", "cum",
// "cock"), which collides with ordinary words a real-estate/chat context uses
// constantly — a listing described as "spacious, classic finishes" or "brass
// door handles" would otherwise be rejected. Whitelist the collisions we can
// anticipate; add to this list if a real false positive turns up in review.
const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
  whitelistedTerms: [
    'class',
    'classic',
    'classy',
    'classroom',
    'classified',
    'assign',
    'assist',
    'assess',
    'assessment',
    'assemble',
    'assembly',
    'associate',
    'brass',
    'grass',
    'grassy',
    'compass',
    'passage',
    'password',
    'massive',
    'cumulative',
    'document',
    'cocktail',
    'cockpit',
  ],
});

/**
 * Throws if `text` contains objectionable content. Call at the point of
 * creation for any free-text a user can post to other users: chat messages,
 * listing titles/descriptions, profile bios, reviews. `fieldLabel` names the
 * field in the error so the client can point the user at what to fix.
 */
export function assertNotObjectionable(
  text: string | null | undefined,
  fieldLabel = 'This',
): void {
  if (!text) return;
  if (matcher.hasMatch(text)) {
    throw new BadRequestException(
      `${fieldLabel} contains language that isn't allowed on PropertyLoop. Please revise and try again.`,
    );
  }
}
