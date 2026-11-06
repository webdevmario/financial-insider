/**
 * Readers for PDF statements. Each reader turns a statement's text lines into
 * accounts with their transactions, and proves itself against the statement's own
 * math: every running balance and the ending balance must come out exactly.
 * A statement that doesn't reconcile is rejected whole.
 */
import type { PdfLine } from "./pdf.js";
import { bankKind, build, isoDate, money, type AccountInfo, type ParsedRow } from "./formats.js";

export interface PdfAccountSection {
  account: AccountInfo;
  periodStart: string;
  periodEnd: string;
  beginBalance: number;
  endBalance: number;
  rows: ParsedRow[];
}

export interface ParsedPdfStatement {
  format: string;
  statementDate: string | null;
  sections: PdfAccountSection[];
}

export class StatementCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatementCheckError";
  }
}

const cents = (n: number) => Math.round(n * 100);
const DATE = /^\d{2}\/\d{2}\/\d{4}$/;

// ── Ally (all deposit accounts in one statement) ──────────────────

function isAlly(lines: PdfLine[]) {
  return lines.slice(0, 40).some((l) => l.text.includes("Ally Bank")) && lines.some((l) => /^Activity$/.test(l.text));
}

/** "Spending Account" → checking; anything else keeps its own name */
function allyAccount(type: string, last4: string | null, checkingSeen: Set<string>): AccountInfo {
  const isSpending = /spending|checking/i.test(type);
  if (isSpending) {
    // The CSV export has no account number, so the first checking account is "ally-checking"
    checkingSeen.add(last4 ?? "");
    const extra = checkingSeen.size > 1 && last4 ? `-${last4}` : "";
    return { id: `ally-checking${extra}`, institution: "Ally", name: `Ally checking${extra ? ` ··${last4}` : ""}`, kind: "checking", last4 };
  }
  // "Online Savings Account" (older statements) and "Savings Account" are the same account
  const slug = /savings/i.test(type) ? "savings" : /money market/i.test(type) ? "money-market" : type.toLowerCase().replace(/ account$/, "").replace(/[^a-z]+/g, "-");
  return {
    id: `ally-${slug}${last4 ? `-${last4}` : ""}`,
    institution: "Ally",
    name: `Ally ${slug.replace("-", " ")}${last4 ? ` ··${last4}` : ""}`,
    kind: "checking",
    last4,
  };
}

