import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Bot, User, Terminal, CheckCircle, AlertCircle, Loader } from 'lucide-react-native';
import { Message } from '@/types';
import { theme } from '@/constants/theme';
import { formatTimestamp } from '@/utils/helpers';

interface ChatMessageProps {
  message: Message;
  isLatest?: boolean;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, isLatest }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    if (isLatest) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      fadeAnim.setValue(1);
      slideAnim.setValue(0);
    }
  }, [isLatest, fadeAnim, slideAnim]);

  const isUser = message.role === 'user';

  const renderToolCalls = () => {
    if (!message.toolCalls || message.toolCalls.length === 0) return null;

    return (
      <View style={styles.toolCallsContainer}>
        {message.toolCalls.map((tool) => (
          <View key={tool.id} style={styles.toolCall}>
            <View style={styles.toolCallHeader}>
              <Terminal size={14} color={theme.colors.primary} />
              <Text style={styles.toolCallName}>{tool.tool}</Text>
              {tool.status === 'completed' && (
                <CheckCircle size={14} color={theme.colors.success} />
              )}
              {tool.status === 'error' && (
                <AlertCircle size={14} color={theme.colors.error} />
              )}
              {tool.status === 'running' && (
                <Loader size={14} color={theme.colors.warning} />
              )}
            </View>
            {tool.result && (
              <Text style={styles.toolCallResult} numberOfLines={3}>
                {tool.result}
              </Text>
            )}
          </View>
        ))}
      </View>
    );
  };

  const renderContent = () => {
    const parts = message.content.split(/```(\w+)?\n([\s\S]*?)```/g);
    const elements: React.ReactNode[] = [];

    for (let i = 0; i < parts.length; i++) {
      if (i % 3 === 0) {
        if (parts[i]) {
          const boldParts = parts[i].split(/\*\*(.*?)\*\*/g);
          elements.push(
            <Text key={`text-${i}`} style={styles.messageText}>
              {boldParts.map((part, j) =>
                j % 2 === 1 ? (
                  <Text key={`bold-${j}`} style={styles.boldText}>{part}</Text>
                ) : (
                  part
                )
              )}
            </Text>
          );
        }
      } else if (i % 3 === 2) {
        elements.push(
          <View key={`code-${i}`} style={styles.codeBlock}>
            <Text style={styles.codeText}>{parts[i]}</Text>
          </View>
        );
      }
    }

    return elements;
  };

  return (
    <Animated.View
      style={[
        styles.container,
        isUser ? styles.userContainer : styles.assistantContainer,
        { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
      ]}
    >
      <View style={[styles.avatar, isUser ? styles.userAvatar : styles.assistantAvatar]}>
        {isUser ? (
          <User size={18} color={theme.colors.text} />
        ) : (
          <Bot size={18} color={theme.colors.background} />
        )}
      </View>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        {renderContent()}
        {renderToolCalls()}
        <Text style={styles.timestamp}>{formatTimestamp(message.timestamp)}</Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginVertical: 8,
    paddingHorizontal: 16,
    maxWidth: '100%',
  },
  userContainer: {
    flexDirection: 'row-reverse',
  },
  assistantContainer: {
    flexDirection: 'row',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatar: {
    backgroundColor: theme.colors.surfaceLight,
    marginLeft: 10,
  },
  assistantAvatar: {
    backgroundColor: theme.colors.primary,
    marginRight: 10,
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: 16,
    padding: 14,
  },
  userBubble: {
    backgroundColor: theme.colors.surface,
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: theme.colors.backgroundSecondary,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  messageText: {
    color: theme.colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  boldText: {
    fontWeight: '700' as const,
    color: theme.colors.primary,
  },
  codeBlock: {
    backgroundColor: theme.colors.codeBackground,
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: theme.colors.codeText,
  },
  timestamp: {
    color: theme.colors.textTertiary,
    fontSize: 11,
    marginTop: 6,
    alignSelf: 'flex-end',
  },
  toolCallsContainer: {
    marginTop: 10,
  },
  toolCall: {
    backgroundColor: theme.colors.backgroundTertiary,
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.primary,
  },
  toolCallHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toolCallName: {
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: '600' as const,
    flex: 1,
  },
  toolCallResult: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    marginTop: 6,
    fontFamily: 'monospace',
  },
});
