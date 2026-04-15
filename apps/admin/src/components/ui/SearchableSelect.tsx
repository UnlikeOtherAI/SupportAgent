import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface SearchableSelectOption {
  value: string
  label: string
  description?: string
}

interface SearchableSelectProps {
  id: string
  label: string
  value: string
  options: SearchableSelectOption[]
  onChange: (value: string) => void
  allowClear?: boolean
  disabled?: boolean
  emptyLabel?: string
  helperText?: string
  name?: string
  placeholder?: string
  required?: boolean
}

const inputClassName =
  'w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 pr-10 text-[13px] text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-accent-500 focus:ring-1 focus:ring-accent-500 disabled:bg-gray-50 disabled:text-gray-500'

function matchesSearch(option: SearchableSelectOption, search: string) {
  const value = `${option.label} ${option.value} ${option.description ?? ''}`.toLowerCase()
  return value.includes(search)
}

export function SearchableSelect({
  id,
  label,
  value,
  options,
  onChange,
  allowClear = false,
  disabled = false,
  emptyLabel = 'No options found',
  helperText,
  name,
  placeholder = 'Search and select...',
  required = false,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [listboxStyle, setListboxStyle] = useState<CSSProperties>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const selectedOption = options.find((option) => option.value === value)
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

  const displayValue = isOpen ? search : selectedOption?.label ?? ''

  function selectValue(nextValue: string) {
    onChange(nextValue)
    setSearch('')
    setIsOpen(false)
  }

  function openListbox(nextSearch = '') {
    if (disabled) return
    setListboxStyle(getCurrentListboxStyle())
    setSearch(nextSearch)
    setIsOpen(true)
  }

  return (
    <div ref={rootRef} className="relative">
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-gray-500">
        {label}
      </label>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <input
        ref={inputRef}
        id={id}
        type="text"
        autoComplete="off"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={`${id}-options`}
        aria-autocomplete="list"
        disabled={disabled}
        required={required}
        value={displayValue}
        placeholder={placeholder}
        onClick={() => {
          openListbox(isOpen ? search : '')
        }}
        onFocus={() => {
          openListbox('')
        }}
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
            selectValue(filteredOptions[0].value)
          }
        }}
        className={inputClassName}
      />
      {allowClear && value ? (
        <button
          type="button"
          aria-label={`Clear ${label}`}
          onClick={() => { selectValue('') }}
          className="absolute right-2 top-7 rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          x
        </button>
      ) : null}
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
            filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => { selectValue(option.value) }}
                className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent-50 ${
                  option.value === value ? 'bg-accent-50 text-accent-700' : 'text-gray-800'
                }`}
              >
                <span className="block font-medium">{option.label}</span>
                {option.description ? (
                  <span className="mt-0.5 block font-mono text-xs text-gray-400">{option.description}</span>
                ) : null}
              </button>
            ))
          )}
        </div>,
        document.body,
      ) : null}
      {helperText ? <p className="mt-1 text-xs text-gray-400">{helperText}</p> : null}
    </div>
  )
}
