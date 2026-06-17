import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Keyboard,
  Platform,
  Text,
  Image,
  ScrollView,
  Alert,
} from 'react-native';
import { Send, X, Plus, ImageIcon, FileText, Camera, Loader, Square } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import { theme } from '@/constants/theme';

const MAX_IMAGE_DIMENSION = 1024;
const IMAGE_COMPRESS_QUALITY = 0.5;

interface AttachedFile {
  uri: string;
  mimeType: string;
  name: string;
  type: 'image' | 'file';
}

interface ChatInputProps {
  onSend: (message: string, files?: { type: 'file'; mimeType: string; uri: string }[]) => void;
  disabled?: boolean;
  placeholder?: string;
  isStreaming?: boolean;
  onStop?: () => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  disabled = false,
  placeholder = 'Nachricht eingeben...',
  isStreaming = false,
  onStop,
}) => {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const menuAnim = useRef(new Animated.Value(0)).current;
  const plusRotateAnim = useRef(new Animated.Value(0)).current;
  const stopPulseAnim = useRef(new Animated.Value(0)).current;
  const stopScaleAnim = useRef(new Animated.Value(1)).current;
  const morphAnim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (isStreaming) {
      Animated.timing(morphAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(stopPulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(stopPulseAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    } else {
      Animated.timing(morphAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start();
      stopPulseAnim.stopAnimation();
      stopPulseAnim.setValue(0);
    }
  }, [isStreaming, morphAnim, stopPulseAnim]);

  const handleStop = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Animated.sequence([
      Animated.timing(stopScaleAnim, { toValue: 0.8, duration: 80, useNativeDriver: true }),
      Animated.spring(stopScaleAnim, { toValue: 1, tension: 300, friction: 10, useNativeDriver: true }),
    ]).start();
    onStop?.();
  }, [onStop, stopScaleAnim]);

  const toggleAttachMenu = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newVal = !showAttachMenu;
    setShowAttachMenu(newVal);
    Animated.parallel([
      Animated.spring(menuAnim, {
        toValue: newVal ? 1 : 0,
        tension: 200,
        friction: 15,
        useNativeDriver: true,
      }),
      Animated.spring(plusRotateAnim, {
        toValue: newVal ? 1 : 0,
        tension: 200,
        friction: 15,
        useNativeDriver: true,
      }),
    ]).start();
  }, [showAttachMenu, menuAnim, plusRotateAnim]);

  const compressImage = useCallback(async (uri: string, width?: number, height?: number): Promise<string> => {
    try {
      const actions: ImageManipulator.Action[] = [];
      const w = width || 0;
      const h = height || 0;
      if (w > MAX_IMAGE_DIMENSION || h > MAX_IMAGE_DIMENSION) {
        if (w >= h) {
          actions.push({ resize: { width: MAX_IMAGE_DIMENSION } });
        } else {
          actions.push({ resize: { height: MAX_IMAGE_DIMENSION } });
        }
      }
      const result = await ImageManipulator.manipulateAsync(
        uri,
        actions,
        { compress: IMAGE_COMPRESS_QUALITY, format: ImageManipulator.SaveFormat.JPEG }
      );
      console.log('[ChatInput] Compressed image:', result.uri.substring(0, 80));
      return result.uri;
    } catch (e) {
      console.error('[ChatInput] Compress error:', e);
      return uri;
    }
  }, []);

  const closeAttachMenu = useCallback(() => {
    setShowAttachMenu(false);
    Animated.parallel([
      Animated.timing(menuAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(plusRotateAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start();
  }, [menuAnim, plusRotateAnim]);

  const pickImage = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Berechtigung benötigt', 'Bitte erlaube den Zugriff auf deine Fotos.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.6,
      });
      if (!result.canceled && result.assets.length > 0) {
        setIsCompressing(true);
        try {
          const newFiles: AttachedFile[] = [];
          for (const asset of result.assets) {
            const compressedUri = await compressImage(asset.uri, asset.width, asset.height);
            newFiles.push({
              uri: compressedUri,
              mimeType: 'image/jpeg',
              name: asset.fileName || `image_${Date.now()}.jpg`,
              type: 'image' as const,
            });
          }
          setAttachments((prev) => [...prev, ...newFiles]);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } finally {
          setIsCompressing(false);
        }
      }
    } catch (e) {
      console.error('[ChatInput] pickImage error:', e);
      setIsCompressing(false);
      Alert.alert('Fehler', 'Bild konnte nicht geladen werden.');
    }
    closeAttachMenu();
  }, [compressImage, closeAttachMenu]);

  const takePhoto = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Berechtigung benötigt', 'Bitte erlaube den Kamerazugriff.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.6,
      });
      if (!result.canceled && result.assets.length > 0) {
        setIsCompressing(true);
        try {
          const asset = result.assets[0];
          const compressedUri = await compressImage(asset.uri, asset.width, asset.height);
          setAttachments((prev) => [
            ...prev,
            {
              uri: compressedUri,
              mimeType: 'image/jpeg',
              name: `photo_${Date.now()}.jpg`,
              type: 'image',
            },
          ]);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } finally {
          setIsCompressing(false);
        }
      }
    } catch (e) {
      console.error('[ChatInput] takePhoto error:', e);
      setIsCompressing(false);
      Alert.alert('Fehler', 'Foto konnte nicht aufgenommen werden.');
    }
    closeAttachMenu();
  }, [compressImage, closeAttachMenu]);

  const pickDocument = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.5,
      });
      if (!result.canceled && result.assets.length > 0) {
        setIsCompressing(true);
        try {
          const asset = result.assets[0];
          const compressedUri = await compressImage(asset.uri, asset.width, asset.height);
          setAttachments((prev) => [
            ...prev,
            {
              uri: compressedUri,
              mimeType: 'image/jpeg',
              name: asset.fileName || `file_${Date.now()}`,
              type: 'image',
            },
          ]);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } finally {
          setIsCompressing(false);
        }
      }
    } catch (e) {
      console.error('[ChatInput] pickDocument error:', e);
      setIsCompressing(false);
    }
    closeAttachMenu();
  }, [compressImage, closeAttachMenu]);

  const removeAttachment = useCallback((index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSend = useCallback(() => {
    if ((message.trim() || attachments.length > 0) && !disabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Animated.sequence([
        Animated.timing(scaleAnim, { toValue: 0.88, duration: 80, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, tension: 200, friction: 10, useNativeDriver: true }),
      ]).start();

      const files = attachments.length > 0
        ? attachments.map((a) => ({ type: 'file' as const, mimeType: a.mimeType, uri: a.uri }))
        : undefined;

      onSend(message.trim() || 'Analysiere diese Datei(en)', files);
      setMessage('');
      setAttachments([]);
      if (Platform.OS !== 'web') Keyboard.dismiss();
    }
  }, [message, attachments, disabled, scaleAnim, onSend]);

  const handleFocus = useCallback(() => {
    Animated.timing(glowAnim, { toValue: 1, duration: 200, useNativeDriver: false }).start();
  }, [glowAnim]);

  const handleBlur = useCallback(() => {
    Animated.timing(glowAnim, { toValue: 0, duration: 200, useNativeDriver: false }).start();
  }, [glowAnim]);

  const borderColor = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.colors.border, theme.colors.primary],
  });

  const menuScale = menuAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 1],
  });

  const plusRotation = plusRotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '45deg'],
  });

  const hasContent = message.trim().length > 0 || attachments.length > 0;

  return (
    <View style={styles.outerContainer}>
      {showAttachMenu && (
        <Animated.View
          style={[
            styles.attachMenu,
            { opacity: menuAnim, transform: [{ scale: menuScale }] },
          ]}
        >
          <TouchableOpacity style={styles.attachOption} onPress={pickImage} activeOpacity={0.7}>
            <View style={[styles.attachIconWrap, { backgroundColor: 'rgba(0, 200, 255, 0.12)' }]}>
              <ImageIcon size={18} color={theme.colors.primary} />
            </View>
            <Text style={styles.attachLabel}>Galerie</Text>
          </TouchableOpacity>
          {Platform.OS !== 'web' && (
            <TouchableOpacity style={styles.attachOption} onPress={takePhoto} activeOpacity={0.7}>
              <View style={[styles.attachIconWrap, { backgroundColor: 'rgba(16, 185, 129, 0.12)' }]}>
                <Camera size={18} color={theme.colors.accent} />
              </View>
              <Text style={styles.attachLabel}>Kamera</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.attachOption} onPress={pickDocument} activeOpacity={0.7}>
            <View style={[styles.attachIconWrap, { backgroundColor: 'rgba(139, 92, 246, 0.12)' }]}>
              <FileText size={18} color={theme.colors.secondary} />
            </View>
            <Text style={styles.attachLabel}>Datei</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {attachments.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.attachmentBar}
          contentContainerStyle={styles.attachmentBarContent}
        >
          {attachments.map((att, idx) => (
            <View key={`${att.name}-${idx}`} style={styles.attachmentPreview}>
              {att.type === 'image' ? (
                <Image source={{ uri: att.uri }} style={styles.attachmentThumb} />
              ) : (
                <View style={styles.attachmentFileIcon}>
                  <FileText size={16} color={theme.colors.primary} />
                </View>
              )}
              <TouchableOpacity
                style={styles.attachmentRemove}
                onPress={() => removeAttachment(idx)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <X size={10} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.attachmentName} numberOfLines={1}>{att.name}</Text>
            </View>
          ))}
          {isCompressing && (
            <View style={styles.compressingIndicator}>
              <Loader size={16} color={theme.colors.primary} />
              <Text style={styles.compressingText}>...</Text>
            </View>
          )}
        </ScrollView>
      )}

      <View style={styles.container}>
        <TouchableOpacity
          style={[styles.plusButton, showAttachMenu && styles.plusButtonActive]}
          onPress={toggleAttachMenu}
          activeOpacity={0.7}
          testID="attach-button"
        >
          <Animated.View style={{ transform: [{ rotate: plusRotation }] }}>
            <Plus size={20} color={showAttachMenu ? theme.colors.primary : theme.colors.textSecondary} />
          </Animated.View>
        </TouchableOpacity>

        <Animated.View style={[styles.inputWrapper, { borderColor }]}>
          <TextInput
            style={styles.input}
            value={message}
            onChangeText={setMessage}
            placeholder={placeholder}
            placeholderTextColor={theme.colors.textTertiary}
            multiline
            maxLength={4000}
            onFocus={handleFocus}
            onBlur={handleBlur}
            editable={!disabled}
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
            testID="chat-input"
          />
          {message.length > 0 && (
            <TouchableOpacity style={styles.clearButton} onPress={() => setMessage('')}>
              <X size={16} color={theme.colors.textTertiary} />
            </TouchableOpacity>
          )}
        </Animated.View>

        {isStreaming ? (
          <Animated.View style={{
            transform: [{ scale: stopScaleAnim }],
          }}>
            <TouchableOpacity
              style={styles.stopButton}
              onPress={handleStop}
              activeOpacity={0.7}
              testID="stop-button"
            >
              <Animated.View style={[
                styles.stopButtonPulse,
                {
                  opacity: stopPulseAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 0.4],
                  }),
                  transform: [{
                    scale: stopPulseAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.6],
                    }),
                  }],
                },
              ]} />
              <Square size={14} color="#fff" fill="#fff" />
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            <TouchableOpacity
              style={[styles.sendButton, hasContent && !disabled ? styles.sendButtonActive : null]}
              onPress={handleSend}
              disabled={!hasContent || disabled}
              activeOpacity={0.7}
              testID="send-button"
            >
              <Send
                size={18}
                color={hasContent && !disabled ? '#fff' : theme.colors.textTertiary}
              />
            </TouchableOpacity>
          </Animated.View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  outerContainer: {
    backgroundColor: theme.colors.background,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
  },
  plusButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  plusButtonActive: {
    backgroundColor: theme.colors.primaryMuted,
    borderColor: theme.colors.primary + '40',
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: theme.colors.surface,
    borderRadius: 22,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minHeight: 40,
    maxHeight: 120,
  },
  input: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 15,
    paddingVertical: 4,
    maxHeight: 100,
  },
  clearButton: {
    padding: 4,
    marginLeft: 4,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonActive: {
    backgroundColor: theme.colors.primary,
  },
  stopButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible' as const,
  },
  stopButtonPulse: {
    position: 'absolute' as const,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.error,
  },
  attachMenu: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  attachOption: {
    alignItems: 'center',
    gap: 6,
  },
  attachIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  attachLabel: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    fontWeight: '500' as const,
  },
  attachmentBar: {
    maxHeight: 80,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  attachmentBarContent: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 10,
    flexDirection: 'row',
  },
  attachmentPreview: {
    width: 60,
    alignItems: 'center',
  },
  attachmentThumb: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: theme.colors.surface,
  },
  attachmentFileIcon: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  attachmentRemove: {
    position: 'absolute',
    top: -4,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: theme.colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentName: {
    fontSize: 9,
    color: theme.colors.textSecondary,
    marginTop: 3,
    maxWidth: 58,
    textAlign: 'center',
  },
  compressingIndicator: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.primary + '40',
  },
  compressingText: {
    fontSize: 9,
    color: theme.colors.primary,
    marginTop: 2,
  },
});
