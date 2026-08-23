import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

export default function WebAppShell() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Willkommen bei Developer AI. Stelle mir eine Frage zu Code, Projekten oder Deployment.',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || isLoading) return;

    const id = `${Date.now()}`;
    setInput('');
    setError(null);
    setMessages((current) => [...current, { id: `user-${id}`, role: 'user', text: prompt }]);
    setIsLoading(true);

    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || typeof data.text !== 'string') {
        throw new Error(data.error || 'Die KI-Antwort konnte nicht geladen werden.');
      }

      setMessages((current) => [...current, { id: `assistant-${id}`, role: 'assistant', text: data.text }]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Die KI-Anfrage ist fehlgeschlagen.';
      setError(message);
      setMessages((current) => [...current, { id: `error-${id}`, role: 'assistant', text: message }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.app}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>DEVELOPER AI</Text>
            <Text style={styles.title}>KI-Workspace</Text>
          </View>
          <View style={styles.status}><View style={styles.statusDot} /><Text style={styles.statusText}>Online</Text></View>
        </View>

        <ScrollView style={styles.messages} contentContainerStyle={styles.messagesContent}>
          {messages.map((message) => (
            <View key={message.id} style={[styles.bubble, message.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
              <Text style={message.role === 'user' ? styles.userText : styles.assistantText}>{message.text}</Text>
            </View>
          ))}
          {isLoading ? <View style={[styles.bubble, styles.assistantBubble, styles.loading]}><ActivityIndicator color="#22d3ee" /><Text style={styles.assistantText}>Developer AI denkt nach …</Text></View> : null}
        </ScrollView>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.composer}>
          <TextInput
            value={input}
            onChangeText={setInput}
            onSubmitEditing={send}
            placeholder="Frage Developer AI …"
            placeholderTextColor="#64748b"
            style={styles.input}
            multiline
            editable={!isLoading}
          />
          <Pressable onPress={send} disabled={!input.trim() || isLoading} style={({ pressed }) => [styles.send, (!input.trim() || isLoading) && styles.sendDisabled, pressed && styles.sendPressed]}>
            <Text style={styles.sendText}>Senden</Text>
          </Pressable>
        </View>
        <Text style={styles.footer}>Web-App · Serverseitige KI-Verbindung · v2.0</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#070b14' },
  app: { flex: 1, width: '100%', maxWidth: 980, alignSelf: 'center', paddingHorizontal: 16 },
  header: { minHeight: 86, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  eyebrow: { color: '#22d3ee', fontSize: 12, fontWeight: '800', letterSpacing: 1.8 },
  title: { color: '#f8fafc', fontSize: 25, fontWeight: '700', marginTop: 4 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#0f2d2f', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#34d399' },
  statusText: { color: '#6ee7b7', fontSize: 13, fontWeight: '700' },
  messages: { flex: 1 },
  messagesContent: { paddingVertical: 22, gap: 12 },
  bubble: { maxWidth: '84%', paddingHorizontal: 15, paddingVertical: 12, borderRadius: 16 },
  assistantBubble: { alignSelf: 'flex-start', backgroundColor: '#111c30', borderWidth: 1, borderColor: '#21314d' },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#0e7490' },
  assistantText: { color: '#e2e8f0', fontSize: 16, lineHeight: 23 },
  userText: { color: '#ecfeff', fontSize: 16, lineHeight: 23 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  error: { color: '#fca5a5', fontSize: 13, marginBottom: 8 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, borderTopWidth: 1, borderTopColor: '#1e293b', paddingVertical: 14 },
  input: { flex: 1, minHeight: 48, maxHeight: 120, color: '#f8fafc', fontSize: 16, backgroundColor: '#101827', borderWidth: 1, borderColor: '#263653', borderRadius: 12, paddingHorizontal: 13, paddingVertical: 12 },
  send: { minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#06b6d4', borderRadius: 12, paddingHorizontal: 16 },
  sendDisabled: { opacity: 0.45 },
  sendPressed: { opacity: 0.8 },
  sendText: { color: '#06212a', fontWeight: '800', fontSize: 15 },
  footer: { color: '#64748b', textAlign: 'center', fontSize: 12, paddingBottom: 10 },
});
