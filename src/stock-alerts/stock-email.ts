/**
 * The emails that tell agents about PropertyLoop's own stock.
 *
 * Shared by the automatic send when a property is published
 * (StockAlertsService) and by the one-off announcement script, so both look
 * like the same company wrote them.
 */

export const SITE_URL = (
  process.env.FRONTEND_URL ?? 'https://propertyloop.ng'
).replace(/\/$/, '');

export const COMMISSION_PERCENT = 2.5;

const LOGO_URL =
  'https://image2url.com/r2/default/images/1774405533651-13ef5a22-bfcb-4d8e-801e-563f4451c8b0.png';

export interface StockProperty {
  id: string;
  title: string;
  location: string;
  priceLabel: string | null;
  coverImage: string | null;
  beds?: number | null;
  baths?: number | null;
  type?: string | null;
}

/** First name only: "Hi Olumide," reads like a person wrote it. */
export function firstName(name: string | null | undefined): string {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first && first.length > 1 ? first : 'there';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STYLE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background-color: #f4f4f5;
    color: #111827;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .wrapper { background-color: #f4f4f5; padding: 40px 16px; }
  .container {
    max-width: 600px; margin: 0 auto; background-color: #ffffff;
    border-radius: 8px; border: 1px solid #e5e7eb; overflow: hidden;
  }
  .header { background-color: #0f1f14; padding: 28px 40px; }
  .header img { height: 32px; width: auto; display: block; }
  .divider-green { height: 3px; background-color: #2f9e61; }
  .content { padding: 40px; }
  .greeting { font-size: 21px; font-weight: 600; margin-bottom: 14px; letter-spacing: -0.3px; }
  .body-text { font-size: 15px; color: #4b5563; line-height: 1.75; margin-bottom: 24px; }
  .section-label {
    font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
    color: #2f9e61; margin-bottom: 12px;
  }
  .card { border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; margin-bottom: 24px; }
  .card img { width: 100%; height: auto; display: block; }
  .card-body { padding: 18px 20px; }
  .card-title { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
  .card-meta { font-size: 13px; color: #6b7280; }
  .card-price { font-size: 18px; font-weight: 700; color: #0f1f14; margin-top: 10px; }
  .steps { margin: 0 0 26px 18px; font-size: 15px; color: #4b5563; }
  .steps li { margin-bottom: 8px; }
  .btn {
    display: inline-block; background-color: #2f9e61; color: #ffffff !important;
    text-decoration: none; font-weight: 600; font-size: 15px;
    padding: 13px 26px; border-radius: 6px;
  }
  .btn-secondary {
    display: inline-block; border: 1px solid #d1d5db; color: #111827 !important;
    text-decoration: none; font-weight: 600; font-size: 15px;
    padding: 12px 24px; border-radius: 6px; margin-left: 8px;
  }
  .note { font-size: 13px; color: #6b7280; margin-top: 26px; line-height: 1.7; }
  .footer {
    background-color: #f9fafb; border-top: 1px solid #e5e7eb;
    padding: 22px 40px; font-size: 12px; color: #9ca3af; line-height: 1.7;
  }
  .footer a { color: #6b7280; }
  @media (max-width: 480px) {
    .content, .header, .footer { padding-left: 22px; padding-right: 22px; }
    .btn, .btn-secondary { display: block; text-align: center; margin: 0 0 10px 0; }
  }
`;

export function shell(title: string, inner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>${STYLE}</style>
  </head>
  <body>
    <div class="wrapper">
      <div class="container">
        <div class="header"><img src="${LOGO_URL}" alt="PropertyLoop" /></div>
        <div class="divider-green"></div>
        <div class="content">${inner}</div>
        <div class="footer">
          PropertyLoop Ltd · Lagos, Nigeria<br />
          You are receiving this because you have a PropertyLoop account. To stop
          emails like this, reply with the word UNSUBSCRIBE.<br />
          <a href="${SITE_URL}/privacy">Privacy</a> ·
          <a href="${SITE_URL}/terms">Terms</a> ·
          <a href="${SITE_URL}/contact">Contact</a>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

/** The property, as a card. Photo included only when there is one. */
export function propertyCard(property: StockProperty): string {
  const bits = [
    property.location,
    property.type,
    property.beds ? `${property.beds} bed` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return `
    <div class="card">
      ${
        property.coverImage
          ? `<a href="${SITE_URL}/property/${property.id}"><img src="${escapeHtml(property.coverImage)}" alt="" /></a>`
          : ''
      }
      <div class="card-body">
        <div class="card-title">${escapeHtml(property.title)}</div>
        <div class="card-meta">${escapeHtml(bits)}</div>
        ${property.priceLabel ? `<div class="card-price">${escapeHtml(property.priceLabel)}</div>` : ''}
      </div>
    </div>`;
}

export function propertyLines(property: StockProperty): string {
  return [
    property.title,
    [property.location, property.priceLabel].filter(Boolean).join(' · '),
    `${SITE_URL}/property/${property.id}`,
  ].join('\n');
}

/**
 * Sent to every agent when a PropertyLoop property goes live.
 *
 * The point is the commission: PropertyLoop's own stock is the one inventory
 * an agent can earn on without owning the mandate.
 */
export function buildNewStockEmail(
  name: string | null,
  property: StockProperty,
): { subject: string; html: string; text: string } {
  const who = firstName(name);
  const subject = `New PropertyLoop stock in ${property.location} — earn ${COMMISSION_PERCENT}% on an introduction`;

  const html = shell(
    subject,
    `
      <div class="greeting">Hi ${escapeHtml(who)},</div>
      <p class="body-text">
        We have just listed a new property under PropertyLoop's own stock. You do
        not need the mandate and you do not need to own the listing — introduce a
        buyer who closes and you earn <strong>${COMMISSION_PERCENT}% commission</strong>.
      </p>
      <div class="section-label">The property</div>
      ${propertyCard(property)}
      <div class="section-label">How you earn on it</div>
      <ol class="steps">
        <li>Open <strong>PL stock</strong> in the app, or PropertyLoop stock in your agent dashboard.</li>
        <li>Share the property with a buyer you already know.</li>
        <li>Log the introduction before the viewing, so the buyer is attributed to you.</li>
        <li>When the sale closes, your ${COMMISSION_PERCENT}% is recorded against your name.</li>
      </ol>
      <p>
        <a class="btn" href="${SITE_URL}/property/${property.id}">View the property</a>
        <a class="btn-secondary" href="${SITE_URL}/agent-dashboard/stock">Open PL stock</a>
      </p>
      <p class="note">
        Not registered for the partner programme yet? Register once at
        <a href="${SITE_URL}/realtors/partners">${SITE_URL.replace('https://', '')}/realtors/partners</a>
        — it is what attaches your name, and your commission, to an introduction.
      </p>
    `,
  );

  const text = [
    `Hi ${who},`,
    '',
    `We have just listed a new property under PropertyLoop's own stock. Introduce a buyer who closes and you earn ${COMMISSION_PERCENT}% commission — you do not need the mandate.`,
    '',
    propertyLines(property),
    '',
    'How you earn on it:',
    '1. Open PL stock in the app, or PropertyLoop stock in your agent dashboard.',
    '2. Share the property with a buyer you already know.',
    '3. Log the introduction before the viewing, so the buyer is attributed to you.',
    `4. When the sale closes, your ${COMMISSION_PERCENT}% is recorded against your name.`,
    '',
    `PL stock: ${SITE_URL}/agent-dashboard/stock`,
    `Partner programme: ${SITE_URL}/realtors/partners`,
    '',
    'You are receiving this because you have a PropertyLoop account. To stop emails like this, reply with the word UNSUBSCRIBE.',
  ].join('\n');

  return { subject, html, text };
}
