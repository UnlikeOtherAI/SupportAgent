import type { SkillSummary } from '@support-agent/contracts'
import { parse, stringify } from 'yaml'
import { parseExecutorYaml } from '@support-agent/executors-runtime'

interface SkillPickerProps {
  availableSkills: SkillSummary[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export function SkillPicker({ availableSkills, value, onChange, disabled }: SkillPickerProps) {
  const systemSkills = availableSkills.filter((skill) => skill.role === 'SYSTEM')
  const complementarySkills = availableSkills.filter((skill) => skill.role === 'COMPLEMENTARY')

  try {
    const parsedExecutor = parseExecutorYaml(value, { sourceName: 'executor.yaml' })

    return (
      <div className="space-y-4">
        {parsedExecutor.stages.map((stage, stageIndex) => (
          <div key={stage.id} className="rounded-[var(--radius-sm)] border border-gray-200 p-4">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-gray-900">{stage.id}</h3>
              <p className="text-xs text-gray-500">Update the stage skill bindings without hand-editing the YAML keys.</p>
            </div>

            <fieldset className="space-y-2">
              <legend className="mb-2 text-xs font-medium text-gray-500">System skill</legend>
              {systemSkills.map((skill) => (
                <label key={`${stage.id}-${skill.id}`} className="flex items-start gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    name={`system-skill-${stage.id}`}
                    checked={stage.system_skill === skill.name}
                    onChange={() => { onChange(updateStageSkillBinding(value, stageIndex, 'system', skill.name, null)) }}
                    disabled={disabled}
                    className="mt-0.5 h-4 w-4 border-gray-300 text-accent-500 focus:ring-accent-500"
                  />
                  <span>{skill.name}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="mt-4 space-y-2">
              <legend className="mb-2 text-xs font-medium text-gray-500">Complementary skills</legend>
              {complementarySkills.map((skill) => {
                const isChecked = stage.complementary.includes(skill.name)
                return (
                  <label key={`${stage.id}-${skill.id}`} className="flex items-start gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {
                        const nextValues = isChecked
                          ? stage.complementary.filter((name) => name !== skill.name)
                          : [...stage.complementary, skill.name]
                        onChange(updateStageSkillBinding(value, stageIndex, 'complementary', null, nextValues))
                      }}
                      disabled={disabled}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-accent-500 focus:ring-accent-500"
                    />
                    <span>{skill.name}</span>
                  </label>
                )
              })}
            </fieldset>
          </div>
        ))}
      </div>
    )
  } catch {
    return (
      <div className="rounded-[var(--radius-sm)] border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500">
        Fix the YAML validation errors to use the skill picker.
      </div>
    )
  }
}

function updateStageSkillBinding(
  yamlText: string,
  stageIndex: number,
  kind: 'system' | 'complementary',
  systemSkillName: string | null,
  complementary: string[] | null,
) {
  const parsed = parse(yamlText) as { stages?: Array<Record<string, unknown>> }
  if (!Array.isArray(parsed.stages) || !parsed.stages[stageIndex]) {
    return yamlText
  }

  const next = structuredClone(parsed)
  const stage = next.stages?.[stageIndex]
  if (!stage) {
    return yamlText
  }

  if (kind === 'system' && systemSkillName) {
    stage.system_skill = systemSkillName
  }

  if (kind === 'complementary' && complementary) {
    stage.complementary = complementary
  }

  return stringify(next, { lineWidth: 0 })
}
