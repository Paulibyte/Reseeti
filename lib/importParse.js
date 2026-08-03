'use client';

// Reuses the `xlsx` (SheetJS) package already in this project for
// Excel/CSV report exports — it reads both formats too, so bulk import
// doesn't need a second, import-specific parsing library.
export async function parseSpreadsheetFile(file) {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  // defval: '' — without it, a blank cell is simply omitted from the row
  // object entirely rather than present with an empty value, which
  // makes "is this column present but blank" vs. "does this row even
  // have this field" indistinguishable for the validation step that
  // follows.
  return XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
}

// Builds a downloadable template file for a given import type — the
// header row alone, plus one example row, so someone knows the expected
// column names without having to guess or reverse-engineer them from an
// error message after a failed import.
export async function downloadTemplate(columns, filename) {
  const XLSX = await import('xlsx');
  const headerRow = columns.map((c) => c.key);
  const exampleRow = columns.map((c) => c.example ?? '');
  const sheet = XLSX.utils.aoa_to_sheet([headerRow, exampleRow]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Template');
  XLSX.writeFile(workbook, filename);
}
