import { useState } from 'react'
import { nodeThemes } from './workflow-designer-options'
import type { DesignerNode } from './workflow-designer-types'

interface WorkflowDesignerInspectorProps {
  node: DesignerNode | undefined
  onDeleteNode: (nodeId: string) => void
  onUpdateNode: (node: DesignerNode) => void
}

const inputClassName =
  'w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-[13px] text-[#2b2430] outline-none transition focus:border-[#7445c7] focus:ring-1 focus:ring-[#7445c7]'

export function WorkflowDesignerInspector({
  node,
  onDeleteNode,
  onUpdateNode,
}: WorkflowDesignerInspectorProps) {
  if (!node) {
    return (
      <aside className="flex h-full w-80 shrink-0 flex-col border-l border-black/8 bg-[#fbf8ff] px-4 py-5">
        <div className="rounded-2xl border border-dashed border-black/15 bg-white/70 p-4 text-sm text-[#7b6b83]">
          Select a canvas block to edit its label and configuration.
        </div>
      </aside>
    )
  }

  return (
    <WorkflowDesignerInspectorContent
      key={node.id}
      node={node}
      onDeleteNode={onDeleteNode}
      onUpdateNode={onUpdateNode}
    />
  )
}

interface WorkflowDesignerInspectorContentProps {
  node: DesignerNode
  onDeleteNode: (nodeId: string) => void
  onUpdateNode: (node: DesignerNode) => void
}

function WorkflowDesignerInspectorContent({
  node,
  onDeleteNode,
  onUpdateNode,
}: WorkflowDesignerInspectorContentProps) {
  const theme = nodeThemes[node.type]
  const [configDraft, setConfigDraft] = useState(() => JSON.stringify(node.config, null, 2))
  const [configError, setConfigError] = useState<string | null>(null)

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-black/8 bg-[#fbf8ff]">
      <div className="border-b border-black/8 px-4 py-4">
        <div
          className="inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={{ backgroundColor: theme.badge, color: theme.accent }}
        >
          {theme.label}
        </div>
        <h2 className="mt-3 text-lg font-semibold text-[#2b2430]">{node.label}</h2>
        <p className="mt-1 font-mono text-[11px] text-[#8b7a93]">{node.sourceKey}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <label className="block text-xs font-medium text-[#7b6b83]" htmlFor="designer-node-label">
          Label
        </label>
        <input
          className={`${inputClassName} mt-1.5`}
          id="designer-node-label"
          onChange={(event) => {
            onUpdateNode({ ...node, label: event.target.value })
          }}
          value={node.label}
        />

        <label className="mt-4 block text-xs font-medium text-[#7b6b83]" htmlFor="designer-node-config">
          Configuration JSON
        </label>
        <textarea
          className={`${inputClassName} mt-1.5 min-h-48 font-mono text-xs`}
          id="designer-node-config"
          onChange={(event) => {
            const nextValue = event.target.value
            setConfigDraft(nextValue)
            try {
              const parsed = JSON.parse(nextValue) as unknown
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                setConfigError(null)
                onUpdateNode({ ...node, config: parsed as Record<string, unknown> })
                return
              }
              setConfigError('Config must be a JSON object.')
            } catch {
              setConfigError('Invalid JSON. Fix it before saving.')
            }
          }}
          value={configDraft}
        />
        {configError && (
          <p className="mt-2 text-xs font-medium text-red-600">{configError}</p>
        )}
      </div>

      <div className="border-t border-black/8 px-4 py-4">
        <button
          className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
          onClick={() => {
            onDeleteNode(node.id)
          }}
          type="button"
        >
          Delete block
        </button>
      </div>
    </aside>
  )
}
