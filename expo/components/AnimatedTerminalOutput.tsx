import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { theme } from '@/constants/theme';

interface AnimatedTerminalOutputProps {
  lines: string[];
  isActive: boolean;
  speed?: number;
}

export const AnimatedTerminalOutput: React.FC<AnimatedTerminalOutputProps> = React.memo(
  ({ lines, isActive, speed = 30 }) => {
    const [visibleLines, setVisibleLines] = useState<string[]>([]);
    const [currentLineIndex, setCurrentLineIndex] = useState(0);
    const [currentCharIndex, setCurrentCharIndex] = useState(0);
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const cursorOpacity = useRef(new Animated.Value(1)).current;

    useEffect(() => {
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(cursorOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
          Animated.timing(cursorOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      ).start();
    }, [fadeAnim, cursorOpacity]);

    useEffect(() => {
      if (!isActive || currentLineIndex >= lines.length) return;

      const currentLine = lines[currentLineIndex];
      if (currentCharIndex < currentLine.length) {
        const timer = setTimeout(() => {
          setVisibleLines(prev => {
            const updated = [...prev];
            updated[currentLineIndex] = currentLine.substring(0, currentCharIndex + 1);
            return updated;
          });
          setCurrentCharIndex(prev => prev + 1);
        }, speed);
        return () => clearTimeout(timer);
      } else {
        const timer = setTimeout(() => {
          setCurrentLineIndex(prev => prev + 1);
          setCurrentCharIndex(0);
          setVisibleLines(prev => [...prev, '']);
        }, 80);
        return () => clearTimeout(timer);
      }
    }, [isActive, currentLineIndex, currentCharIndex, lines, speed]);

    useEffect(() => {
      if (!isActive) {
        setVisibleLines(lines);
        setCurrentLineIndex(lines.length);
      }
    }, [isActive, lines]);

    return (
      <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
        {visibleLines.map((line, i) => (
          <View key={i} style={styles.lineRow}>
            <Text style={[
              styles.lineText,
              line.startsWith('✓') && styles.successText,
              line.startsWith('✗') && styles.errorText,
              line.startsWith('→') && styles.infoText,
              line.startsWith('⚡') && styles.accentText,
            ]}>
              {line}
              {isActive && i === currentLineIndex && currentCharIndex < (lines[i]?.length || 0) && (
                <Animated.Text style={[styles.cursor, { opacity: cursorOpacity }]}>▊</Animated.Text>
              )}
            </Text>
          </View>
        ))}
      </Animated.View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  lineRow: {
    minHeight: 18,
  },
  lineText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: theme.colors.codeText,
    lineHeight: 18,
  },
  successText: {
    color: theme.colors.success,
  },
  errorText: {
    color: theme.colors.error,
  },
  infoText: {
    color: theme.colors.primary,
  },
  accentText: {
    color: theme.colors.warning,
  },
  cursor: {
    color: theme.colors.primary,
    fontSize: 11,
  },
});
