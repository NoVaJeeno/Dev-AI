import { useCallback, useState } from 'react';

type RorkMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
};

export function createRorkTool<T>(definition: T): T {
  return definition;
}

export async function generateText(): Promise<string> {
  return 'Die KI-Ausführung ist in der Web-Version nicht direkt verfügbar. Bitte verbinde einen serverseitigen AI-Endpunkt, um Textgenerierung im Browser zu aktivieren.';
}

export function useRorkAgent(_options: { tools?: Record<string, unknown> }) {
  const [messages, setMessages] = useState<RorkMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = useCallback(async (input: unknown) => {
    const content = typeof input === 'string' ? input : String(input ?? '');
    const now = Date.now();

    setMessages((current) => [
      ...current,
      { id: `web-user-${now}`, role: 'user', content, createdAt: new Date(now) },
    ]);
    setIsLoading(true);

    try {
      setMessages((current) => [
        ...current,
        {
          id: `web-assistant-${now}`,
          role: 'assistant',
          content: 'Die Web-Oberfläche ist bereit. Für KI-Antworten muss ein serverseitiger AI-Endpunkt konfiguriert werden.',
          createdAt: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    messages,
    isLoading,
    error: null,
    sendMessage,
    stop: () => undefined,
    reload: async () => undefined,
    setMessages,
  };
}
