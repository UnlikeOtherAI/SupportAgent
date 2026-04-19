import { useState } from 'react'
import type { WorkflowScenario } from '@/api/scenarios'
import { nodeThemes, paletteSections } from './workflow-designer-options'
import type { DesignerPaletteItem } from './workflow-designer-types'

interface ConnectorOption {
  id: string
  name: string
  platformType: { displayName: string }
}

interface WorkflowDesignerPaletteProps {
  allowedConnectors: string[]
  connectorOptions: ConnectorOption[]
  onAddItem: (item: DesignerPaletteItem) => void
  onAllowedConnectorsChange: (connectorIds: string[]) => void
  onWorkflowTypeChange: (type: WorkflowScenario['workflowType']) => void
  workflowType: WorkflowScenario['workflowType']
}

const WORKFLOW_TYPES: Array<{ value: WorkflowScenario['workflowType']; label: string }> = [
  { value: 'triage', label: 'Triage' },
  { value: 'build', label: 'Build' },
  { value: 'review', label: 'Review' },
  { value: 'merge', label: 'Merge' },
]

const selectClassName =
  'w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-[13px] text-[#2b2430] outline-none transition focus:border-[#7445c7] focus:ring-1 focus:ring-[#7445c7]'

export function WorkflowDesignerPalette({
  allowedConnectors,
  connectorOptions,
  onAddItem,
  onAllowedConnectorsChange,
  onWorkflowTypeChange,
  workflowType,
}: WorkflowDesignerPaletteProps) {
  const [activeSectionKey, setActiveSectionKey] = useState(paletteSections[0]?.key ?? 'triggers')
  const activeSection =
    paletteSections.find((section) => section.key === activeSectionKey) ?? paletteSections[0]

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-black/8 bg-[#fbf8ff]">
      <div className="border-b border-black/8 px-4 py-4">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b7a93]">
          Workflow settings
        </div>
        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#7b6b83]">
              Type
            </label>
            <div className="grid grid-cols-2 gap-1">
              {WORKFLOW_TYPES.map((wt) => {
                const isActive = wt.value === workflowType
                return (
                  <button
                    className={[
                      'rounded-lg px-2 py-1.5 text-xs font-semibold transition',
                      isActive
                        ? 'bg-[#7445c7] text-white shadow-sm'
                        : 'bg-white text-[#7b6b83] ring-1 ring-black/10 hover:bg-white/80 hover:text-[#433349]',
                    ].join(' ')}
                    key={wt.value}
                    onClick={() => { onWorkflowTypeChange(wt.value) }}
                    type="button"
                  >
                    {wt.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#7b6b83]">
              Connector
            </label>
            <select
              aria-label="Connector binding"
              className={selectClassName}
              onChange={(event) => {
                onAllowedConnectorsChange(event.target.value ? [event.target.value] : [])
              }}
              value={allowedConnectors[0] ?? ''}
            >
              <option value="">No connector bound</option>
              {connectorOptions.map((connector) => (
                <option key={connector.id} value={connector.id}>
                  {connector.name} ({connector.platformType.displayName})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="border-b border-black/8 px-4 pt-4 pb-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b7a93]">
          Blocks
        </div>
        <p className="mt-1 text-xs leading-5 text-[#7b6b83]">
          Click or drag a block onto the canvas, then connect them.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-1 border-b border-black/8 px-3 py-3">
        {paletteSections.map((section) => {
          const isActive = section.key === activeSection.key
          return (
            <button
              className={[
                'rounded-xl px-2 py-2 text-xs font-semibold transition',
                isActive
                  ? 'bg-white text-[#2b2430] shadow-sm ring-1 ring-black/10'
                  : 'text-[#8b7a93] hover:bg-white/60 hover:text-[#433349]',
              ].join(' ')}
              key={section.key}
              onClick={() => { setActiveSectionKey(section.key) }}
              type="button"
            >
              {section.label}
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="mb-4" key={activeSection.key}>
          <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8b7a93]">
            {activeSection.label}
          </div>
          <div className="grid gap-2">
            {activeSection.items.map((item) => {
              const theme = nodeThemes[item.type]
              return (
                <button
                  className="group relative overflow-hidden rounded-xl border px-3 py-2 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  draggable
                  key={item.key}
                  onClick={() => { onAddItem(item) }}
                  onDragStart={(event) => {
                    event.dataTransfer.setData('application/x-workflow-node', item.key)
                    event.dataTransfer.effectAllowed = 'copy'
                  }}
                  style={{ backgroundColor: theme.fill, borderColor: theme.badge }}
                  type="button"
                >
                  <span
                    className="absolute inset-y-0 left-0 w-1"
                    style={{ backgroundColor: theme.border }}
                  />
                  <div className="pl-2">
                    <span className="text-[13px] font-semibold text-[#2b2430]">
                      {item.label}
                    </span>
                    <p className="mt-1 text-xs leading-4 text-[#7b6b83]">
                      {item.description}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </aside>
  )
}