function parseAlly(lines: PdfLine[]): ParsedPdfStatement {
  const statementDate =
    isoDate(lines.find((l, i) => i > 0 && lines[i - 1]?.text === "Statement Date" && DATE.test(l.text))?.text) ?? null;
  const sections: PdfAccountSection[] = [];
  const checkingSeen = new Set<string>();
  const listed: { name: string; last4: string; begin: number; end: number }[] = [];
  let summaryOpen = false;

  let current: (PdfAccountSection & { type: string; last4: string | null; balance: number | null }) | null = null;
  let pending: { date: string; type: string; amount: number; balance: number; details: { x: number; text: string }[] } | null = null;

  const flush = () => {
    if (!pending || !current) return;
    // Ally's CSV description is the main description lines (indented at the column start, not the
    // slightly indented memo line) joined with spaces, "Amount: … ~ Type: …" line included
    const main = pending.details.filter((d) => d.x < 110).map((d) => d.text);
    const memo = pending.details.filter((d) => d.x >= 110).map((d) => d.text).join(" ");
    const description = (main.join(" ") || pending.type).replace(/\s+/g, " ").trim();
    const row = build(
      { type: pending.type, description, memo, balance: pending.balance.toFixed(2) },
      {
        date: pending.date,
        postedDate: pending.date,
        amount: pending.amount,
        description,
        kind: bankKind(pending.amount, `${description} ${memo}`, pending.type),
        uniq: pending.balance.toFixed(2),
      }
    );
    if (row) current.rows.push(row);
    pending = null;
  };

  const finishSection = () => {
    flush();
    if (!current) return;
    const { type: _t, last4: _l, balance: _b, ...section } = current;
    sections.push(section);
    current = null;
  };

  for (const line of lines) {
    const first = line.cells[0];

    // Page 1 lists every account with its balances: each must turn up as a section below
    if (summaryOpen) {
      if (/^Total Account Balances/.test(first.text)) summaryOpen = false;
      else if (line.cells.length >= 4) {
        const amounts = line.cells.slice(-2).map((c) => money(c.text));
        const last4 = line.cells[1].text.replace(/\D/g, "").slice(-4);
        if (last4 && amounts.every((a) => a != null)) listed.push({ name: first.text, last4, begin: amounts[0]!, end: amounts[1]! });
      }
      continue;
    }
    if (first.text === "Account Name" || (line.cells.length >= 4 && line.cells.some((c) => c.text === "Account Number") && line.cells.some((c) => c.text === "Ending Balance"))) {
      summaryOpen = true;
      continue;
    }

    // Each account's section starts with "Summary For:"
    if (first.text === "Summary For:") {
      finishSection();
      current = {
        type: "",
        last4: null,
        balance: null,
        account: allyAccount("Account", null, new Set()),
        periodStart: "",
        periodEnd: "",
        beginBalance: NaN,
        endBalance: NaN,
        rows: [],
      };
      continue;
    }
    if (!current) {
      if (first.x < 60 && DATE.test(first.text) && line.cells.length >= 3) {
        throw new StatementCheckError(`Found transactions outside any account section (${first.text})`);
      }
      continue;
    }
    // "Type: Interest Checking" / "Type: Spending Account" / "Type: Online Savings Account"
    if (!current.type && /:$/.test(first.text) && line.cells[1] && /checking|savings|spending|money market|\bcd\b/i.test(line.cells[1].text)) {
      current.type = line.cells[1].text;
      current.account = allyAccount(current.type, current.last4, checkingSeen);
      continue;
    }

    if (first.text === "Account Number:" && line.cells[1]) {
      const last4 = line.cells[1].text.replace(/\D/g, "").slice(-4) || null;
      if (!current.last4 && last4) current.last4 = last4;
      continue;
    }
    const begin = first.text.match(/^Beginning Balance, as of (\d{2}\/\d{2}\/\d{4})$/);
    if (begin && line.cells[1]) {
      current.periodStart = isoDate(begin[1])!;
      current.beginBalance = money(line.cells[1].text) ?? NaN;
      current.balance = current.beginBalance;
      continue;
    }
    const end = first.text.match(/^Ending Balance, as of (\d{2}\/\d{2}\/\d{4})$/);
    if (end && line.cells[1]) {
      current.periodEnd = isoDate(end[1])!;
      current.endBalance = money(line.cells[1].text) ?? NaN;
      continue;
    }

    // Activity row: date, type, credit, debit, running balance
    if (first.x < 60 && DATE.test(first.text) && line.cells.length >= 3) {
      flush();
      const type = line.cells[1]?.text ?? "";
      const amounts = line.cells.slice(2).map((c) => money(c.text));
      if (/^(Beginning|Ending) Balance$/.test(type)) continue;
      if (amounts.length < 3 || amounts.some((a) => a == null)) {
        throw new StatementCheckError(`Couldn't read the amounts on a ${type || "transaction"} row dated ${first.text}`);
      }
      const [credit, debit, balance] = amounts.slice(-3) as number[];
      pending = { date: isoDate(first.text)!, type, amount: Math.round((credit + debit) * 100) / 100, balance, details: [] };
      // Running balance must follow from the previous one
      if (current.balance != null && cents(current.balance + pending.amount) !== cents(balance)) {
        throw new StatementCheckError(
          `${current.account.name}: running balance doesn't add up on ${first.text} (expected ${(current.balance + pending.amount).toFixed(2)}, statement says ${balance.toFixed(2)})`
        );
      }
      current.balance = balance;
      continue;
    }

    // Description lines under a row; anything at the left margin (headers, footers) ends it
    if (pending && first.x >= 100 && first.x <= 125) {
      pending.details.push({ x: first.x, text: line.text });
      continue;
    }
    if (pending && first.x < 60) flush();
  }
  finishSection();

  if (!sections.length) throw new StatementCheckError("No accounts found in this Ally statement");
  for (const a of listed) {
    const s = sections.find((x) => x.account.last4 === a.last4);
    if (!s) throw new StatementCheckError(`${a.name} ··${a.last4} is listed on page 1 but its transactions weren't found`);
    if (cents(s.beginBalance) !== cents(a.begin) || cents(s.endBalance) !== cents(a.end)) {
      throw new StatementCheckError(`${a.name} ··${a.last4}: balances on page 1 don't match its section`);
    }
  }
  for (const s of sections) {
    if (!s.periodStart || !s.periodEnd || Number.isNaN(s.beginBalance) || Number.isNaN(s.endBalance)) {
      throw new StatementCheckError(`${s.account.name}: couldn't find the beginning and ending balances`);
    }
    const sum = s.rows.reduce((t, r) => t + cents(r.amount), 0);
    if (cents(s.beginBalance) + sum !== cents(s.endBalance)) {
      throw new StatementCheckError(
        `${s.account.name}: transactions add up to ${((cents(s.beginBalance) + sum) / 100).toFixed(2)}, statement ends at ${s.endBalance.toFixed(2)}`
      );
    }
  }
  return { format: "ally-pdf", statementDate, sections };
}

