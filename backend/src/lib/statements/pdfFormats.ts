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

// ── Dispatch ──────────────────────────────────────────────────────

const READERS: { id: string; matches: (lines: PdfLine[]) => boolean; parse: (lines: PdfLine[]) => ParsedPdfStatement }[] = [
  { id: "ally-pdf", matches: isAlly, parse: parseAlly },
];

export class UnrecognizedPdfError extends Error {
  constructor() {
    super("Not a statement this app can read yet (supported PDFs: Ally)");
    this.name = "UnrecognizedPdfError";
  }
}

export function parsePdfStatement(lines: PdfLine[]): ParsedPdfStatement {
  const reader = READERS.find((r) => r.matches(lines));
  if (!reader) throw new UnrecognizedPdfError();
  return reader.parse(lines);
}
