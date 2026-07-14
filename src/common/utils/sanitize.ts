// `import x = require(...)` — this codebase compiles CommonJS without
// esModuleInterop (see compression/cookie-parser in main.ts). A default import
// would typecheck (allowSyntheticDefaultImports) but crash at runtime because
// sanitize-html's CJS export has no `.default`.
import sanitizeHtml = require('sanitize-html');

/**
 * Rich-text (Quill HTML) fields — listing and featured-property descriptions —
 * are rendered with dangerouslySetInnerHTML on the website. Sanitizing at the
 * write path means a hostile payload never reaches the database, so EVERY
 * client — web, admin, mobile, and any future consumer — is protected
 * regardless of whether its render path remembers to sanitize.
 *
 * The default allowlist keeps normal formatting (headings, lists, links,
 * bold/italic) and strips scripts, event handlers, and embedded objects.
 * Only use this for HTML fields — plain-text fields (logbook notes, job
 * requests) are escaped by React/React Native at render time and running
 * them through an HTML sanitizer could mangle legitimate characters.
 */
export function cleanDescription(html: string): string;
export function cleanDescription(html: string | undefined): string | undefined;
export function cleanDescription(
  html: string | undefined,
): string | undefined {
  if (html === undefined) return undefined;
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags,
    allowedAttributes: sanitizeHtml.defaults.allowedAttributes,
    // http/https/mailto/tel only — kills javascript: URLs in links.
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  });
}
