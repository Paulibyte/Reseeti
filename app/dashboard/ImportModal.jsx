'use client';

import { useState } from 'react';
import { parseSpreadsheetFile, downloadTemplate } from '../../lib/importParse';

// One shared modal for both Inventory's product import and Customers'
// import — the two only differ in which columns are expected and how a
// row becomes an insert payload, both passed in as props, so the actual
// upload → parse → preview → confirm → insert flow only exists once.
export default function ImportModal({ title, columns, table, business, supabase, onClose, onImported }) {
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const requiredKeys = columns.filter((c) => c.required).map((c) => c.key);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setResult(null);
    setFileName(file.name);
    try {
      const parsed = await parseSpreadsheetFile(file);
      if (parsed.length === 0) {
        setError('That file has no rows.');
        return;
      }
      if (parsed.length > 1000) {
        setError('That file has more than 1,000 rows — split it into smaller batches.');
        return;
      }
      setRows(parsed);
    } catch {
      setError('Could not read that file — make sure it\'s a valid CSV or Excel file.');
    }
  }

  // Row-level validation surfaced before anything is inserted, so a
  // mistake (a missing required column, a non-numeric price) is
  // something to fix in the source file, not something discovered only
  // after 40 of 50 rows already imported.
  const validation = rows?.map((row, i) => {
    const missing = requiredKeys.filter((k) => !String(row[k] ?? '').trim());
    return { row, index: i, valid: missing.length === 0, missing };
  }) || [];
  const validCount = validation.filter((v) => v.valid).length;

  async function runImport() {
    setImporting(true);
    setError('');
    const validRows = validation.filter((v) => v.valid).map((v) => v.row);
    const payloads = validRows.map((row) => ({
      payload: columns.reduce((acc, c) => {
        acc[c.dbField || c.key] = c.transform ? c.transform(row[c.key]) : (row[c.key] || null);
        return acc;
      }, { business_id: business.id }),
      // Kept alongside the payload purely so a failed row can be
      // reported back using something the person actually recognizes
      // from their own file, not the raw database payload.
      sourceRow: row,
    }));

    let inserted = 0;
    const errors = [];
    // Inserted in small batches rather than one giant insert — keeps
    // each request a reasonable size. A batch insert is atomic though:
    // one bad row in it (e.g. referencing something that doesn't exist)
    // fails the WHOLE batch, silently taking every other good row in it
    // down too. The per-row fallback below only ever runs when a batch
    // has already failed — a fully successful import never pays the
    // extra cost of inserting one row at a time at all.
    const BATCH_SIZE = 50;
    for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
      const batch = payloads.slice(i, i + BATCH_SIZE);
      const { error: err, count } = await supabase.from(table).insert(batch.map((b) => b.payload), { count: 'exact' });
      if (!err) {
        inserted += count || batch.length;
        continue;
      }
      for (const item of batch) {
        const { error: rowErr } = await supabase.from(table).insert(item.payload);
        if (rowErr) {
          const label = item.sourceRow[columns[0].key] || 'a row';
          errors.push(`${label}: ${rowErr.message}`);
        } else {
          inserted += 1;
        }
      }
    }

    setImporting(false);
    setResult({ inserted, skipped: validation.length - validCount, errors });
    if (inserted > 0) onImported();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 520, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0 }}>{title}</h3>

        {result ? (
          <>
            <p style={{ fontSize: 14, color: 'var(--text)' }}>
              ✅ Imported {result.inserted} row{result.inserted === 1 ? '' : 's'}.
              {result.skipped > 0 && ` Skipped ${result.skipped} row${result.skipped === 1 ? '' : 's'} missing required fields.`}
            </p>
            {result.errors.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <p style={{ fontSize: 12.5, color: 'var(--danger)', fontWeight: 700, margin: '0 0 4px' }}>
                  {result.errors.length} row{result.errors.length === 1 ? '' : 's'} couldn't be saved:
                </p>
                {result.errors.slice(0, 10).map((msg, i) => (
                  <p key={i} style={{ fontSize: 12, color: 'var(--danger)', margin: '0 0 2px' }}>{msg}</p>
                ))}
                {result.errors.length > 10 && (
                  <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '4px 0 0' }}>…and {result.errors.length - 10} more.</p>
                )}
              </div>
            )}
            <button onClick={onClose} style={primaryBtnStyle}>Done</button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => downloadTemplate(columns, `${title.replace(/\s+/g, '-').toLowerCase()}-template.xlsx`)}
              style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 6, padding: '7px 12px', fontSize: 12, cursor: 'pointer', marginBottom: 14 }}
            >
              Download template
            </button>

            <label style={{ display: 'block', border: '1.5px dashed var(--border)', borderRadius: 8, padding: 20, textAlign: 'center', cursor: 'pointer', marginBottom: 14 }}>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} style={{ display: 'none' }} />
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {fileName || 'Click to choose a CSV or Excel file'}
              </span>
            </label>

            {error && <p style={{ color: 'var(--danger)', fontSize: 12.5, marginBottom: 10 }}>{error}</p>}

            {rows && (
              <>
                <p style={{ fontSize: 13, color: 'var(--text)', marginBottom: 10 }}>
                  {validCount} of {rows.length} row{rows.length === 1 ? '' : 's'} ready to import
                  {validCount < rows.length && ` (${rows.length - validCount} missing a required field)`}.
                </p>
                <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 14 }}>
                  {validation.slice(0, 20).map((v) => (
                    <div key={v.index} style={{ padding: '6px 10px', fontSize: 11.5, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', color: v.valid ? 'var(--text)' : 'var(--danger)' }}>
                      <span>{v.row[columns[0].key] || `Row ${v.index + 1}`}</span>
                      <span>{v.valid ? '✓' : `missing: ${v.missing.join(', ')}`}</span>
                    </div>
                  ))}
                  {rows.length > 20 && (
                    <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-faint)' }}>…and {rows.length - 20} more</div>
                  )}
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={runImport} disabled={!rows || validCount === 0 || importing} style={primaryBtnStyle}>
                {importing ? 'Importing…' : `Import ${validCount || ''} row${validCount === 1 ? '' : 's'}`}
              </button>
              <button onClick={onClose} style={secondaryBtnStyle}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const primaryBtnStyle = {
  background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 18px',
  fontSize: 13.5, fontWeight: 700, cursor: 'pointer', flex: 1,
};
const secondaryBtnStyle = {
  background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '10px 18px',
  fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
};
