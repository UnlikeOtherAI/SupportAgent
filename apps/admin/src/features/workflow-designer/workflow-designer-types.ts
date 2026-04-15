import type {
  WorkflowDesignerConnection,
  WorkflowDesignerNode,
  WorkflowDesignerNodeType,
} from '@/api/scenarios'

export type DesignerNodeType = WorkflowDesignerNodeType
export type DesignerNode = WorkflowDesignerNode
export type DesignerConnection = WorkflowDesignerConnection

export interface DesignerPaletteItem {
  config: Record<string, unknown>
  description: string
  key: string
  label: string
  type: DesignerNodeType
}

export interface DesignerDropPoint {
  x: number
  y: number
}

export interface DesignerNodeTheme {
  accent: string
  badge: string
  border: string
  fill: string
  label: string
}
