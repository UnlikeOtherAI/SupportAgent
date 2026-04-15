import { useEffect, useRef, useState } from 'react'
import {
  DESIGNER_NODE_HEIGHT,
  DESIGNER_NODE_WIDTH,
  nodeThemes,
} from './workflow-designer-options'
import {
  canConnect,
  clamp,
  findPaletteItem,
  getConnectionPath,
} from './workflow-designer-graph'
import type {
  DesignerConnection,
  DesignerDropPoint,
  DesignerNode,
  DesignerPaletteItem,
} from './workflow-designer-types'

interface WorkflowDesignerCanvasProps {
  connections: DesignerConnection[]
  nodes: DesignerNode[]
  onAddItem: (item: DesignerPaletteItem, dropPoint?: DesignerDropPoint) => void
  onConnectionsChange: (connections: DesignerConnection[]) => void
  onNodesChange: (nodes: DesignerNode[]) => void
  onSelectNode: (nodeId: string) => void
  selectedNodeId: string | null
}

interface DragState {
  nodeId: string
  offsetX: number
  offsetY: number
  pointerId: number
}

type HandleType = 'input' | 'output'
type ConnectionDragStatus = 'invalid' | 'neutral' | 'valid'

interface ConnectionDragState {
  originHandle: HandleType
  originNodeId: string
  pointerId: number
  status: ConnectionDragStatus
  x: number
  y: number
}

function connectionKey(connection: DesignerConnection) {
  return connection.id ?? `${connection.fromNodeId}-${connection.toNodeId}`
}

function getNodeAnchor(node: DesignerNode, handle: HandleType) {
  return {
    x: node.x + (handle === 'output' ? DESIGNER_NODE_WIDTH : 0),
    y: node.y + DESIGNER_NODE_HEIGHT / 2,
  }
}

function getConnectionMidpoint(from: DesignerNode, to: DesignerNode) {
  const start = getNodeAnchor(from, 'output')
  const end = getNodeAnchor(to, 'input')

  return {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  }
}

function readHandleTarget(event: PointerEvent) {
  const target = document.elementFromPoint(event.clientX, event.clientY)
  const handle = target instanceof Element ? target.closest('[data-node-handle]') : null
  const nodeId = handle?.getAttribute('data-node-id')
  const handleType = handle?.getAttribute('data-node-handle-type')

  if (!nodeId || (handleType !== 'input' && handleType !== 'output')) return null
  return { handleType: handleType as HandleType, nodeId }
}

function resolveDraggedConnection(
  drag: ConnectionDragState,
  target: { handleType: HandleType; nodeId: string } | null,
  connections: DesignerConnection[],
  nodes: DesignerNode[],
) {
  if (!target || target.nodeId === drag.originNodeId || target.handleType === drag.originHandle) {
    return { connection: null, status: 'invalid' as const }
  }

  const connection = drag.originHandle === 'output'
    ? { fromNodeId: drag.originNodeId, toNodeId: target.nodeId }
    : { fromNodeId: target.nodeId, toNodeId: drag.originNodeId }

  return canConnect(connection, connections, nodes)
    ? { connection, status: 'valid' as const }
    : { connection: null, status: 'invalid' as const }
}

function FontAwesomeTrashIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 448 512">
      <path d="M135.2 17.7 128 32H32C14.3 32 0 46.3 0 64s14.3 32 32 32h384c17.7 0 32-14.3 32-32s-14.3-32-32-32h-96l-7.2-14.3C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-28.6 17.7zM416 128H32l21.2 339c1.6 25.3 22.6 45 47.9 45h245.8c25.3 0 46.3-19.7 47.9-45L416 128z" />
    </svg>
  )
}

