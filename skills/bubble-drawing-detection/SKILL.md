---
name: bubble-drawing-detection
description: Improve or validate Bubble Drawing's local OCR, engineering dimension, tolerance, thread, and GD&T recognition. Use for detection changes, scan regressions, correction learning, or new drawing notation support; do not use it to approve inspection results or infer unspecified tolerances.
---

# Bubble Drawing Detection

Keep recognition assistive. Every captured item is a suggestion until a person reviews it against the source drawing.

## Detection workflow

1. Extract embedded PDF text first. Assemble nearby fragments on the same baseline before parsing so split values such as `12.00` and `±0.05` remain one requirement.
2. Run on-device OCR when the user enables it. Scan every requested page, preserve page coordinates, show progress, and allow stopping between OCR operations. Do not upload the drawing or recognition output.
3. Recognize explicit dimensions, tolerances, quantity prefixes, threads, GD&T feature names or supported symbols, and datum references. Store the raw captured text, its source (`PDF text` or `OCR`), and OCR confidence when available.
4. Leave missing tolerance, feature, and datum fields blank. Never derive a tolerance from decimal places or a title-block convention.
5. Deduplicate candidates by page and source-text anchor, while retaining the longest valid assembled candidate so explicit tolerances are not discarded.
6. Require review before a correction can be remembered. Apply a remembered correction only to normalized exact matches of the same captured text, and label it as remembered.

## Boundaries

- Do not claim complete drawing interpretation. OCR can miss faint, rotated, stylized, or overlapping text, and ordinary OCR is unreliable for many feature-control-frame symbols.
- Keep manual placement, editing, reordering, deletion, and export available when recognition fails.
- Preserve original PDF page size, crop box, and content. Treat rotations as per-page user edits and carry them into PDF, image, and print output.
- Keep learning data in the current session unless the owner has explicitly chosen and approved a storage design. Persistent or shared learning needs clear retention, privacy, deletion, access, and backup rules.

## Validation

Use realistic positive and negative parser cases. Verify that adjacent fragments retain explicit tolerances, unrelated drawing prose is rejected, GD&T fields remain editable, direct bubble renumbering is stable, rotated exports preserve pages, and a browser OCR run completes using only self-hosted assets.
