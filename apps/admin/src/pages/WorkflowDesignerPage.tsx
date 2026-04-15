import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  scenariosApi,
  type WorkflowDesignerConnection,
  type WorkflowDesignerNode,
  type WorkflowScenario,
} from '@/api/scenarios'
import { Button } from '@/components/ui/Button'
import { WorkflowDesignerCanvas } from '@/features/workflow-designer/WorkflowDesignerCanvas'
import { WorkflowDesignerInspector } from '@/features/workflow-designer/WorkflowDesignerInspector'
import { WorkflowDesignerPalette } from '@/features/workflow-designer/WorkflowDesignerPalette'
import {
  buildScenarioKey,
  createNodeFromPaletteItem,
} from '@/features/workflow-designer/workflow-designer-graph'
import type {
  DesignerDropPoint,
  DesignerPaletteItem,
} from '@/features/workflow-designer/workflow-designer-types'

const DEFAULT_WORKFLOW_NAME = 'Untitled workflow'

export default function WorkflowDesignerPage() {
  const { id } = useParams<{ id?: string }>()
  const isNewWorkflow = !id || id === 'new'
  const { data, isLoading } = useQuery({
    queryKey: ['workflow', id],
    queryFn: async () => {
      if (!id || id === 'new') throw new Error('Workflow id is required')
      return scenariosApi.get(id)
    },
    enabled: !isNewWorkflow,
  })

  if (!isNewWorkflow && isLoading) {
    return <div className="text-sm text-gray-400">Loading workflow...</div>
  }

  return (
    <WorkflowDesignerWorkspace
      id={id}
      initialWorkflow={data}
      isNewWorkflow={isNewWorkflow}
      key={id ?? 'new'}
    />
  )
}

interface WorkflowDesignerWorkspaceProps {
  id?: string
  initialWorkflow?: WorkflowScenario
  isNewWorkflow: boolean
}

function WorkflowDesignerWorkspace({
  id,
  initialWorkflow,
  isNewWorkflow,
}: WorkflowDesignerWorkspaceProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const canvasElementRef = useRef<HTMLDivElement | null>(null)
  const [workflowName, setWorkflowName] = useState(initialWorkflow?.displayName ?? DEFAULT_WORKFLOW_NAME)
  const [workflowType, setWorkflowType] = useState<WorkflowScenario['workflowType']>(
    initialWorkflow?.workflowType ?? 'triage',
  )
  const [nodes, setNodes] = useState<WorkflowDesignerNode[]>(
    () => initialWorkflow?.designerGraph.nodes ?? [],
  )
  const [connections, setConnections] = useState<WorkflowDesignerConnection[]>(
    () => initialWorkflow?.designerGraph.connections ?? [],
  )
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    () => initialWorkflow?.designerGraph.nodes[0]?.id ?? null,
  )

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId),
    [nodes, selectedNodeId],
  )

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        displayName: workflowName.trim() || DEFAULT_WORKFLOW_NAME,
        key: isNewWorkflow ? buildScenarioKey(workflowName) : initialWorkflow?.key,
        workflowType,
        enabled: initialWorkflow?.enabled ?? true,
        designerGraph: { nodes, connections },
      }

      return isNewWorkflow || !id
        ? scenariosApi.create(payload)
        : scenariosApi.update(id, payload)
    },
    onSuccess: (workflow) => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] })
      void queryClient.invalidateQueries({ queryKey: ['scenarios'] })
      void queryClient.invalidateQueries({ queryKey: ['workflow', workflow.id] })
      void queryClient.invalidateQueries({ queryKey: ['scenario', workflow.id] })
      void navigate('/workflows')
    },
  })

  const addItem = (item: DesignerPaletteItem, dropPoint?: DesignerDropPoint) => {
    const node = createNodeFromPaletteItem(item, canvasElementRef.current, nodes, dropPoint)
    setNodes((current) => [...current, node])
    setSelectedNodeId(node.id)
  }

  const updateNode = (node: WorkflowDesignerNode) => {
    setNodes((current) => current.map((candidate) => (candidate.id === node.id ? node : candidate)))
  }

  const deleteNode = (nodeId: string) => {
    setNodes((current) => current.filter((node) => node.id !== nodeId))
    setConnections((current) =>
      current.filter((connection) => connection.fromNodeId !== nodeId && connection.toNodeId !== nodeId),
    )
    setSelectedNodeId((current) => (current === nodeId ? null : current))
  }

  return (
    <div className="flex h-[calc(100vh-var(--height-topbar)-32px)] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-black/8 bg-[#fbf8ff] px-4 py-3">
        <div className="min-w-0 flex-1">
          <Link className="text-xs font-medium text-[#7b6b83] hover:text-[#2b2430]" to="/workflows">
            &larr; Back to workflows
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <input
              aria-label="Workflow name"
              className="min-w-[260px] rounded-xl border border-black/10 bg-white px-3 py-2 text-lg font-semibold text-[#2b2430] outline-none focus:border-[#7445c7] focus:ring-1 focus:ring-[#7445c7]"
              onChange={(event) => {
                setWorkflowName(event.target.value)
              }}
              value={workflowName}
            />
            <select
              aria-label="Workflow type"
              className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-medium text-[#433349] outline-none focus:border-[#7445c7] focus:ring-1 focus:ring-[#7445c7]"
              onChange={(event) => {
                setWorkflowType(event.target.value as WorkflowScenario['workflowType'])
              }}
              value={workflowType}
            >
              <option value="triage">triage</option>
              <option value="build">build</option>
              <option value="merge">merge</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => { void navigate('/workflows') }} type="button" variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={saveMutation.isPending || nodes.length === 0}
            onClick={() => {
              saveMutation.mutate()
            }}
            type="button"
            variant="primary"
          >
            {saveMutation.isPending ? 'Saving...' : 'Save workflow'}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <WorkflowDesignerPalette onAddItem={addItem} />
        <div className="flex min-w-0 flex-1 overflow-auto" ref={canvasElementRef}>
          <WorkflowDesignerCanvas
            connections={connections}
            nodes={nodes}
            onAddItem={addItem}
            onConnectionsChange={setConnections}
            onNodesChange={setNodes}
            onSelectNode={setSelectedNodeId}
            selectedNodeId={selectedNodeId}
          />
        </div>
        <WorkflowDesignerInspector
          node={selectedNode}
          onDeleteNode={deleteNode}
          onUpdateNode={updateNode}
        />
      </div>
    </div>
  )
}
