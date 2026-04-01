# Skill: Tailwind UI Implementation

## Purpose

Use this when building the admin interface with Tailwind. Favor predictable layouts, explicit classes, and accessible interactions.

## Core Rules

- Do not generate Tailwind class names dynamically.
- Use complete class names in source.
- Prefer utilities over custom CSS.
- Extract repeated UI patterns into components before reaching for custom abstractions.
- Keep motion limited to `opacity` and `transform` where possible.

## Admin Layout Rules

- mobile: off-canvas sidebar with backdrop
- desktop: persistent sidebar and stable content area
- top bar stays simple and functional
- prioritize readability and operator speed over decorative UI

## Accessibility Rules

- visible focus states are mandatory
- avoid hover-only interactions
- respect reduced motion preferences
- make click targets large enough for reliable use

## Performance Rules

- avoid large `@apply` blocks
- avoid arbitrary values unless they are clearly justified
- avoid heavy shadows and excessive visual effects
- keep layout transitions stable; do not animate width and height unless unavoidable

## Styling Direction

- use one design language consistently
- keep the admin visual system restrained and operational
- use Tailwind tokens and shared component variants rather than one-off styling
