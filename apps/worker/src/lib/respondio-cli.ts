import {
  getConversationSummary,
  postComment,
  type RespondIoConversationSummary,
} from '@support-agent/respondio-client';

function apiKey(): string {
  const key = process.env.RESPONDIO_API_KEY;
  if (!key || key.trim() === '') {
    throw new Error(
      'RESPONDIO_API_KEY env var is not set. Set it on the worker process to enable Respond.io post-back.',
    );
  }
  return key;
}

export async function respondioGetConversation(
  contactIdOrIdentifier: string | number,
): Promise<RespondIoConversationSummary> {
  return getConversationSummary({ apiKey: apiKey() }, contactIdOrIdentifier);
}

export async function respondioPostComment(
  contactIdOrIdentifier: string | number,
  text: string,
): Promise<{ commentId?: number }> {
  return postComment({ apiKey: apiKey() }, { contact: contactIdOrIdentifier, text });
}

export function respondioAuthAvailable(): boolean {
  return Boolean(process.env.RESPONDIO_API_KEY?.trim());
}
