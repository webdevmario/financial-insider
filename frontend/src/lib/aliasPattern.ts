/**
 * Payment-system prefixes on card text: "TST*" is Toast, "SQ *" Square, "SP " Shopify, "PAR*" PAR POS,
 * and so on. They name whoever ran the card, not the merchant, so one of them matches hundreds of
 * unrelated charges. Mirrors PREFIX in backend/src/lib/statements/merchant.ts, minus the delivery
 * apps (DoorDash, Instacart): with those the app itself is usually the payee.
 */
const PROCESSOR_PREFIX =
  /^(SQU ?\* ?|SQ ?\* ?|TST ?\* ?|SP ?\* ?|SP |PAYPAL ?\* ?|PP ?\* ?|APLPAY |APPLE PAY |GOOGLE ?\* ?|GOOGLE PAY |PY ?\* ?|BT ?\* ?|CKO ?\* ?|FS ?\* ?|PAR ?\* ?|POS |DEBIT CARD PURCHASE |CHECKCARD |PURCHASE AUTHORIZED ON \d\d\/\d\d |RECURRING PAYMENT )/i;

/**
 * Any other 1-3 letter code before a "*" ("AT *SPYMUSEUM", "CC* CRUMBL KYLE", "WL *STEAM"):
 * almost always a billing company's tag, and far too short to match on by itself.
 */
const SHORT_CODE = /^[A-Z]{1,3} ?\*+ ?/i;
/** Unless what follows is generic ("ATT*BILL PAYMENT"): then the code is the better name */
const GENERIC_START = /^(BILL|BILLS|PAYMENT|PAYMENTS|PMT|PURCHASE|ONLINE|AUTOPAY|AUTO PAY|RECURRING|SUBSCRIPTION|MEMBERSHIP|FEE|FEES|ORDER|SERVICE|SERVICES)\b/i;

function stripShortCode(s: string): string {
  const rest = s.replace(SHORT_CODE, "");
  return rest === s || GENERIC_START.test(rest) ? s : rest;
}

/**
 * The bank text to suggest for a "Remember" alias: the merchant part of the description,
 * e.g. "TST*ASTRA" → "ASTRA", "SQ *ABUELITA'S BAKERY SPO" → "ABUELITA'S BAKERY SPO",
 * "NETFLIX.COM 866-579-7172 CA" → "NETFLIX.COM".
 */
export function defaultPattern(description: string): string {
  const full = description.replace(/\s+/g, " ").trim();
  let s = full;
  for (let i = 0; i < 3; i++) {
    const next = stripShortCode(s.replace(PROCESSOR_PREFIX, "")).trim();
    if (next === s) break;
    s = next;
  }
  const merchant = s.split(/ #| \d{3,}|\*/)[0].trim();
  return (merchant.length >= 3 ? merchant : full.split(/ #| \d{3,}/)[0].trim() || full).slice(0, 40);
}