// ── Credit cards (shared) ─────────────────────────────────────────
// Card statements list charges as positive and payments/credits as negative. Rows are
// collected in that statement sign, checked against the statement's own totals, then
// flipped to the app's sign (negative = money leaving you).

type CardSection = "payments" | "credits" | "charges" | "fees" | "interest";

interface CardLine {
  date: string;
  /** Statement sign: charge positive, payment/credit negative */
  amount: number;
  description: string;
  section: CardSection;
  member?: string | null;
  memo?: string;
  /** The statement's full text when `description` was shortened (e.g. city and state dropped) */
  statementText?: string;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** "$1.00", "-$1.00", "+$1.00", and Amex's "CR$1.00" for a credit balance */
const MONEY = /^(CR)?-?\+?-?\$?[\d,]+\.\d{2}$/;
function cardMoney(text: string): number | null {
  const t = text.replace(/\s/g, "");
  if (!MONEY.test(t)) return null;
  const n = money(t.replace(/^CR/, "").replace(/^\+/, ""));
  return n == null ? null : /^CR/.test(t) ? -n : n;
}

/** "MM/DD" → ISO, taking the year from the closing date (a December charge on a January statement keeps last year) */
function withYear(mmdd: string, closing: string): string {
  const [m, d] = mmdd.split("/");
  let y = Number(closing.slice(0, 4));
  if (`${y}-${m}-${d}` > closing) y--;
  return `${y}-${m}-${d}`;
}

const STATES = new Set(
  ("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI " +
    "AB BC MB NB NL NS ON PE QC SK").split(" ")
);
/** First words of two-word city names, so "… SAN MARCOS TX" loses both words */
const CITY_FIRST = new Set(
  ("SAN SANTA NEW LOS LAS FORT FT ST SAINT EL LA CORPUS ROUND CEDAR LEAGUE GRAND SUGAR BEE DRIPPING HORSESHOE LAKE COLLEGE CANYON " +
    "LEON DEL SALT PALM BATON KANSAS CARSON OKLAHOMA SIOUX CORAL PALO BOWLING COUNCIL PORT MOUNT MT DES BEVERLY MENLO REDWOOD " +
    "CHAPEL CHULA DALY HUNTINGTON LONG NEWPORT OVERLAND RANCHO THOUSAND WINSTON LIBERTY MARBLE JOHNSON").split(" ")
);

/**
 * Card PDFs print the merchant followed by its city and state ("H-E-B #123 SAN MARCOS TX"), where the
 * CSV export has only the merchant part. Drop the trailing city and state so both read the same.
 */
export function stripLocation(description: string): string {
  const words = description.split(" ");
  if (words.length < 3 || !STATES.has(words[words.length - 1])) return description;
  words.pop(); // state
  words.pop(); // city (or the second word of it)
  if (words.length >= 2 && CITY_FIRST.has(words[words.length - 1].toUpperCase())) words.pop();
  return words.join(" ").replace(/[\s,]+$/, "") || description;
}

function cardKind(line: CardLine): ParsedRow["kind"] {
  if (line.section === "fees") return "fee";
  if (line.section === "interest") return "interest";
  if (line.section === "payments") return "transfer";
  if (line.amount < 0) return "refund";
  return "spend";
}

/** Proves the rows against the statement's totals, then turns them into rows in the app's sign */
function cardSection(
  account: AccountInfo,
  periodStart: string,
  periodEnd: string,
  previous: number | null,
  newBalance: number | null,
  lines: CardLine[],
  totals: Partial<Record<CardSection | "paymentsAndCredits", number | null>>
): PdfAccountSection {
  if (previous == null || newBalance == null) throw new StatementCheckError(`${account.name}: couldn't find the previous and new balances`);
  const sum = (ls: CardLine[]) => ls.reduce((t, l) => t + cents(l.amount), 0);
  const check = (label: string, got: number, want: number | null | undefined) => {
    if (want == null) return;
    if (got !== cents(want)) {
      throw new StatementCheckError(`${account.name}: ${label} add up to ${(got / 100).toFixed(2)}, statement says ${want.toFixed(2)}`);
    }
  };
  const of = (...s: CardSection[]) => lines.filter((l) => s.includes(l.section));
  check("payments", sum(of("payments")), totals.payments);
  check("credits", sum(of("credits")), totals.credits);
  check("payments and credits", sum(of("payments", "credits")), totals.paymentsAndCredits);
  check("new charges", sum(of("charges")), totals.charges);
  check("fees", sum(of("fees")), totals.fees);
  check("interest", sum(of("interest")), totals.interest);
  if (cents(previous) + sum(lines) !== cents(newBalance)) {
    throw new StatementCheckError(
      `${account.name}: transactions take the balance to ${((cents(previous) + sum(lines)) / 100).toFixed(2)}, statement says ${newBalance.toFixed(2)}`
    );
  }
  const rows: ParsedRow[] = [];
  for (const l of lines) {
    const amount = -l.amount;
    const row = build(
      { section: l.section, description: l.description, statementText: l.statementText ?? l.description, memo: l.memo ?? "", member: l.member ?? "" },
      { date: l.date, amount, description: l.description, kind: cardKind(l), member: l.member ?? null }
    );
    if (row) rows.push(row);
  }
  // Statements show balances as owed; the app tracks a card's balance as negative
  return { account, periodStart, periodEnd, beginBalance: -previous, endBalance: -newBalance, rows };
}

/** First cell exactly matching `label`, with the first money amount after it on the same line (other columns may share it) */
function labelled(lines: PdfLine[], label: string | RegExp, maxX = Infinity): number | null {
  for (const l of lines) {
    const at = l.cells.findIndex((c) => c.x <= maxX && (typeof label === "string" ? c.text === label : label.test(c.text)));
    if (at < 0) continue;
    for (const c of l.cells.slice(at + 1)) {
      const n = cardMoney(c.text);
      if (n != null) return n;
    }
  }
  return null;
}

// ── Chase card ────────────────────────────────────────────────────

function isChase(lines: PdfLine[]) {
  return lines.some((l) => l.cells[0].text === "Opening/Closing Date") && lines.some((l) => /^Account Number:/.test(l.cells[0].text));
}

function parseChase(lines: PdfLine[]): ParsedPdfStatement {
  const period = lines.find((l) => l.cells[0].text === "Opening/Closing Date")?.cells[1]?.text.match(/(\d{2}\/\d{2}\/\d{2}) - (\d{2}\/\d{2}\/\d{2})/);
  if (!period) throw new StatementCheckError("Chase: couldn't find the statement period");
  const [periodStart, periodEnd] = [isoDate(period[1])!, isoDate(period[2])!];
  const last4 = lines.find((l) => /^Account Number:/.test(l.cells[0].text))?.text.replace(/\D/g, "").slice(-4) || null;
  const account: AccountInfo = {
    id: last4 ? `chase-${last4}` : "chase-card",
    institution: "Chase",
    name: last4 ? `Chase card ··${last4}` : "Chase card",
    kind: "credit",
    last4,
  };

  const out: CardLine[] = [];
  let section: CardSection | null = null;
  let last: CardLine | null = null;
  for (const l of lines) {
    const first = l.cells[0];
    const head = l.text.toUpperCase();
    if (first.x < 40 && /^[A-Z &]+$/.test(l.text.trim())) {
      if (/PAYMENTS AND OTHER CREDITS/.test(head)) section = "payments";
      else if (/^(PURCHASES?|CASH ADVANCES?|BALANCE TRANSFERS?)$/.test(head)) section = "charges";
      else if (/^FEES CHARGED$/.test(head)) section = "fees";
      else if (/^INTEREST CHARGED$/.test(head)) section = "interest";
      last = null;
      continue;
    }
    if (/Totals Year-to-Date/.test(l.text)) section = null;
    if (!section) continue;
    const end = l.cells[l.cells.length - 1];
    if (/^\d{2}\/\d{2}$/.test(first.text) && first.x < 45 && l.cells.length >= 3 && end.x > 400 && MONEY.test(end.text)) {
      const amount = cardMoney(end.text)!;
      const text = l.cells.slice(1, -1).map((c) => c.text).join(" ").replace(/\s+/g, " ").trim();
      // Card credits other than payments (returns, statement credits) are refunds
      const s: CardSection = section === "payments" && !/payment/i.test(text) ? "credits" : section;
      const description = s === "payments" ? text : stripLocation(text);
      last = { date: withYear(first.text, periodEnd), amount, description, section: s, statementText: text };
      out.push(last);
      continue;
    }
    // "Order Number …" and similar lines belong to the row above
    if (last && first.x > 100 && first.x < 130 && l.cells.length <= 3) last.memo = [last.memo, l.text].filter(Boolean).join(" ");
    else last = null;
  }

  const paymentsAndCredits = labelled(lines, "Payment, Credits", 60);
  const charges = [labelled(lines, "Purchases", 60), labelled(lines, "Cash Advances", 60), labelled(lines, "Balance Transfers", 60)];
  return {
    format: "chase-pdf",
    statementDate: periodEnd,
    sections: [
      cardSection(account, periodStart, periodEnd, labelled(lines, "Previous Balance", 60), labelled(lines, "New Balance", 60), out, {
        paymentsAndCredits,
        charges: charges.some((c) => c == null) ? null : charges.reduce((t, c) => t! + c!, 0),
        fees: labelled(lines, "Fees Charged", 60),
        interest: labelled(lines, "Interest Charged", 60),
      }),
    ],
  };
}

// ── Apple Card ────────────────────────────────────────────────────

function isApple(lines: PdfLine[]) {
  return lines.slice(0, 20).some((l) => /Apple Card/.test(l.text)) && lines.some((l) => /Daily Cash/.test(l.text));
}

/** "Jul 1 — Jul 31, 2025" or "Dec 1, 2024 — Dec 31, 2024" */
function applePeriod(lines: PdfLine[]): [string, string] | null {
  for (const l of lines.slice(0, 10)) {
    for (const c of l.cells) {
      const m = c.text.match(/^([A-Z][a-z]{2}) (\d{1,2})(?:, (\d{4}))? — ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
      if (!m) continue;
      const iso = (mon: string, d: string, y: string) => `${y}-${String(MONTHS.indexOf(mon.toLowerCase()) + 1).padStart(2, "0")}-${d.padStart(2, "0")}`;
      const endY = m[6];
      let startY = m[3] ?? endY;
      if (!m[3] && MONTHS.indexOf(m[1].toLowerCase()) > MONTHS.indexOf(m[4].toLowerCase())) startY = String(Number(endY) - 1);
      return [iso(m[1], m[2], startY), iso(m[4], m[5], endY)];
    }
  }
  return null;
}

/** Amount printed under a label (2019 statements put the figure on the next line) */
function below(lines: PdfLine[], label: RegExp): number | null {
  for (let i = 0; i < lines.length; i++) {
    const cell = lines[i].cells.find((c) => label.test(c.text));
    if (!cell) continue;
    for (const next of lines.slice(i + 1, i + 4)) {
      const hit = next.cells.find((c) => Math.abs(c.x - cell.x) < 12 && MONEY.test(c.text));
      if (hit) return cardMoney(hit.text);
    }
  }
  return null;
}

/** The very first statement has no previous balance at all */
function firstStatement(lines: PdfLine[]) {
  return !lines.some((l) => l.cells.some((c) => /statement balance$|Total Balance$/i.test(c.text) && !/^Total Balance$/.test(c.text)));
}

function parseApple(lines: PdfLine[]): ParsedPdfStatement {
  const period = applePeriod(lines);
  if (!period) throw new StatementCheckError("Apple Card: couldn't find the statement period");
  const [periodStart, periodEnd] = period;
  const account: AccountInfo = { id: "apple-card", institution: "Apple", name: "Apple Card", kind: "credit", last4: null };

  const out: CardLine[] = [];
  let section: CardSection | null = null;
  let lastDate: string | null = null;
  for (const l of lines) {
    const first = l.cells[0];
    if (l.cells.length === 1 && first.x < 45) {
      if (first.text === "Payments") section = "payments";
      else if (first.text === "Transactions") section = "charges";
      else if (first.text === "Interest Charged") section = "interest";
      else if (/^(Daily Cash|Interest Charges)$/.test(first.text)) section = null;
      continue;
    }
    if (!section) continue;
    const end = l.cells[l.cells.length - 1];
    if (end.x < 500 || !MONEY.test(end.text)) continue;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(first.text) && first.x < 60) {
      // Daily Cash columns (percent and cash amount) sit between the description and the amount
      const description = l.cells.slice(1, -1).filter((c) => c.x < 400).map((c) => c.text).join(" ").replace(/\s+/g, " ").trim();
      const amount = cardMoney(end.text)!;
      lastDate = isoDate(first.text)!;
      out.push({ date: lastDate, amount, description, section });
    } else if (section === "charges" && lastDate && first.x > 90 && first.x < 130 && /Daily Cash Adjustment/i.test(first.text)) {
      // Returning a purchase takes back its Daily Cash: an undated line under the return
      out.push({ date: lastDate, amount: cardMoney(end.text)!, description: first.text.toUpperCase(), section: "charges" });
    } else if (section === "interest" && /^[—–-]$|^\d{2}\/\d{2}\/\d{4}$/.test(first.text) && cardMoney(end.text)) {
      // Interest has no transaction date; it posts at the end of the period
      out.push({ date: periodEnd, amount: cardMoney(end.text)!, description: "INTEREST CHARGE", section: "interest" });
    }
  }

  return {
    format: "apple-pdf",
    statementDate: periodEnd,
    sections: [
      cardSection(account, periodStart, periodEnd, 
        labelled(lines, /^[A-Z][a-z]+ Total Balance$/) ?? below(lines, /statement balance$/i) ?? (firstStatement(lines) ? 0 : null),
        labelled(lines, "Total Balance") ?? below(lines, /^[A-Z][a-z]+ Balance as of [A-Z][a-z]{2} \d{1,2}, \d{4}$/), out, {
        payments: labelled(lines, "Total payments for this period"),
        charges: labelled(lines, /^Total charges, credits and returns/),
        interest: labelled(lines, /^Total interest for this period/),
      }),
    ],
  };
}

// ── American Express ──────────────────────────────────────────────

function isAmex(lines: PdfLine[]) {
  return lines.slice(0, 10).some((l) => /^Closing Date \d{2}\/\d{2}\/\d{2}$/.test(l.cells[0].text)) && lines.some((l) => /^Account Ending/.test(l.text));
}

function parseAmex(lines: PdfLine[]): ParsedPdfStatement {
  const closingCell = lines.find((l) => /^Closing Date \d{2}\/\d{2}\/\d{2}$/.test(l.cells[0].text))!.cells[0].text;
  const periodEnd = isoDate(closingCell.replace("Closing Date ", ""))!;
  const ending = lines.map((l) => l.text.match(/Account Ending \d*-?(\d{4,5})/)?.[1]).find(Boolean) ?? null;
  const account: AccountInfo = { id: ending ? `amex-${ending}` : "amex", institution: "Amex", name: ending ? `Amex ··${ending}` : "Amex", kind: "credit", last4: ending };

  const out: CardLine[] = [];
  let section: CardSection | null = null;
  let member: string | null = null;
  let prevText = "";
  for (const l of lines) {
    const first = l.cells[0];
    // Section headings stand alone, or with only the "Amount" column heading beside them
    if (first.x < 70 && l.cells.slice(1).every((c) => c.text === "Amount")) {
      const t = first.text.replace(/ Details$/, "");
      if (t === "Payments") section = "payments";
      else if (t === "Credits") section = "credits";
      else if (t === "New Charges") section = "charges";
      else if (t === "Fees") section = "fees";
      else if (t === "Interest Charged") section = "interest";
      else if (/Fees and Interest Totals Year-to-Date|Interest Charge Calculation/.test(t)) section = null;
    }
    // "<Card member name>" then "Card Ending 9-99999" heads each card member's charges
    if (/^Card Ending/.test(first.text)) member = prevText || member;
    prevText = l.cells.length === 1 && first.x < 120 ? first.text : "";
    if (!section) continue;

    const end = l.cells[l.cells.length - 1];
    const m = first.text.match(/^(\d{2}\/\d{2}\/\d{2})\*?$/);
    if (!m || first.x > 70 || l.cells.length < 3 || end.x < 450 || !MONEY.test(end.text)) continue;
    const middle = l.cells.slice(1, -1);
    let rowMember = member;
    // Payment rows carry the card member in their own column before the description
    if (section === "payments" || section === "credits") {
      if (middle.length >= 2 && middle[0].x < 150 && middle[1].x >= 180) rowMember = middle.shift()!.text;
    }
    const description = middle.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim();
    const amount = cardMoney(end.text)!;
    out.push({ date: isoDate(m[1])!, amount, description, section, member: rowMember });
  }

  const prev = labelled(lines, "Previous Balance");
  const fees = labelled(lines, "Total Fees for this Period");
  const interest = labelled(lines, "Total Interest Charged for this Period");
  // Period start: the day after last statement's closing, roughly a month back
  const start = new Date(`${periodEnd}T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - 1);
  start.setUTCDate(start.getUTCDate() + 1);
  return {
    format: "amex-pdf",
    statementDate: periodEnd,
    sections: [
      cardSection(account, start.toISOString().slice(0, 10), periodEnd, prev, labelled(lines, "New Balance"), out, {
        paymentsAndCredits: labelled(lines, "Total Payments and Credits"),
        charges: labelled(lines, "Total New Charges"),
        fees,
        interest,
      }),
    ],
  };
}

// ── Dispatch ──────────────────────────────────────────────────────

const READERS: { id: string; matches: (lines: PdfLine[]) => boolean; parse: (lines: PdfLine[]) => ParsedPdfStatement }[] = [
  { id: "ally-pdf", matches: isAlly, parse: parseAlly },
  { id: "chase-pdf", matches: isChase, parse: parseChase },
  { id: "apple-pdf", matches: isApple, parse: parseApple },
  { id: "amex-pdf", matches: isAmex, parse: parseAmex },
];

export class UnrecognizedPdfError extends Error {
  constructor() {
    super("Not a statement this app can read yet (supported PDFs: Ally, Chase, Apple Card, Amex)");
    this.name = "UnrecognizedPdfError";
  }
}

export function parsePdfStatement(lines: PdfLine[]): ParsedPdfStatement {
  const reader = READERS.find((r) => r.matches(lines));
  if (!reader) throw new UnrecognizedPdfError();
  return reader.parse(lines);
}
