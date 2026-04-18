import { describe, expect, it } from 'vitest'
import { isForceStopEnabled } from './run-force-stop'

describe('isForceStopEnabled', () => {
  it('keeps force stop disabled for the first 30 seconds after cancelRequestedAt', () => {
    expect(
      isForceStopEnabled(
        {
          id: 'run-1',
          workflowType: 'triage',
          status: 'cancel_requested',
          startedAt: null,
          updatedAt: '2026-04-18T10:00:20.000Z',
          duration: null,
          workItemId: 'work-item-1',
          cancelRequestedAt: '2026-04-18T10:00:00.000Z',
        },
        new Date('2026-04-18T10:00:10.000Z').getTime(),
      ),
    ).toBe(false)
  })

  it('enables force stop once cancelRequestedAt is at least 35 seconds old', () => {
    expect(
      isForceStopEnabled(
        {
          id: 'run-1',
          workflowType: 'triage',
          status: 'cancel_requested',
          startedAt: null,
          updatedAt: '2026-04-18T10:00:34.000Z',
          duration: null,
          workItemId: 'work-item-1',
          cancelRequestedAt: '2026-04-18T10:00:00.000Z',
        },
        new Date('2026-04-18T10:00:35.000Z').getTime(),
      ),
    ).toBe(true)
  })
})
