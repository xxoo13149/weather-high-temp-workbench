# Stitch First-Pass Exploration Brief

## Goal

Explore several clearly different frontend design directions for a weather decision product.

The product already exists. This is not a blank-slate product ideation task.
Keep the real information architecture, real data connections, and core interaction model intact.

## Product Context

This product helps users judge the day's highest temperature with higher confidence.

It has two main surfaces:

1. Homepage
   - A focused decision entrypoint for judging the day quickly
   - Faster, more readable, more selective about what deserves visual emphasis
2. Analysis workspace
   - A denser professional workbench for comparison and confidence building
   - Higher information density, but still readable and structured

Both surfaces should feel like one design system with different density, not two unrelated products.

## Non-Negotiable Structure

Preserve all of these:

- Homepage and analysis workspace as the two main layers
- `models` and `image` as the two analysis tabs
- Multi-location switching
- Favorites
- Refresh
- 24-hour weather track
- Full model ranking
- Sticky model profile / inspector
- Official weather image tab

Do not invent fake modules, fake insights, or unsupported data.
Do not change the routing or backend contract in the design proposal.

## Functional Priorities

### Homepage

The homepage should prioritize:

- The original-source Chinese weather narrative or translated narrative summary
- The 24-hour track as a central working surface
- Fast multi-model judgment support
- Strong support for understanding the likely daily peak temperature window

The homepage should de-emphasize or remove low-value noise.

### Analysis Workspace

The analysis workspace should prioritize:

- Full model ranking as the main path
- Sticky model inspector as the immediate comparison companion
- Compact distribution modules above the ranking as auxiliary filters
- Clear hover and lock behavior
- Dense information without visual chaos

The right-side model profile should feel immediate and useful, not buried below the fold.

## Interaction Constraints

Keep these interaction expectations visible in the concept:

- In the 24-hour track, `Now` and `Peak` shortcuts remain available
- The 24-hour track supports direct hour selection and drag navigation
- Hover must not cause layout jitter or reflow
- The track should not feel like a row of repetitive boxes
- The analysis ranking should react to hover immediately
- The sticky inspector should update on hover and support click lock
- Distribution modules should feel compact by default and expand without pushing the whole page down

## Visual Guidance

Do not force a predefined style bucket.
Please explore multiple clearly different visual directions freely.

However, all directions must respect:

- Data over decoration
- Confidence over novelty
- Premium and intentional, not generic dashboard card soup
- Background atmosphere is allowed, but must stay low-interference
- The product should feel serious enough for repeated daily use
- The interface should help decision-making, not compete with it

## Deliverables

Generate 3 to 5 distinct concept candidates.

Each candidate should include:

- Homepage concept
- Analysis workspace concept
- A consistent shared design language across both

Differences between candidates should be obvious in composition, hierarchy, typography, density, and mood.
They should still remain believable as production-minded product directions.
