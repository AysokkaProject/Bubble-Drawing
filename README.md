# Bubble Drawing

A browser-based engineering PDF annotation workspace, converted from the original Python desktop prototype. The original Python files remain available for reference.

## Use

1. Open a PDF (up to 50 MB, 300 pages), or try the included two-page sample.
2. Choose **Add bubble** and click on the drawing. Drag a bubble to move it, or focus it and use the arrow keys (Shift for larger steps).
3. Select a bubble in the register to enter its requirement, nominal value, explicit tolerance, feature/GD&T, datums and notes. Mark it reviewed after checking the source.
4. **Scan dimensions** scans the current page or the full document. It combines embedded PDF text with optional on-device English OCR and records the source and OCR confidence. Suggestions are not engineering verification and can miss faint or rotated text and complex feature-control frames.
5. Enter a bubble number directly or use the up/down controls to reorder it. Numbers remain sequential across all pages.
6. Rotate individual pages, zoom the workspace, and print at 10–200% drawing scale. Rotation is carried into exports.
7. Download the annotated PDF, inspection CSV, PNG/JPEG page, or a ZIP of all pages. Edits exist only in the current browser session; there is no server storage.
8. A reviewed OCR/PDF-text result can be remembered as a correction for identical captured text later in the same session.

## Privacy and exports

All PDF parsing, OCR, annotation and export run locally in the browser. Libraries, fonts, OCR engine and English model are self-hosted. Drawings and corrections are not uploaded to a backend. Password-protected PDFs need an unlocked copy. PDF export preserves original pages, page sizes and crop boxes and applies chosen rotation; modifying a signed PDF may invalidate its signature. Tolerances are never inferred from decimal places. CSV text is escaped to protect against spreadsheet formula injection.

## Build and deploy

Requires a current Node.js version for the build only. No package install is needed.

```sh
node scripts/build.mjs
node --test tests/*.test.mjs
```

Serve `web/` with any local HTTP server for development. Do not open index.html as a file URL: module imports and the PDF worker require HTTP.

Import this GitHub repository into Vercel. The committed `vercel.json` sets the build command and `dist` output directory. No environment variables, paid services or API keys are required.

## Libraries

- PDF.js 5.6.205 (Apache-2.0): renderer and text extraction, including fonts, character maps and decoder assets.
- pdf-lib 1.17.1 (MIT): PDF generation and annotation export.
- Tesseract.js 7.0.0 with English trained data: local OCR for scanned drawing content.
- JSZip: all-page image export.

Pinned browser distributions and license files are in `web/vendor/`. Optional WebMCP tools expose reading and editing the current register in supporting browsers; unsupported browsers use the normal UI. The reusable detection instructions are in `skills/bubble-drawing-detection/SKILL.md`.
