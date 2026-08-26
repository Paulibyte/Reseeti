// Generates a PDF from a rendered DOM node by screenshotting it
// (html2canvas) and embedding that image in a PDF (jsPDF) — the same
// approach the receipt's "Download PDF" button has always used. Pulled
// out into its own function so Email Invoice can reuse the exact same
// rendering instead of maintaining a second PDF layout that could drift
// out of sync with what the receipt actually looks like.
//
// html2canvas/jsPDF are imported statically here, not via a dynamic
// import() — they used to be loaded on-demand as their own separate JS
// chunk, fetched only the moment someone actually clicked Download. On
// a device that had never done that specific click while online (very
// easy to hit right after a rebuild, since Next.js renames these chunk
// files on every build), there was nothing for the service worker's
// cache to serve when the click happened offline, and the whole feature
// failed outright. A static import bundles both libraries into whatever
// chunk this file's callers (OfflineDraftReceipt.jsx, the receipt page,
// Reports) already need just to render at all — so if those pages can
// load offline, so can these libraries, with no separate fetch to miss.
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export async function renderElementToPDFBlob(el) {
  if (document.fonts?.ready) await document.fonts.ready;
  // html2canvas needs a real, resolved color here — it can't parse a
  // CSS custom property string like "var(--surface)" itself, and throws
  // ("unsupported color function 'var'") if handed one directly. This
  // resolves it to whatever --surface actually currently computes to
  // (respecting dark mode, since that's driven by the same variable),
  // falling back to white only if the variable somehow isn't set at all.
  const resolvedBg = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#ffffff';
  const canvas = await html2canvas(el, {
    backgroundColor: resolvedBg,
    scale: 2,
    useCORS: true,
    width: el.offsetWidth,
    height: el.offsetHeight,
    windowWidth: el.offsetWidth,
    windowHeight: el.offsetHeight,
    x: 0,
    y: 0,
    scrollX: 0,
    scrollY: 0,
    ignoreElements: (element) => element.hasAttribute('data-html2canvas-ignore'),
  });
  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF({ unit: 'pt', format: [canvas.width / 2, canvas.height / 2] });
  pdf.addImage(imgData, 'PNG', 0, 0, canvas.width / 2, canvas.height / 2);
  return pdf.output('blob');
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
