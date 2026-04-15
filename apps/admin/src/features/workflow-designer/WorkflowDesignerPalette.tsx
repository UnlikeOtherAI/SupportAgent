import { useState } from 'react'
import { nodeThemes, paletteSections } from './workflow-designer-options'
import type { DesignerPaletteItem } from './workflow-designer-types'

interface WorkflowDesignerPaletteProps {
  onAddItem: (item: DesignerPaletteItem) => void
}

export function WorkflowDesignerPalette({ onAddItem }: WorkflowDesignerPaletteProps) {
  const [activeSectionKey, setActiveSectionKey] = useState(paletteSections[0]?.key ?? 'triggers')
  const activeSection =
    paletteSections.find((section) => section.key === activeSectionKey) ?? paletteSections[0]

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-black/8 bg-[#fbf8ff]">
      <div className="border-b border-black/8 px-4 py-4">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b7a93]">
          Designer
        </div>
        <h2 className="mt-1 text-lg font-semibold text-[#2b2430]">
          Build a workflow
        </h2>
        <p className="mt-2 text-xs leading-5 text-[#7b6b83]">
          Drag a block onto the canvas or click one to add it. Connect trigger,
          executors, and outputs into one saved workflow.
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
              onClick={() => {
                setActiveSectionKey(section.key)
              }}
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
                  onClick={() => {
                    onAddItem(item)
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.setData('application/x-workflow-node', item.key)
                    event.dataTransfer.effectAllowed = 'copy'
                  }}
                  style={{
                    backgroundColor: theme.fill,
                    borderColor: theme.badge,
                  }}
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
