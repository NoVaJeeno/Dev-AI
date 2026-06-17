import { Stack } from 'expo-router';
import { theme } from '@/constants/theme';

export default function FilesLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    />
  );
}
