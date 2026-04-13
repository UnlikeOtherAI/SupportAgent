# Claude Code — project context
@./AGENTS.md

## Read First

Read these before meaningful work:

- `./AGENTS.md`
- `./docs/brief.md`
- `./docs/techstack.md`
- `./docs/skills/README.md`

## Claude-specific Notes

- Keep instructions modular and prefer progressive disclosure.
- Prefer single-responsibility functions.
- When a method mixes concerns, split it before adding more logic if that reduces complexity.
- After each turn that involves code or file changes, commit and push before responding.

## Debugging Protocol

- Always check logs first before browser automation or source spelunking.
- Prefer evidence from logs, job records, and artifacts over guesses.
- Never manually mutate run state or delivery state to fake recovery.

## UI Implementation Notes

- The admin panel is CSR React only.
- Tailwind is the styling system.
- Use the local skill notes in `docs/skills/` when building architecture or UI.
