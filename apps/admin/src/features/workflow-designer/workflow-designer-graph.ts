import {
  DESIGNER_NODE_HEIGHT,
  DESIGNER_NODE_WIDTH,
  paletteItems,
} from './workflow-designer-options'
import type {
  DesignerConnection,
  DesignerDropPoint,
  DesignerNode,
  DesignerPaletteItem,
} from './workflow-designer-types'

const CANVAS_PADDING = 28
const HANDLE_Y = DESIGNER_NODE_HEIGHT / 2
const NODE_COLUMN_GAP = 48

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function createNodeFromPaletteItem(
  item: DesignerPaletteItem,
  canvasElement: HTMLDivElement | null,
  existingNodes: DesignerNode[],
  dropPoint?: DesignerDropPoint,
): DesignerNode {
  const bounds = canvasElement?.getBoundingClientRect()
  const canvasWidth = Math.max(canvasElement?.scrollWidth ?? 0, bounds?.width ?? 720)
  const maxX = Math.max(CANVAS_PADDING, canvasWidth - DESIGNER_NODE_WIDTH - CANVAS_PADDING)
  const maxY = Math.max(CANVAS_PADDING, (bounds?.height ?? 420) - DESIGNER_NODE_HEIGHT - CANVAS_PADDING)
  const sameTypeIndex = existingNodes.filter((node) => node.type === item.type).length
  const typeColumn = item.type === 'trigger' ? 0 : item.type === 'action' ? 1 : 2
  const availableX = maxX - CANVAS_PADDING
  const columnX = CANVAS_PADDING + (availableX / 2) * typeColumn
  const centeredY = ((bounds?.height ?? 420) / 2) - (DESIGNER_NODE_HEIGHT / 2)
  const stackedY = centeredY + sameTypeIndex * (DESIGNER_NODE_HEIGHT + NODE_COLUMN_GAP)

  return {
    id: crypto.randomUUID(),
    type: item.type,
    label: item.label,
    sourceKey: item.key,
    x: clamp(dropPoint?.x ?? columnX, CANVAS_PADDING, maxX),
    y: clamp(dropPoint?.y ?? stackedY, CANVAS_PADDING, maxY),
    config: item.config,
  }
}

export function findPaletteItem(key: string) {
  return paletteItems.find((item) => item.key === key)
}

export function getNodeInputAnchor(node: DesignerNode) {
  return { x: node.x, y: node.y + HANDLE_Y }
}

export function getNodeOutputAnchor(node: DesignerNode) {
  return { x: node.x + DESIGNER_NODE_WIDTH, y: node.y + HANDLE_Y }
}

export function getConnectionPath(from: DesignerNode, to: DesignerNode) {
  const start = getNodeOutputAnchor(from)
  const end = getNodeInputAnchor(to)
  const curveOffset = Math.max(Math.abs(end.x - start.x) * 0.45, 64)

  return [
    `M ${start.x} ${start.y}`,
    `C ${start.x + curveOffset} ${start.y},`,
    `${end.x - curveOffset} ${end.y},`,
    `${end.x} ${end.y}`,
  ].join(' ')
}

export function canConnect(
  connection: Pick<DesignerConnection, 'fromNodeId' | 'toNodeId'>,
  connections: DesignerConnection[],
  nodes: DesignerNode[],
) {
  const fromNode = nodes.find((node) => node.id === connection.fromNodeId)
  const toNode = nodes.find((node) => node.id === connection.toNodeId)

  return (
    !!fromNode &&
    !!toNode &&
    fromNode.type !== 'output' &&
    toNode.type !== 'trigger' &&
    connection.fromNodeId !== connection.toNodeId &&
    !connections.some(
      (current) =>
        current.fromNodeId === connection.fromNodeId &&
        current.toNodeId === connection.toNodeId,
    )
  )
}

export function buildScenarioKey(displayName: string) {
  const key = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

  return key || `workflow-${Date.now()}`
}
