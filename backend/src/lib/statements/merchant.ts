/**
 * Turn a raw bank description into a stable merchant name for grouping, e.g.
 *   "SQ *BLUE BOTTLE COFFEE 0123 OAKLAND CA" → "Blue Bottle Coffee"
 *   "NETFLIX.COM 866-579-7172 CA"            → "Netflix.com"
 * Heuristic only: merchant rules fix whatever this gets wrong.
 */
const PREFIX =
  /^(SQ ?\*|TST ?\* ?|SP ?\*|SP |PAYPAL ?\*|PP ?\*|APLPAY |APPLE PAY |GOOGLE ?\*|GOOGLE PAY |DD ?\*|DOORDASH ?\*|IC ?\*|PY ?\*|BT ?\*|CKO ?\*|FS ?\*|PAR ?\*|POS |DEBIT CARD PURCHASE |CHECKCARD |PURCHASE AUTHORIZED ON \d\d\/\d\d |RECURRING PAYMENT )/i;

export function normalizeMerchant(description: string): string {
  let s = description.toUpperCase().replace(/\s+/g, " ").trim();

  for (let i = 0; i < 3 && PREFIX.test(s); i++) s = s.replace(PREFIX, "").trim();

  // "AMAZON MKTPL*AB12CD" → "AMAZON MKTPL"; keep "UBER *EATS"-style short brands whole
  const star = s.indexOf("*");
  if (star >= 4) s = s.slice(0, star);
  s = s.replace(/\*/g, " ");

  // Store numbers, phone numbers, reference numbers and whatever follows them
  const cut = s.search(/ #| \d{3,}|\d{3}-\d{3,}| X{2,}\d*/);
  if (cut > 0) s = s.slice(0, cut);

  s = s.replace(/[\s.,\-/]+$/, "").replace(/^[\s.,\-/]+/, "").replace(/\s+/g, " ");
  if (!s) s = description.trim();

  return s
    .toLowerCase()
    .replace(/(^|[\s\-/&(])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Grouping key: case, spacing and punctuation insensitive */
export function merchantKey(merchant: string): string {
  return merchant.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Bank-side descriptions of a payment to a credit card */
export const CARD_PAYMENT =
  /(CHASE CREDIT CRD|CHASE CARD|AMEX EPAYMENT|AMERICAN EXPRESS|APPLECARD|APPLE CARD|GSBANK|CITI ?CARD|CITI AUTOPAY|DISCOVER|CAPITAL ONE|BARCLAYCARD|SYNCHRONY|CRD ?SRVC).*(PAYMENT|PMT|EPAY|AUTOPAY|AUTO PAY|ONLINE|PYMT)|(PAYMENT|PMT|EPAY|AUTOPAY|PYMT).*(CHASE CARD|CHASE CREDIT|AMEX|AMERICAN EXPRESS|APPLECARD|APPLE CARD|GSBANK|CITI|DISCOVER|CAPITAL ONE)/i;

/** Card-side description of a payment received */
export const PAYMENT_RECEIVED = /(AUTOPAY|ONLINE|MOBILE|ELECTRONIC|INTERNET)? ?PAYMENT.*(THANK YOU|RECEIVED)|^PAYMENT THANK YOU|^AUTOPAY PAYMENT/i;

export const INTEREST = /INTEREST CHARGE|PURCHASE INTEREST|INTEREST CHARGED|FINANCE CHARGE/i;
export const INTEREST_EARNED = /INTEREST (PAID|EARNED)|INTEREST PAYMENT/i;
export const FEE = /\bFEE\b|OVERDRAFT|NSF|RETURNED ITEM/i;
export const OWN_TRANSFER = /\b(TRANSFER|XFER)\b/i;
export const PAYCHECK = /PAYROLL|PAYRLL|DIRECT ?DEP|DIR DEP|SALARY|PAYCHECK/i;
