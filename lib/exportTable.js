// A "report" here is always the same shape:
//   { title, subtitle, columns: [{ key, label, align? }], rows: [{...}], totals？: {...} }
// Every report type in lib/reports.js produces this shape, so export code
// is written once instead of once per report — the alternative (bespoke
// CSV/Excel/PDF generation per report type) would mean 8 reports × 3
// formats = 24 near-duplicate functions instead of these 3.

function cellValue(row, col) {
  const v = row[col.key];
  if (v === null || v === undefined) return '';
  return v;
}

function csvEscape(val) {
  const s = String(val ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCSV(report, filename) {
  const header = report.columns.map((c) => c.label);
  const rows = report.rows.map((r) => report.columns.map((c) => cellValue(r, c)));
  const lines = [header, ...rows];
  if (report.totals) {
    lines.push(report.columns.map((c) => (c.key in report.totals ? report.totals[c.key] : '')));
  }
  const csv = lines.map((r) => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, `${filename}.csv`);
}

export async function exportExcel(report, filename) {
  const XLSX = await import('xlsx');
  const header = report.columns.map((c) => c.label);
  const rows = report.rows.map((r) => report.columns.map((c) => cellValue(r, c)));
  const data = [header, ...rows];
  if (report.totals) {
    data.push(report.columns.map((c) => (c.key in report.totals ? report.totals[c.key] : '')));
  }
  const ws = XLSX.utils.aoa_to_sheet(data);
  // Reasonable column widths so numbers/names aren't crushed on open —
  // SheetJS doesn't auto-size, and an unsized sheet looks broken.
  ws['!cols'] = report.columns.map((c) => ({ wch: Math.max(c.label.length + 2, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  triggerDownload(blob, `${filename}.xlsx`);
}

// Hand-rolled table grid — no autoTable plugin dependency. Paginates when
// rows overflow a page, repeating the header row on each new page.
export async function exportPDF(report, filename, businessName) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 36;
  const usableWidth = pageWidth - margin * 2;
  let y = margin;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text(businessName || '', margin, y);
  y += 18;
  pdf.setFontSize(12);
  pdf.text(report.title, margin, y);
  y += 16;
  if (report.subtitle) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9.5);
    pdf.setTextColor(110);
    pdf.text(report.subtitle, margin, y);
    pdf.setTextColor(0);
    y += 18;
  } else {
    y += 6;
  }

  const colWidths = distributeColumnWidths(report.columns, usableWidth);
  const rowHeight = 18;

  function drawHeader() {
    pdf.setFillColor(240, 235, 220);
    pdf.rect(margin, y, usableWidth, rowHeight, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    let x = margin;
    report.columns.forEach((c, i) => {
      pdf.text(String(c.label), x + 4, y + rowHeight - 6, { align: c.align === 'right' ? 'right' : 'left', maxWidth: colWidths[i] - 8 });
      x += colWidths[i];
    });
    y += rowHeight;
  }

  function drawRow(row, idx) {
    if (idx % 2 === 1) {
      pdf.setFillColor(250, 248, 242);
      pdf.rect(margin, y, usableWidth, rowHeight, 'F');
    }
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    let x = margin;
    report.columns.forEach((c, i) => {
      const val = String(cellValue(row, c));
      const textX = c.align === 'right' ? x + colWidths[i] - 4 : x + 4;
      pdf.text(val, textX, y + rowHeight - 6, { align: c.align === 'right' ? 'right' : 'left', maxWidth: colWidths[i] - 8 });
      x += colWidths[i];
    });
    y += rowHeight;
  }

  drawHeader();
  report.rows.forEach((row, idx) => {
    if (y + rowHeight > pageHeight - margin) {
      pdf.addPage();
      y = margin;
      drawHeader();
    }
    drawRow(row, idx);
  });

  if (report.totals) {
    if (y + rowHeight > pageHeight - margin) {
      pdf.addPage();
      y = margin;
    }
    pdf.setDrawColor(0);
    pdf.line(margin, y, margin + usableWidth, y);
    y += 2;
    pdf.setFont('helvetica', 'bold');
    let x = margin;
    report.columns.forEach((c, i) => {
      const val = c.key in report.totals ? String(report.totals[c.key]) : '';
      const textX = c.align === 'right' ? x + colWidths[i] - 4 : x + 4;
      pdf.text(val, textX, y + rowHeight - 6, { align: c.align === 'right' ? 'right' : 'left', maxWidth: colWidths[i] - 8 });
      x += colWidths[i];
    });
    y += rowHeight;
  }

  pdf.save(`${filename}.pdf`);
}

// Wider columns for text-ish fields (names, descriptions), narrower for
// short numeric/date columns — a naive even split makes names truncate
// and numbers look sparse.
function distributeColumnWidths(columns, usableWidth) {
  const weights = columns.map((c) => (c.align === 'right' ? 1 : 1.8));
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  return weights.map((w) => (w / totalWeight) * usableWidth);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
