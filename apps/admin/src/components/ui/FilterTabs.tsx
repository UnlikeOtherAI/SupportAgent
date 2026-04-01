interface FilterTab {
  label: string
  value: string
}

interface FilterTabsProps {
  tabs: FilterTab[]
  active: string
  onChange: (value: string) => void
}

export function FilterTabs({ tabs, active, onChange }: FilterTabsProps) {
  return (
    <div className="flex items-center gap-0.5 rounded-[var(--radius-sm)] bg-gray-100 p-[3px]">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={`rounded-[4px] px-3 py-[5px] font-sans text-xs font-medium transition-all duration-100 ${
            active === tab.value
              ? 'bg-white text-gray-800 shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
