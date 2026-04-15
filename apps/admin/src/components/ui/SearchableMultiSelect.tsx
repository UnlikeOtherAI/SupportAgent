import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface SearchableMultiSelectOption {
  value: string
  label: string
  description?: string
}

interface SearchableMultiSelectProps {
  id: string
  label: string
  values: string[]
  options: SearchableMultiSelectOption[]
  onChange: (values: string[]) => void
  emptyLabel?: string
  helperText?: string
  placeholder?: string
}

function matchesSearch(option: SearchableMultiSelectOption, search: string) {
  const value = `${option.label} ${option.value} ${option.description ?? ''}`.toLowerCase()
  return value.includes(search)
}

export function SearchableMultiSelect({
  id,
  label,
  values,
  options,
  onChange,
  emptyLabel = 'No options found',
  helperText,
  placeholder = 'Search to add...',
}: SearchableMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [listboxStyle, setListboxStyle] = useState<CSSProperties>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const selectedOptions = values
    .map((selectedValue) => options.find((option) => option.value === selectedValue))
    .filter((option): option is SearchableMultiSelectOption => !!option)
  const normalizedSearch = search.trim().toLowerCase()
  const filteredOptions = normalizedSearch
    ? options.filter((option) => matchesSearch(option, normalizedSearch))
    : options

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !listboxRef.current?.contains(target)) {
        setIsOpen(false)
        setSearch('')
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [])

  const getListboxPosition = useCallback(() => {
    const rect = inputRef.current?.getBoundingClientRect()
    if (!rect) return null

    const gap = 4
    const viewportPadding = 8
    const preferredHeight = 256
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding
    const spaceAbove = rect.top - viewportPadding
    const placeAbove = spaceBelow < 180 && spaceAbove > spaceBelow
    const availableHeight = Math.max(120, placeAbove ? spaceAbove : spaceBelow)
    const maxHeight = Math.min(preferredHeight, availableHeight)

    return {
      left: rect.left,
      maxHeight,
      top: placeAbove ? rect.top - maxHeight - gap : rect.bottom + gap,
      width: rect.width,
    }
  }, [])

  const getCurrentListboxStyle = useCallback((): CSSProperties => {
    const position = getListboxPosition()
    return position ? { ...position, position: 'fixed' } : {}
  }, [getListboxPosition])

  const updateListboxPosition = useCallback(() => {
    const position = getListboxPosition()
    if (!position || !listboxRef.current) return
    Object.assign(listboxRef.current.style, {
      left: `${position.left}px`,
      maxHeight: `${position.maxHeight}px`,
      top: `${position.top}px`,
      width: `${position.width}px`,
    })
  }, [getListboxPosition])

  useEffect(() => {
    if (!isOpen) return

    window.addEventListener('resize', updateListboxPosition)
    window.addEventListener('scroll', updateListboxPosition, true)
    return () => {
      window.removeEventListener('resize', updateListboxPosition)
      window.removeEventListener('scroll', updateListboxPosition, true)
    }
  }, [isOpen, updateListboxPosition])

  function toggleValue(value: string) {
    if (values.includes(value)) {
      onChange(values.filter((item) => item !== value))
    } else {
      onChange([...values, value])
    }
  }

  function openListbox(nextSearch = search) {
    setListboxStyle(getCurrentListboxStyle())
    setSearch(nextSearch)
    setIsOpen(true)
  }

  return (
    <div ref={rootRef} className="relative">
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-gray-500">
        {label}
      </label>
      {selectedOptions.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selectedOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => { toggleValue(option.value) }}
              className="rounded-full bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-700 hover:bg-accent-100"
            >
              {option.label} x
            </button>
          ))}
        </div>
      ) : null}
      <input
        ref={inputRef}
        id={id}
        type="text"
        autoComplete="off"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={`${id}-options`}
        aria-autocomplete="list"
        value={search}
        placeholder={placeholder}
        onClick={() => { openListbox() }}
        onFocus={() => { openListbox('') }}
        onChange={(event) => {
          setListboxStyle(getCurrentListboxStyle())
          setSearch(event.target.value)
          setIsOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setIsOpen(false)
            setSearch('')
          }
          if (event.key === 'Enter' && isOpen && filteredOptions[0]) {
            event.preventDefault()
            toggleValue(filteredOptions[0].value)
            setSearch('')
            setIsOpen(false)
          }
        }}
        className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
      />
      {isOpen ? createPortal(
        <div
          ref={listboxRef}
          id={`${id}-options`}
          role="listbox"
          style={listboxStyle}
          className="z-[1000] overflow-auto rounded-[var(--radius-sm)] border border-gray-200 bg-white py-1 shadow-lg"
        >
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-400">{emptyLabel}</div>
          ) : (
            filteredOptions.map((option) => {
              const selected = values.includes(option.value)
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    toggleValue(option.value)
                    setSearch('')
                    setIsOpen(false)
                  }}
                  className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent-50 ${
                    selected ? 'bg-accent-50 text-accent-700' : 'text-gray-800'
                  }`}
                >
                  <span className="mt-0.5 h-4 w-4 rounded border border-gray-300 text-center text-[10px] leading-3">
                    {selected ? 'x' : ''}
                  </span>
                  <span>
                    <span className="block font-medium">{option.label}</span>
                    {option.description ? (
                      <span className="mt-0.5 block font-mono text-xs text-gray-400">{option.description}</span>
                    ) : null}
                  </span>
                </button>
              )
            })
          )}
        </div>,
        document.body,
      ) : null}
      {helperText ? <p className="mt-1 text-xs text-gray-400">{helperText}</p> : null}
    </div>
  )
}
