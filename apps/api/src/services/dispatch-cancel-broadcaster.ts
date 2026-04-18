import { type PrismaClient } from '@prisma/client';

export interface DispatchCancelBroadcaster {
  broadcastRunCancel(args: {
    workflowRunId: string;
    force: boolean;
  }): Promise<void>;
}

export function createDispatchCancelBroadcaster(
  prisma: PrismaClient,
  logger: { warn: (...args: unknown[]) => void } = console,
): DispatchCancelBroadcaster {
  return {
    async broadcastRunCancel(args) {
      const activeDispatches = await prisma.workerDispatch.findMany({
        where: {
          workflowRunId: args.workflowRunId,
          status: { in: ['pending', 'running'] },
        },
        select: {
          id: true,
          executionProvider: {
            select: {
              providerType: true,
            },
          },
        },
      });

      if (activeDispatches.length === 0) {
        return;
      }

      logger.warn(
        {
          workflowRunId: args.workflowRunId,
          force: args.force,
          dispatchAttemptIds: activeDispatches.map((dispatch) => dispatch.id),
          providerTypes: activeDispatches.map((dispatch) => dispatch.executionProvider.providerType),
        },
        'TODO: broadcast cancel over the gateway WebSocket bridge once API→gateway session routing exists',
      );
    },
  };
}
