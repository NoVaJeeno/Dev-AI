export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'AI_API_KEY is not configured in Vercel.',
    });
  }

  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) {
    return res.status(400).json({ error: 'A prompt is required.' });
  }

  const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.AI_MODEL || 'gpt-4o-mini';

  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'Du bist Developer AI, ein hilfreicher deutschsprachiger KI-Assistent für Softwareentwicklung. Antworte klar, präzise und sicher.',
          },
          { role: 'user', content: prompt.slice(0, 24000) },
        ],
        temperature: 0.4,
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      console.error('AI upstream error:', data);
      return res.status(upstream.status).json({
        error: data?.error?.message || 'The AI provider rejected the request.',
      });
    }

    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(502).json({ error: 'The AI provider returned no text.' });
    }

    return res.status(200).json({ text });
  } catch (error) {
    console.error('AI route failed:', error);
    return res.status(502).json({ error: 'The AI provider could not be reached.' });
  }
}
