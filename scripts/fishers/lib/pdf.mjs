import { spawn } from 'node:child_process';

/**
 * Extract text from a PDF by shelling out to poppler's `pdftotext`.
 *
 * The previous pdf-parse path relied on pdf.js internals (DOMMatrix,
 * process.getBuiltinModule) that are unavailable under this Node 18 runtime, so
 * it silently returned empty text for every scanned/uploaded PDF. `pdftotext`
 * is a native, dependency-free extractor that works headless. Install with
 * `brew install poppler` (provides /opt/homebrew/bin/pdftotext).
 */
export async function pdfToText(bytes) {
  return new Promise((resolve) => {
    let proc;
    try {
      // `-layout` keeps columns readable; read PDF from stdin, write text to stdout.
      proc = spawn('pdftotext', ['-layout', '-nopgbrk', '-', '-']);
    } catch (error) {
      resolve({ text: '', pages: null, error: `pdftotext unavailable: ${error.message}` });
      return;
    }
    const out = [];
    const err = [];
    proc.stdout.on('data', (d) => out.push(d));
    proc.stderr.on('data', (d) => err.push(d));
    proc.on('error', (error) => resolve({ text: '', pages: null, error: `pdftotext spawn failed: ${error.message}` }));
    proc.on('close', (code) => {
      const text = Buffer.concat(out).toString('utf8').trim();
      if (code === 0 || text) resolve({ text, pages: null });
      else resolve({ text: '', pages: null, error: `pdftotext exit ${code}: ${Buffer.concat(err).toString('utf8').slice(0, 200)}` });
    });
    proc.stdin.on('error', () => {});
    proc.stdin.write(bytes);
    proc.stdin.end();
  });
}
