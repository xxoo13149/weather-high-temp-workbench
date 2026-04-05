# Targeted Home/Analysis Fixes

- Date: 2026-04-03 02:39:21 Asia/Shanghai
- Scope: homepage summary translation, predictability dots, hourly rail fields/wind glyphs, viewport/layout fit, analysis image/models visibility

## Changes
- Repaired the route-first frontend shell and cleaned broken UTF-8/JSX in the rebuilt home and analysis workspace components.
- Restored predictability dots below the summary line and kept hourly rail interactions while tightening the visual treatment.
- Preserved exact 1h data semantics: no interpolation, no fake 3h backfill, real parsed fields only.
- Updated meteoblue week parsing so unmatched report sentences fall back to a pure Chinese metric summary instead of mixed-language output.
- Strengthened 1h parsing for feels-like rows, wind direction extraction, and precipitation probability extraction from real table content.
- Updated regression tests for report fallback behavior and true 1h field parsing.

## Validation
- npm run test: passed
- npm run check: passed
- npm run build: passed

## Notes
- Snapshots used before edits:
  - D:/weather/tmp-snapshot--home-analysis-fixes
  - D:/weather/tmp-snapshot-20260403012239_targeted-home-analysis-fixes
