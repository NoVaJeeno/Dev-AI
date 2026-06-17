import React from 'react';
import { Tabs } from 'expo-router';
import { MessageSquare, FolderKanban, FolderOpen, Code2, Settings, Terminal, ShieldCheck, Bot } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { View, StyleSheet, Platform } from 'react-native';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textTertiary,
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarItemStyle: styles.tabBarItem,
      }}
    >
      <Tabs.Screen
        name="(chat)"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={[styles.iconContainer, focused && styles.iconContainerActive]}>
              <MessageSquare size={size - 2} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: 'Projekte',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={[styles.iconContainer, focused && styles.iconContainerActive]}>
              <FolderKanban size={size - 2} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="files"
        options={{
          title: 'Dateien',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={[styles.iconContainer, focused && styles.iconContainerActive]}>
              <FolderOpen size={size - 2} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="tools"
        options={{
          title: 'Tools',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={[styles.iconContainer, focused && styles.iconContainerActive]}>
              <Code2 size={size - 2} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="terminal"
        options={{
          title: 'Terminal',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={[styles.iconContainer, focused && styles.iconContainerActive]}>
              <Terminal size={size - 2} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="healing"
        options={{
          title: 'Healing',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={[styles.iconContainer, focused && styles.iconContainerHealing]}>
              <ShieldCheck size={size - 2} color={focused ? '#10b981' : color} />
            </View>
          ),
          tabBarActiveTintColor: '#10b981',
        }}
      />
      <Tabs.Screen
        name="healing-chat"
        options={{
          title: 'AI Agent',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={[styles.iconContainer, focused && styles.iconContainerHealing]}>
              <Bot size={size - 2} color={focused ? '#10b981' : color} />
            </View>
          ),
          tabBarActiveTintColor: '#10b981',
        }}
      />
      <Tabs.Screen
        name="workspace"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={[styles.iconContainer, focused && styles.iconContainerActive]}>
              <Settings size={size - 2} color={color} />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: theme.colors.backgroundSecondary,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 6,
    ...(Platform.OS === 'web' ? { height: 65, paddingBottom: 10 } : {}),
  },
  tabBarLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    marginTop: 2,
  },
  tabBarItem: {
    paddingVertical: 2,
  },
  iconContainer: {
    width: 36,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  iconContainerActive: {
    backgroundColor: theme.colors.primaryMuted,
  },
  iconContainerHealing: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
});
