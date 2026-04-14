export interface PaginatedResponse<T> {
  items: T[]
  data: T[]
  total: number
  limit: number
  offset: number
}

type PaginatedPayload<T> =
  | T[]
  | {
      items?: T[]
      data?: T[]
      total?: number
      limit?: number
      offset?: number
    }

export function normalizePaginatedResponse<T>(
  payload: PaginatedPayload<T>,
  fallbackLimit: number,
  page = 1,
): PaginatedResponse<T> {
  const offset = Math.max(0, (page - 1) * fallbackLimit)

  if (Array.isArray(payload)) {
    return {
      items: payload,
      data: payload,
      total: payload.length,
      limit: fallbackLimit,
      offset,
    }
  }

  const items = payload.items ?? payload.data ?? []
  const limit = payload.limit ?? fallbackLimit
  const resolvedOffset = payload.offset ?? offset

  return {
    items,
    data: items,
    total: payload.total ?? items.length,
    limit,
    offset: resolvedOffset,
  }
}
