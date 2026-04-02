import type { ReactNode } from 'react'

interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  className?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  keyExtractor: (row: T) => string
  emptyMessage?: string
  isLoading?: boolean
}

export function DataTable<T>({ columns, rows, keyExtractor, emptyMessage = 'No data', isLoading }: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className="border-b border-gray-100 bg-gray-25 px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400 whitespace-nowrap"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <tr key={i}>
                {columns.map((col) => (
                  <td key={col.key} className="border-b border-gray-100 px-5 py-3">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-gray-100" />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-5 py-10 text-center text-sm text-gray-400"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={keyExtractor(row)} className="group">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`border-b border-gray-100 px-5 py-3 text-[13px] text-gray-700 whitespace-nowrap group-last:border-b-0 group-hover:bg-gray-25 ${col.className ?? ''}`}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export type { Column }
