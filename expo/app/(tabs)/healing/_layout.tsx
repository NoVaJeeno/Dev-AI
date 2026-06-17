import { Stack } from 'expo-router';
import { theme } from '@/constants/theme';

export default function HealingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    />
  );
}
