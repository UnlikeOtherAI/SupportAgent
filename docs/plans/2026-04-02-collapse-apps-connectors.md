# Collapse Apps + Connectors Into One Page

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the separate Apps and Connectors nav items with a single Apps page that shows installed connectors at the top and available platforms below — no "Connectors" concept visible to the user.

**Architecture:** AppsPage is redesigned into two sections: installed connector cards (fetched from `connectorsApi.list`) and available platform cards (fetched from `platformTypesApi.list`, filtered to those with no connector). The Connectors nav item and `/connectors` + `/connectors/new` routes are removed. The sub-pages `/connectors/:id`, `/connectors/:id/edit`, and `/connectors/:id/triggers` stay because AppConfigurePage and ConnectorTriggersPage still use them.

**Tech Stack:** React, TanStack Query, React Router, Tailwind, existing `connectorsApi` + `platformTypesApi`

---

### Task 1: Remove Connectors from the sidebar

**Files:**
- Modify: `apps/admin/src/components/layout/Sidebar.tsx`

**Step 1: Remove the Connectors entry from NAV**

In the `Configuration` section, delete:
```ts
{ label: 'Connectors', to: '/connectors', icon: <ConnectorsIcon /> },
```

Also remove the `ConnectorsIcon` import if it becomes unused after this edit.

**Step 2: Verify the import list**

Check `@/components/icons/NavIcons` — if `ConnectorsIcon` is no longer used anywhere else in Sidebar.tsx, remove it from the import.

**Step 3: Commit**
```bash
git add apps/admin/src/components/layout/Sidebar.tsx
git commit -m "feat: remove Connectors from sidebar nav"
```

---

### Task 2: Update the router

**Files:**
- Modify: `apps/admin/src/router/index.tsx`

**Step 1: Remove ConnectorsPage and ConnectorNewPage routes**

Delete these two route entries:
```ts
{ path: 'connectors',     element: load(() => import('@/pages/ConnectorsPage')) },
{ path: 'connectors/new', element: load(() => import('@/pages/ConnectorNewPage')) },
```

**Step 2: Add a redirect from /connectors to /apps**

Add this route so old bookmarks don't 404:
```ts
{ path: 'connectors', element: <Navigate to="/apps" replace /> },
```

Keep these routes intact — they are still used by AppConfigurePage and ConnectorTriggersPage:
```ts
{ path: 'connectors/:id',          element: load(() => import('@/pages/ConnectorDetailPage')) },
{ path: 'connectors/:id/edit',     element: load(() => import('@/pages/ConnectorEditPage')) },
{ path: 'connectors/:id/triggers', element: load(() => import('@/pages/ConnectorTriggersPage')) },
```

**Step 3: Commit**
```bash
git add apps/admin/src/router/index.tsx
git commit -m "feat: redirect /connectors to /apps, remove ConnectorsPage route"
```

---

### Task 3: Redesign AppsPage

This is the main work. The new page has two sections:

**Section A — Installed** (only shown if at least one connector exists)
- Grid of cards, one per connector
- Each card: platform icon, connector name, platform display name, status badge, "Configure" link → `/apps/:platformKey/configure/:connectorId`
- Below the grid: "Install another" link per platform that already has a connector (so you can have two Sentry orgs)

**Section B — Available**
- Same category grouping as before
- Only shows platforms that have zero installed connectors
- "Install" button → `/apps/:platformKey/enable`
- If ALL platforms are installed, show a "All platforms connected" empty state instead

**Files:**
- Modify: `apps/admin/src/pages/AppsPage.tsx`

**Step 1: Fetch both connectors and platform types**

The page already fetches both. Extend the connectors query to fetch a large enough page:
```ts
const { data: connectorsData } = useQuery({
  queryKey: ['connectors'],
  queryFn: () => connectorsApi.list({ limit: 100 }),
})
```

Build two derived structures:
```ts
const connectors = connectorsData?.data ?? []

// Map: platformTypeKey → connector[] (a platform can be installed multiple times)
const installedByPlatform = new Map<string, typeof connectors>()
for (const c of connectors) {
  const existing = installedByPlatform.get(c.platformType) ?? []
  installedByPlatform.set(c.platformType, [...existing, c])
}

// Installed list: all connectors with their platform detail
const installedCards = connectors.map((c) => ({
  connector: c,
  platform: (platforms ?? []).find((p) => p.key === c.platformType),
})).filter((x) => x.platform)

// Available: platforms with no installed connector
const availablePlatforms = (platforms ?? []).filter(
  (p) => !installedByPlatform.has(p.key)
)
```

**Step 2: Write the InstalledCard component**

```tsx
function InstalledCard({
  connector,
  platform,
}: {
  connector: { id: string; name: string; status: string; platformType: string }
  platform: PlatformTypeDetail
}) {
  const statusColor =
    connector.status === 'healthy' ? 'bg-accent-500' :
    connector.status === 'degraded' ? 'bg-signal-amber-500' : 'bg-gray-300'

  return (
    <Card className="flex flex-col p-5">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-gray-50">
          <PlatformIcon slug={platform.iconSlug} className="h-6 w-6 text-gray-700" />
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-accent-50 px-2.5 py-0.5 text-xs font-medium text-accent-600">
          <span className={`h-1.5 w-1.5 rounded-full ${statusColor}`} />
          Connected
        </span>
      </div>
      <p className="text-sm font-semibold text-gray-900">{connector.name}</p>
      <p className="mt-0.5 text-xs text-gray-500">{platform.displayName}</p>
      <div className="mt-4 flex gap-2">
        <Link to={`/apps/${platform.key}/configure/${connector.id}`} className="flex-1">
          <Button variant="secondary" className="w-full justify-center">Configure</Button>
        </Link>
      </div>
    </Card>
  )
}
```

