import { PubSub, type Subscription, type Topic } from '@google-cloud/pubsub';
import { type QueueAdapter, type QueueProcessor } from './types.js';

export function createPubSubAdapter(projectId: string): QueueAdapter {
  const pubsub = new PubSub({ projectId });
  const topics = new Map<string, Topic>();

  async function getOrCreateTopic(name: string): Promise<Topic> {
    let topic = topics.get(name);
    if (topic) return topic;

    topic = pubsub.topic(name);
    const [exists] = await topic.exists();
    if (!exists) {
      [topic] = await pubsub.createTopic(name);
    }
    topics.set(name, topic);
    return topic;
  }

  async function getOrCreateSubscription(topicName: string): Promise<Subscription> {
    const topic = await getOrCreateTopic(topicName);
    const subName = `${topicName}-sub`;
    const subscription = pubsub.subscription(subName);
    const [exists] = await subscription.exists();
    if (!exists) {
      const [sub] = await topic.createSubscription(subName, {
        ackDeadlineSeconds: 600,
        messageRetentionDuration: { seconds: 86400 },
      });
      return sub;
    }
    return subscription;
  }

  return {
    async enqueue<T>(
      queueName: string,
      payload: T,
      opts?: { jobId?: string },
    ): Promise<string> {
      const topic = await getOrCreateTopic(queueName);
      const messageId = await topic.publishMessage({
        data: Buffer.from(JSON.stringify(payload)),
        attributes: opts?.jobId ? { jobId: opts.jobId } : undefined,
      });
      return messageId;
    },

    createProcessor<T>(
      queueName: string,
      handler: (payload: T, jobId: string) => Promise<void>,
      opts?: { concurrency?: number },
    ): QueueProcessor {
      let subscription: Subscription | null = null;
      let active = false;

      return {
        start() {
          active = true;
          const concurrency = opts?.concurrency ?? 1;

          getOrCreateSubscription(queueName)
            .then((sub) => {
              if (!active) return;
              subscription = sub;
              subscription.setOptions({
                flowControl: { maxMessages: concurrency },
              });

              subscription.on('message', async (message) => {
                try {
                  const payload = JSON.parse(message.data.toString()) as T;
                  const jobId = message.attributes?.jobId ?? message.id;
                  await handler(payload, jobId);
                  message.ack();
                } catch (err) {
                  console.error(
                    `[pubsub] Failed to process message ${message.id}:`,
                    err,
                  );
                  message.nack();
                }
              });
            })
            .catch((err) => {
              console.error(
                `[pubsub] Failed to create subscription for ${queueName}:`,
                err,
              );
            });
        },
        async stop() {
          active = false;
          if (subscription) {
            subscription.removeAllListeners();
            await subscription.close();
            subscription = null;
          }
        },
      };
    },
  };
}
