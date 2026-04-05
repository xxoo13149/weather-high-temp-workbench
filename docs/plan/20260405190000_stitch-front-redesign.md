# Stitch Front Redesign Workflow

This project uses Stitch only as a local concept-generation assistant.

## Rules

- Do not expose `STITCH_API_KEY` to the browser.
- Do not add Stitch to runtime request paths.
- Do not use Stitch output as production code without manual integration.
- Keep the first exploration pass broad and style-open.
- Limit refinement to one directed follow-up pass after a human review.

## Environment

Add this locally:

```bash
STITCH_API_KEY=...
```

## Commands

First-pass exploration:

```bash
npm run stitch:explore
```

With a custom brief:

```bash
npm run stitch:explore -- --brief docs/plan/your-brief.md --variants 5 --range REIMAGINE
```

Directed refinement:

```bash
npm run stitch:refine -- --projectId <projectId> --screenId <screenId> --prompt "Keep the homepage airy but make the analysis page denser."
```

## Output

Artifacts are written under `docs/stitch/` as JSON files containing Stitch HTML and screenshot URLs.

The integration rule is:

1. Review the generated directions.
2. Choose one or mix multiple ideas.
3. Rebuild by hand inside the existing React + Vite frontend.

## Recommended Brief Shape

- Preserve homepage and analysis workspace.
- Preserve all real data connectivity.
- Preserve multi-location switching, favorites, refresh, official image tab, full ranking, sticky model inspector, and the 24-hour timeline.
- Homepage should optimize for judging the day's highest temperature.
- Analysis should optimize for dense comparison and confidence-building.
- Decoration must stay subordinate to data.