export function WorkflowDesignerCanvas({
  connections,
  nodes,
  onAddItem,
  onConnectionsChange,
  onNodesChange,
  onSelectNode,
  selectedNodeId,
}: WorkflowDesignerCanvasProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const connectionDragRef = useRef<ConnectionDragState | null>(null)
  const [connectionDrag, setConnectionDrag] = useState<ConnectionDragState | null>(null)
  const [connectingFromNodeId, setConnectingFromNodeId] = useState<string | null>(null)
  const [hoveredConnectionKey, setHoveredConnectionKey] = useState<string | null>(null)

  useEffect(() => {
    const stopDrag = (pointerId?: number) => {
      const dragState = dragStateRef.current
      if (!dragState) return
      if (typeof pointerId === 'number' && dragState.pointerId !== pointerId) return
      dragStateRef.current = null
    }

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current
      const canvas = canvasRef.current
      const connectionState = connectionDragRef.current
      if (connectionState && canvas && connectionState.pointerId === event.pointerId) {
        const bounds = canvas.getBoundingClientRect()
        const target = readHandleTarget(event)
        const { status } = resolveDraggedConnection(connectionState, target, connections, nodes)
        const nextState = {
          ...connectionState,
          status,
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        }
        connectionDragRef.current = nextState
        setConnectionDrag(nextState)
        return
      }

      if (!dragState || !canvas || dragState.pointerId !== event.pointerId) return

      const bounds = canvas.getBoundingClientRect()
      const maxX = Math.max(28, bounds.width - DESIGNER_NODE_WIDTH - 28)
      const maxY = Math.max(28, bounds.height - DESIGNER_NODE_HEIGHT - 28)

      onNodesChange(
        nodes.map((node) =>
          node.id === dragState.nodeId
            ? {
                ...node,
                x: clamp(event.clientX - bounds.left - dragState.offsetX, 28, maxX),
                y: clamp(event.clientY - bounds.top - dragState.offsetY, 28, maxY),
              }
            : node,
        ),
      )
    }

    const handlePointerUp = (event: PointerEvent) => {
      const connectionState = connectionDragRef.current
      if (connectionState?.pointerId === event.pointerId) {
        const target = readHandleTarget(event)
        const { connection } = resolveDraggedConnection(connectionState, target, connections, nodes)

        if (connection) {
          onConnectionsChange([
            ...connections,
            {
              id: crypto.randomUUID(),
              ...connection,
            },
          ])
        }

        connectionDragRef.current = null
        setConnectionDrag(null)
        setConnectingFromNodeId(null)
      }
      stopDrag(event.pointerId)
    }

    const handleWindowBlur = () => {
      stopDrag()
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [connections, nodes, onConnectionsChange, onNodesChange])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleDragOver = (event: DragEvent) => {
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }

    const handleDrop = (event: DragEvent) => {
      event.preventDefault()
      const item = findPaletteItem(event.dataTransfer?.getData('application/x-workflow-node') ?? '')
      if (!item) return
      const bounds = canvas.getBoundingClientRect()
      onAddItem(item, {
        x: event.clientX - bounds.left - DESIGNER_NODE_WIDTH / 2,
        y: event.clientY - bounds.top - DESIGNER_NODE_HEIGHT / 2,
      })
    }

    canvas.addEventListener('dragover', handleDragOver)
    canvas.addEventListener('drop', handleDrop)

    return () => {
      canvas.removeEventListener('dragover', handleDragOver)
      canvas.removeEventListener('drop', handleDrop)
    }
  }, [onAddItem])

  const nodeById = new Map(nodes.map((node) => [node.id, node]))

  return (
    <div
      className={[
        'relative min-w-[980px] flex-1 overflow-hidden bg-white select-none',
        'bg-[radial-gradient(circle_at_1px_1px,rgba(116,69,199,0.12)_1px,transparent_0)]',
        '[background-size:28px_28px]',
      ].join(' ')}
      aria-label="Workflow designer canvas"
      ref={canvasRef}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        {connections.map((connection) => {
          const from = nodeById.get(connection.fromNodeId)
          const to = nodeById.get(connection.toNodeId)
          if (!from || !to) return null

          return (
            <path
              className="pointer-events-auto cursor-pointer"
              d={getConnectionPath(from, to)}
              fill="none"
              key={connectionKey(connection)}
              onMouseEnter={() => {
                setHoveredConnectionKey(connectionKey(connection))
              }}
              stroke={nodeThemes[from.type].border}
              strokeLinecap="round"
              strokeWidth="3"
              style={{ pointerEvents: 'stroke' }}
            />
          )
        })}
        {connectionDrag && (() => {
          const origin = nodeById.get(connectionDrag.originNodeId)
          if (!origin) return null
          const start = getNodeAnchor(origin, connectionDrag.originHandle)
          const curveOffset = Math.max(Math.abs(connectionDrag.x - start.x) * 0.45, 64)
          const stroke = connectionDrag.status === 'invalid' ? '#dc2626' : nodeThemes[origin.type].border

          return (
            <g className="pointer-events-none">
              <path
                d={[
                  `M ${start.x} ${start.y}`,
                  `C ${start.x + curveOffset} ${start.y},`,
                  `${connectionDrag.x - curveOffset} ${connectionDrag.y},`,
                  `${connectionDrag.x} ${connectionDrag.y}`,
                ].join(' ')}
                fill="none"
                stroke={stroke}
                strokeDasharray="8 6"
                strokeLinecap="round"
                strokeWidth="3"
              />
              <circle
                cx={connectionDrag.x}
                cy={connectionDrag.y}
                fill={stroke}
                r="6"
                stroke="#fff"
                strokeWidth="2"
              />
            </g>
          )
        })()}
      </svg>

      {connections.map((connection) => {
        if (hoveredConnectionKey !== connectionKey(connection)) return null
        const from = nodeById.get(connection.fromNodeId)
        const to = nodeById.get(connection.toNodeId)
        if (!from || !to) return null

        const midpoint = getConnectionMidpoint(from, to)

        return (
          <button
            aria-label="Delete connection"
            className="absolute z-20 flex h-8 w-8 items-center justify-center rounded-full border border-red-200 bg-white text-red-600 shadow-md transition hover:bg-red-50"
            key={`delete-${connectionKey(connection)}`}
            onClick={() => {
              onConnectionsChange(
                connections.filter((candidate) => connectionKey(candidate) !== connectionKey(connection)),
              )
              setHoveredConnectionKey(null)
            }}
            onMouseEnter={() => {
              setHoveredConnectionKey(connectionKey(connection))
            }}
            style={{
              left: midpoint.x - 16,
              top: midpoint.y - 16,
            }}
            title="Delete connection"
            type="button"
          >
            <span className="sr-only">Delete connection</span>
            <span className="h-3.5 w-3.5" aria-hidden="true">
              <FontAwesomeTrashIcon />
            </span>
          </button>
        )
      })}

      {nodes.length === 0 && (
        <div className="absolute left-1/2 top-1/2 w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-dashed border-[#7445c7]/25 bg-[#fbf8ff]/85 p-6 text-center shadow-sm">
          <div className="text-sm font-semibold text-[#2b2430]">
            Drop your first workflow block here
          </div>
          <p className="mt-2 text-xs leading-5 text-[#7b6b83]">
            Build left-to-right: incoming trigger, middle action, then one or more outputs.
          </p>
        </div>
      )}

      {nodes.map((node) => {
        const theme = nodeThemes[node.type]
        const isSelected = selectedNodeId === node.id
        const canStartConnection = node.type !== 'output'
        const canReceiveConnection = node.type !== 'trigger'
        const canCompleteConnection =
          connectingFromNodeId &&
          canConnect({ fromNodeId: connectingFromNodeId, toNodeId: node.id }, connections, nodes)
        const startConnectionDrag = (event: React.PointerEvent, originHandle: HandleType) => {
          event.preventDefault()
          event.stopPropagation()
          const canvas = canvasRef.current
          if (!canvas) return
          const bounds = canvas.getBoundingClientRect()
          const nextState = {
            originHandle,
            originNodeId: node.id,
            pointerId: event.pointerId,
            status: 'neutral' as const,
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
          }
          connectionDragRef.current = nextState
          setConnectionDrag(nextState)
          setConnectingFromNodeId(originHandle === 'output' ? node.id : null)
          onSelectNode(node.id)
        }

        return (
          <div
            className={[
              'absolute rounded-2xl border bg-white shadow-sm transition-shadow',
              isSelected ? 'shadow-lg ring-2 ring-[#7445c7]/20' : 'hover:shadow-md',
            ].join(' ')}
            key={node.id}
            onPointerDown={(event) => {
              const target = event.target
              if (target instanceof Element && target.closest('[data-node-handle]')) return
              const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
              dragStateRef.current = {
                nodeId: node.id,
                offsetX: event.clientX - bounds.left,
                offsetY: event.clientY - bounds.top,
                pointerId: event.pointerId,
              }
              onSelectNode(node.id)
            }}
            style={{
              borderColor: isSelected ? theme.border : 'rgba(0,0,0,0.1)',
              height: DESIGNER_NODE_HEIGHT,
              left: node.x,
              top: node.y,
              width: DESIGNER_NODE_WIDTH,
            }}
          >
            {canReceiveConnection && (
              <button
                aria-label={`Connect into ${node.label}`}
                className={[
                  'absolute -left-2 top-1/2 z-10 h-4 w-4 -translate-y-1/2 rounded-full border-2 bg-white',
                  canCompleteConnection ? 'scale-125 border-[#7445c7]' : 'border-black/20',
                ].join(' ')}
                data-node-handle
                data-node-handle-type="input"
                data-node-id={node.id}
                data-node-input-handle
                onClick={(event) => {
                  event.stopPropagation()
                  if (!connectingFromNodeId) return
                  if (canCompleteConnection) {
                    onConnectionsChange([
                      ...connections,
                      {
                        id: crypto.randomUUID(),
                        fromNodeId: connectingFromNodeId,
                        toNodeId: node.id,
                      },
                    ])
                  }
                  setConnectingFromNodeId(null)
                }}
                onPointerDown={(event) => {
                  startConnectionDrag(event, 'input')
                }}
                type="button"
              />
            )}
            {canStartConnection && (
              <button
                aria-label={`Connect from ${node.label}`}
                className="absolute -right-2 top-1/2 z-10 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white shadow"
                data-node-handle
                data-node-handle-type="output"
                data-node-id={node.id}
                data-node-output-handle
                onClick={(event) => {
                  event.stopPropagation()
                  setConnectingFromNodeId(node.id)
                  onSelectNode(node.id)
                }}
                onPointerDown={(event) => {
                  startConnectionDrag(event, 'output')
                }}
                style={{ backgroundColor: theme.border }}
                type="button"
              />
            )}
            <div
              className="flex h-full flex-col justify-between rounded-2xl px-4 py-3"
              style={{ backgroundColor: theme.fill }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-[13px] font-semibold text-[#2b2430]">
                  {node.label}
                </span>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]"
                  style={{ backgroundColor: theme.badge, color: theme.accent }}
                >
                  {theme.label}
                </span>
              </div>
              <div className="font-mono text-[11px] text-[#8b7a93]">{node.sourceKey}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
