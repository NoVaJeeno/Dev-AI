import { useCallback, useState } from 'react';

type RorkMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
};

function toPrompt(input: unknown): string {
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return String(input ?? '');

  const value = input as { messages?: Array<{ content?: unknown }> };
  if (!Array.isArray(value.messages)) return JSON.stringify(input);

  return value.messages.map((message) => {
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .filter((part): part is { type?: string; text?: string } => Boolean(part && typeof part === 'object'))
        .map((part) => part.text || '')
        .join('\n');
    }
    return '';
  }).filter(Boolean).join('\n');
}

export function createRorkTool<T>(definition: T): T {
  return definition;
}

export async function generateText(input: unknown): Promise<string> {
  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: toPrompt(input) }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.text !== 'string') {
    throw new Error(data.error || 'KI-Anfrage fehlgeschlagen.');
  }

  return data.text;
}

export function useRorkAgent(_options: { tools?: Record<string, unknown> }) {
  const [messages, setMessages] = useState<RorkMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const sendMessage = useCallback(async (input: unknown) => {
    const prompt = toPrompt(input);
    const now = Date.now();
    setError(null);
    setMessages((current) => [...current, {
      id: `web-user-${now}`, role: 'user', content: prompt, createdAt: new Date(now),
    }]);
    setIsLoading(true);

    try {
      const content = await generateText(prompt);
      setMessages((current) => [...current, {
        id: `web-assistant-${now}`, role: 'assistant', content, createdAt: new Date(),
      }]);
    } catch (cause) {
      const nextError = cause instanceof Error ? cause : new Error('KI-Anfrage fehlgeschlagen.');
      setError(nextError);
      setMessages((current) => [...current, {
        id: `web-error-${now}`, role: 'assistant', content: nextError.message, createdAt: new Date(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { messages, isLoading, error, sendMessage, stop: () => undefined, reload: async () => undefined, setMessages };
}
