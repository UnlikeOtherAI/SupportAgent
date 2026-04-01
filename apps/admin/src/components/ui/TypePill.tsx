type WorkflowType = 'triage' | 'build' | 'merge'

interface TypePillProps {
  type: WorkflowType
}

const styles: Record<WorkflowType, string> = {
  triage: 'bg-type-triage-bg text-type-triage-fg',
  build:  'bg-type-build-bg text-type-build-fg',
  merge:  'bg-type-merge-bg text-type-merge-fg',
}

export function TypePill({ type }: TypePillProps) {
  return (
    <span className={`inline-flex items-center rounded-[4px] px-[7px] py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide ${styles[type]}`}>
      {type}
    </span>
  )
}
