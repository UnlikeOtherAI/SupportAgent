import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons/NavIcons'

interface PaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  const pages = Array.from({ length: Math.min(totalPages, 4) }, (_, i) => i + 1)

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
        className="flex h-[30px] w-[30px] items-center justify-center rounded-[var(--radius-sm)] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
      >
        <ChevronLeftIcon />
      </button>
      {pages.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPageChange(p)}
          className={`flex h-[30px] min-w-[30px] items-center justify-center rounded-[var(--radius-sm)] px-1 text-xs font-medium transition-colors ${
            p === page
              ? 'bg-gray-900 text-white'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
          }`}
        >
          {p}
        </button>
      ))}
      <button
        type="button"
        disabled={page === totalPages}
        onClick={() => onPageChange(page + 1)}
        className="flex h-[30px] w-[30px] items-center justify-center rounded-[var(--radius-sm)] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
      >
        <ChevronRightIcon />
      </button>
    </div>
  )
}
