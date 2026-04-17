# Target Triage Output Format

This is the target shape for the finding comment posted back on a triaged GitHub issue. The triage worker prompt should produce output matching this structure.

## Required sections (in order)

1. **Summary** — one short paragraph naming the error, where it surfaced, and how it was captured.
2. **Root Cause** — the specific code path with a quoted snippet (file + lines) and the chain of conditions that cause it.
3. **Replication Steps** — a numbered list that a developer can follow to reproduce.
4. **Suggested Fix** — one or more numbered remediations with code examples. Distinguish primary fix from defensive guards.
5. **Severity** — `Low` | `Medium` | `High` | `Critical` with a one-line justification.
6. **Confidence** — `Low` | `Medium` | `High` with the main reason for uncertainty.
7. **Affected Files** — bullet list of file paths that the fix should touch or where relevant context lives.
8. **Logs Excerpt** — the real log or telemetry extract used for the investigation (if any).
9. **Sources** — bullet list of all files or artifacts the investigator read.

## Worked example

> Taken from the 2026-04-17 brief. Stored verbatim so the prompt can be trained against it.

### Summary

A single OnboardingRequiredError with message "Missing local application data. User probably signed off." was reported to Sentry on 2026-03-05 at 08:16:46 UTC by the POS web application. The error originated from an RxJS map operator inside the useApplicationDevice hook when the local IndexedDB document (application_device) was found to be null. The error propagated to Sentry via the custom ErrorBoundary.componentDidCatch → captureException path, but was marked unhandled — likely because the error escaped the nearest ErrorBoundary at an unexpected render phase, or was thrown from inside a TanStack Query async callback whose rejection path bypassed the normal React error-dispatch chain.

### Root Cause

The error is thrown deliberately as a control-flow signal inside `applicationDevice.ts` (lines 50–53):

```ts
map((item) => {
    if (item === null) {
        throw new OnboardingRequiredError(
            'Missing local application data. User probably signed off.',
        )
    }
    return item
})
```

`item` is the result of `collections.application_device.findOne().$` — an RxDB observable over IndexedDB. When `item === null`, the document is absent from the local DB. This condition occurs when the user explicitly signed out, the session was terminated externally, a flag disabled the clear-database-on-sign-out path, or a second browser tab signed out.

### Replication Steps

1. Open the POS web app in one browser tab and log in.
2. Sign out from the same account in a second browser tab (or via the native app).
3. Wait up to 20 seconds for the TanStack Query refetch.
4. The observable emits `null`; the `map` operator throws `OnboardingRequiredError`.
5. Sentry receives the event as unhandled.

### Suggested Fix

1. **Graceful degradation instead of throwing** (primary):
   ```ts
   map((item) => {
       if (item === null) return null
       return item
   })
   ```
2. **Protect async query path**:
   ```ts
   .catch((error) => {
       if (error instanceof OnboardingRequiredError) throw error
       captureException(error)
       throw error
   })
   ```
3. **Defensive guard in `In`** before calling `useApplicationDevice()` when the user is not authenticated.

### Severity

High — the error prevents the POS from rendering.

### Confidence

Medium — the error message, stack trace, and source location align, but no live reproduction environment was available.

### Affected Files

- `organization/web/pos/src/utilities/store/observables/applicationDevice.ts`
- `organization/web/pos/src/components/ApplicationDevice.tsx`
- `organization/web/pos/src/utilities/store/database.ts`
- `organization/web/pos/src/hooks/useSignOut.tsx`
- `organization/web/pos/src/components/ErrorBoundary.tsx`
- `organization/web/pos/src/components/GeneralError.tsx`
- `organization/web/pos/src/utilities/globalErrorCatcher.ts`
- `shared/react/src/core/ErrorBoundary.tsx`

### Logs Excerpt

```
# Sentry event (id: 7311713427, shortId: POS-58W)
level: error
type: OnboardingRequiredError
message: "Missing local application data. User probably signed off."
filename: /assets/index-Be0Cot6S.js
function: l._next          ← minified RxJS internal
firstSeen: 2026-03-05T08:16:46Z
count: 1
```

### Sources

- `/tmp/triage/issue.json` — Sentry issue payload
- `organization/web/pos/src/utilities/store/observables/applicationDevice.ts`
- `organization/web/pos/src/components/ApplicationDevice.tsx`
- `organization/web/pos/src/hooks/useSignOut.tsx`
- `organization/web/pos/src/utilities/store/database.ts`
- `organization/web/pos/src/components/ErrorBoundary.tsx`
- `shared/react/src/core/ErrorBoundary.tsx`
- `organization/web/pos/src/utilities/globalErrorCatcher.ts`
- `organization/web/pos/src/sentry.ts`
- `organization/web/pos/src/components/GeneralError.tsx`
