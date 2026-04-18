import { parseExecutorYaml } from '@support-agent/executors-runtime'

interface YamlEditorProps {
  value: string
  onChange: (value: string) => void
  serverError?: string | null
}

export function YamlEditor({ value, onChange, serverError }: YamlEditorProps) {
  let localError: string | null = null
  try {
    parseExecutorYaml(value, { sourceName: 'executor.yaml' })
  } catch (error) {
    localError = error instanceof Error ? error.message : 'Invalid executor YAML'
  }

  const hasError = !!localError || !!serverError

  return (
    <div>
      <textarea
        value={value}
        onChange={(event) => { onChange(event.target.value) }}
        spellCheck={false}
        className={`min-h-[28rem] w-full rounded-[var(--radius-sm)] border bg-white px-3 py-3 font-mono text-[13px] text-gray-800 outline-none transition-colors focus:ring-1 ${hasError ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : 'border-gray-200 focus:border-accent-500 focus:ring-accent-500'}`}
      />
      {localError ? <p className="mt-2 text-sm text-red-600">{localError}</p> : null}
      {!localError && serverError ? <p className="mt-2 text-sm text-red-600">{serverError}</p> : null}
    </div>
  )
}
