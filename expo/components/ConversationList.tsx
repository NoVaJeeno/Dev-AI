import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  Dimensions,
} from 'react-native';
import { MessageSquare, Plus, Trash2, X } from 'lucide-react-native';
import { Conversation } from '@/types';
import { theme } from '@/constants/theme';
import { formatTimestamp } from '@/utils/helpers';

interface ConversationListProps {
  conversations: Conversation[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  visible: boolean;
}

const SIDEBAR_WIDTH = Math.min(300, Dimensions.get('window').width * 0.82);

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  currentId,
  onSelect,
  onNew,
  onDelete,
  onClose,
  visible,
}) => {
  const slideAnim = useRef(new Animated.Value(-SIDEBAR_WIDTH)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, tension: 65, friction: 11, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: -SIDEBAR_WIDTH, duration: 200, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, slideAnim, fadeAnim]);

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />
      </Animated.View>
      <Animated.View style={[styles.container, { transform: [{ translateX: slideAnim }] }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Chats</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.newButton} onPress={onNew} activeOpacity={0.7}>
              <Plus size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <X size={18} color={theme.colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {conversations.length === 0 ? (
            <View style={styles.empty}>
              <MessageSquare size={40} color={theme.colors.textTertiary} />
              <Text style={styles.emptyText}>Keine Chats</Text>
              <Text style={styles.emptySubtext}>Starte einen neuen Chat!</Text>
            </View>
          ) : (
            conversations.map((conversation) => (
              <TouchableOpacity
                key={conversation.id}
                style={[styles.item, currentId === conversation.id && styles.itemActive]}
                onPress={() => onSelect(conversation.id)}
                activeOpacity={0.7}
              >
                <View style={[styles.itemIcon, currentId === conversation.id && styles.itemIconActive]}>
                  <MessageSquare
                    size={16}
                    color={currentId === conversation.id ? theme.colors.primary : theme.colors.textSecondary}
                  />
                </View>
                <View style={styles.itemContent}>
                  <Text
                    style={[styles.itemTitle, currentId === conversation.id && styles.itemTitleActive]}
                    numberOfLines={1}
                  >
                    {conversation.title}
                  </Text>
                  <Text style={styles.itemMeta}>
                    {conversation.messages.length} Nachrichten · {formatTimestamp(conversation.updatedAt)}
                  </Text>
                </View>
                <TouchableOpacity style={styles.deleteButton} onPress={() => onDelete(conversation.id)}>
                  <Trash2 size={14} color={theme.colors.error} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: SIDEBAR_WIDTH,
    backgroundColor: theme.colors.backgroundSecondary,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: theme.colors.text,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 10,
  },
  newButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
    padding: 12,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    color: theme.colors.textSecondary,
    fontSize: 16,
    marginTop: 14,
  },
  emptySubtext: {
    color: theme.colors.textTertiary,
    fontSize: 13,
    marginTop: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: theme.colors.surface,
  },
  itemActive: {
    backgroundColor: theme.colors.primaryMuted,
    borderWidth: 1,
    borderColor: theme.colors.primary + '40',
  },
  itemIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: theme.colors.backgroundTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  itemIconActive: {
    backgroundColor: theme.colors.primary + '20',
  },
  itemContent: {
    flex: 1,
  },
  itemTitle: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '500' as const,
  },
  itemTitleActive: {
    color: theme.colors.primary,
  },
  itemMeta: {
    color: theme.colors.textTertiary,
    fontSize: 11,
    marginTop: 2,
  },
  deleteButton: {
    padding: 6,
  },
});
