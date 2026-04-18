import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { executorsApi } from '@/api/executors'
import { getNodeConfigSchema, type DesignerFieldSchema } from './workflow-designer-config-schemas'
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
  const { data: executors = [] } = useQuery({
    queryKey: ['executors', 'designer-inspector'],
    queryFn: () => executorsApi.list(),
  })
  const theme = nodeThemes[node.type]
  const schema = useMemo(() => getNodeConfigSchema(node), [node])
  const [showRawConfig, setShowRawConfig] = useState(false)

  const updateConfigField = (key: string, value: unknown) => {
    const nextConfig = { ...node.config, [key]: value }
    onUpdateNode({ ...node, config: nextConfig })
  }

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

        {schema && schema.fields.length > 0 && (
          <div className="mt-4 space-y-4">
            {schema.fields.map((field) => (
              <DesignerConfigField
                executorOptions={executors.map((executor) => ({
                  value: executor.key,
                  label: executor.key,
                }))}
                field={field}
                key={field.key}
                onChange={(value) => {
                  updateConfigField(field.key, value)
                }}
                value={node.config[field.key]}
              />
            ))}
          </div>
        )}

        {(!schema || schema.fields.length === 0) && (
          <p className="mt-4 rounded-lg border border-dashed border-black/10 bg-white/70 px-3 py-2 text-xs text-[#7b6b83]">
            This block has no tunable fields.
          </p>
        )}

        <button
          className="mt-4 text-xs font-medium text-[#7445c7] hover:underline"
          onClick={() => {
            setShowRawConfig((current) => !current)
          }}
          type="button"
        >
          {showRawConfig ? 'Hide raw JSON' : 'Show raw JSON'}
        </button>

        {showRawConfig && (
          <RawConfigEditor
            config={node.config}
            onChange={(nextConfig) => {
              onUpdateNode({ ...node, config: nextConfig })
            }}
          />
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

interface DesignerConfigFieldProps {
  executorOptions: Array<{ value: string; label: string }>
  field: DesignerFieldSchema
  onChange: (value: unknown) => void
  value: unknown
}

function DesignerConfigField({ executorOptions, field, onChange, value }: DesignerConfigFieldProps) {
  const currentValue = value ?? field.defaultValue ?? ''
  const fieldId = `designer-field-${field.key}`
  const selectOptions = field.key === 'executorKey'
    ? [{ value: '', label: 'Select an executor' }, ...executorOptions]
    : field.options

  return (
    <div>
      <label className="block text-xs font-medium text-[#7b6b83]" htmlFor={fieldId}>
        {field.label}
      </label>
      {field.kind === 'select' && selectOptions ? (
        <select
          className={`${inputClassName} mt-1.5`}
          id={fieldId}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          value={String(currentValue)}
        >
          {selectOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.kind === 'number' ? (
        <input
          className={`${inputClassName} mt-1.5`}
          id={fieldId}
          onChange={(event) => {
            const parsed = Number(event.target.value)
            onChange(Number.isFinite(parsed) ? parsed : event.target.value)
          }}
          type="number"
          value={String(currentValue)}
        />
      ) : field.kind === 'textarea' ? (
        <textarea
          className={`${inputClassName} mt-1.5 min-h-28 resize-y`}
          id={fieldId}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          placeholder={field.placeholder}
          value={String(currentValue)}
        />
      ) : (
        <input
          className={`${inputClassName} mt-1.5`}
          id={fieldId}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          placeholder={field.placeholder}
          type="text"
          value={String(currentValue)}
        />
      )}
      {field.description && (
        <p className="mt-1 text-[11px] text-[#8b7a93]">{field.description}</p>
      )}
    </div>
  )
}

interface RawConfigEditorProps {
  config: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
}

function RawConfigEditor({ config, onChange }: RawConfigEditorProps) {
  const [draft, setDraft] = useState(() => JSON.stringify(config, null, 2))
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="mt-3">
      <label className="block text-xs font-medium text-[#7b6b83]" htmlFor="designer-node-config">
        Configuration JSON
      </label>
      <textarea
        className={`${inputClassName} mt-1.5 min-h-40 font-mono text-xs`}
        id="designer-node-config"
        onChange={(event) => {
          const nextValue = event.target.value
          setDraft(nextValue)
          try {
            const parsed = JSON.parse(nextValue) as unknown
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              setError(null)
              onChange(parsed as Record<string, unknown>)
              return
            }
            setError('Config must be a JSON object.')
          } catch {
            setError('Invalid JSON. Fix it before saving.')
          }
        }}
        value={draft}
      />
      {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
    </div>
  )
}
