export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseCsvRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (inQuotes) {
      current += c;
    } else if (c === ',') {
      result.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseMoney(raw: string): number | null {
  const s = (raw || '').trim().replace(/\$/g, '').replace(/,/g, '');
  if (s === '') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/** Fidelity Run Date: MM-DD-YYYY → YYYY-MM-DD */
export function parseDateMmDdYyyy(raw: string): string {
  const s = (raw || '').trim();
  if (!/^\d{2}-\d{2}-\d{4}$/.test(s)) return '';
  const [mm, dd, yyyy] = s.split('-');
  return `${yyyy}-${mm}-${dd}`;
}

export function isTicker(symbol: string | undefined): boolean {
  if (symbol == null || typeof symbol !== 'string') return false;
  const s = symbol.trim();
  return s.length > 0 && !s.includes(' ');
}

/** Bonds (e.g. CUSIP like 46656MH95) expire; treat as cash only, no position. */
export function isBond(symbol: string | undefined): boolean {
  if (symbol == null || typeof symbol !== 'string') return false;
  const s = symbol.trim();
  return /^[A-Z0-9]{9}$/i.test(s);
}

export function headerColumns(csvText: string): string[] {
  const firstLine = csvText.split(/\r?\n/).find((l) => l.trim().length > 0);
  if (!firstLine) return [];
  return parseCsvRow(firstLine).map((h) => h.replace(/^\s+|\s+$/g, ''));
}

export function colIndex(headerRow: string[], name: string): number {
  const i = headerRow.findIndex((h) => h.replace(/^\s+|\s+$/g, '') === name);
  return i >= 0 ? i : -1;
}

export function getCell(row: string[], i: number): string {
  return i >= 0 && row[i] !== undefined ? row[i] : '';
}