**Step 3: Write the AvailableCard component**

```tsx
function AvailableCard({
  platform,
  hasExisting,
}: {
  platform: PlatformTypeDetail
  hasExisting: boolean
}) {
  return (
    <Card className="flex flex-col p-5">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-gray-50">
        <PlatformIcon slug={platform.iconSlug} className="h-6 w-6 text-gray-700" />
      </div>
      <h3 className="text-sm font-semibold text-gray-900">{platform.displayName}</h3>
      <p className="mt-1 flex-1 text-xs leading-relaxed text-gray-500">{platform.description}</p>
      <div className="mt-4">
        <Link to={`/apps/${platform.key}/enable`}>
          <Button variant={hasExisting ? 'secondary' : 'primary'} className="w-full justify-center">
            {hasExisting ? 'Add another' : 'Install'}
          </Button>
        </Link>
      </div>
    </Card>
  )
}
```

**Step 4: Write the full page**

```tsx
export default function AppsPage() {
  const { data: platforms, isLoading } = useQuery({
    queryKey: ['platform-types'],
    queryFn: () => platformTypesApi.list(),
  })
  const { data: connectorsData } = useQuery({
    queryKey: ['connectors'],
    queryFn: () => connectorsApi.list({ limit: 100 }),
  })

  const connectors = connectorsData?.data ?? []
  const installedByPlatform = new Map<string, typeof connectors>()
  for (const c of connectors) {
    installedByPlatform.set(c.platformType, [
      ...(installedByPlatform.get(c.platformType) ?? []),
      c,
    ])
  }

  const installedCards = connectors
    .map((c) => ({ connector: c, platform: (platforms ?? []).find((p) => p.key === c.platformType) }))
    .filter((x): x is { connector: typeof connectors[0]; platform: PlatformTypeDetail } => !!x.platform)

  const availablePlatforms = (platforms ?? []).filter((p) => !installedByPlatform.has(p.key))

  const CATEGORIES = [
    { key: 'error-monitoring', label: 'Error Monitoring' },
    { key: 'issue-tracker', label: 'Issue Trackers' },
    { key: 'version-control', label: 'Version Control' },
    { key: 'project-management', label: 'Project Management' },
  ] as const

  return (
    <PageShell title="Apps">
      {/* Installed */}
      {installedCards.length > 0 && (
        <div className="mb-10">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">Installed</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {installedCards.map(({ connector, platform }) => (
              <InstalledCard key={connector.id} connector={connector} platform={platform} />
            ))}
          </div>
        </div>
      )}

      {/* Available */}
      {isLoading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : availablePlatforms.length === 0 ? (
        <p className="text-sm text-gray-500">All supported platforms are connected.</p>
      ) : (
        <>
          {CATEGORIES.map((cat) => {
            const catPlatforms = availablePlatforms.filter((p) => p.category === cat.key)
            // Also include already-installed platforms in this category for "Add another"
            const addAnother = (platforms ?? [])
              .filter((p) => p.category === cat.key && installedByPlatform.has(p.key))
            if (catPlatforms.length === 0 && addAnother.length === 0) return null
            return (
              <div key={cat.key} className="mb-8">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
                  {cat.label}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {catPlatforms.map((platform) => (
                    <AvailableCard key={platform.key} platform={platform} hasExisting={false} />
                  ))}
                  {addAnother.map((platform) => (
                    <AvailableCard key={`add-${platform.key}`} platform={platform} hasExisting />
                  ))}
                </div>
              </div>
            )
          })}
        </>
      )}
    </PageShell>
  )
}
```

**Step 5: Commit**
```bash
git add apps/admin/src/pages/AppsPage.tsx
git commit -m "feat: redesign Apps page with installed + available sections"
```

---

### Task 4: Verify in Playwright

Start the dev server and API if not running, then:

1. Navigate to `/apps` — should show "Available" section with platform cards, no "Installed" section yet
2. Confirm no "Connectors" item in the sidebar
3. Navigate to `/connectors` directly — should redirect to `/apps`
4. Click "Install" on a platform — should reach the enable form
5. (If API is live) complete enable flow — installed card should appear in the "Installed" section on return

**Step 1: Run Playwright check**
```bash
# In playwright or browser: visit http://localhost:5175/apps
# Confirm sidebar has no "Connectors"
# Confirm /connectors redirects to /apps
```

**Step 2: Commit if any fixes needed**
```bash
git add -p
git commit -m "fix: <whatever was wrong>"
git push
```

---

### Task 5: Clean up dead files (optional, do last)

The following pages are now unreachable from the UI but keep their routes as safety nets. They can be deleted in a separate cleanup once the team is confident nothing links to them:

- `apps/admin/src/pages/ConnectorsPage.tsx`
- `apps/admin/src/pages/ConnectorNewPage.tsx`

Do NOT delete these until you've confirmed no external links or MCP tools reference them.
