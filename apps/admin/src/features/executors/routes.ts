import { createElement, lazy, Suspense, type ComponentType } from 'react'
import type { RouteObject } from 'react-router-dom'

function load(factory: () => Promise<{ default: ComponentType }>) {
  const Lazy = lazy(factory)
  return createElement(
    Suspense,
    {
      fallback: createElement(
        'div',
        { className: 'flex h-full items-center justify-center text-sm text-gray-400' },
        'Loading...',
      ),
    },
    createElement(Lazy),
  )
}

export const executorRoutes: RouteObject[] = [
  { path: 'executors', element: load(() => import('./ExecutorsList')) },
  { path: 'executors/:id', element: load(() => import('./ExecutorDetail')) },
]
