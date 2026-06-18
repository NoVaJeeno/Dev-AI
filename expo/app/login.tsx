import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Shield, Eye, EyeOff, Lock, Zap, Terminal, Code, ChevronRight } from 'lucide-react-native';
import { Haptics } from '@/utils/haptics';
import { useAuth } from '@/providers/AuthProvider';
import { router } from 'expo-router';

const { width, height } = Dimensions.get('window');

export default function LoginScreen() {
  const { login } = useAuth();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const logoScale = useRef(new Animated.Value(0)).current;
  const logoRotate = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleSlide = useRef(new Animated.Value(30)).current;
  const subtitleOpacity = useRef(new Animated.Value(0)).current;
  const formOpacity = useRef(new Animated.Value(0)).current;
  const formSlide = useRef(new Animated.Value(50)).current;
  const particleAnim = useRef(new Animated.Value(0)).current;
  const glowPulse = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;
  const ringScale = useRef(new Animated.Value(0.8)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const sequence = Animated.stagger(150, [
      Animated.parallel([
        Animated.spring(logoScale, { toValue: 1, tension: 50, friction: 7, useNativeDriver: true }),
        Animated.timing(logoRotate, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(titleOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(titleSlide, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }),
      ]),
      Animated.timing(subtitleOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(formOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(formSlide, { toValue: 0, tension: 50, friction: 10, useNativeDriver: true }),
      ]),
    ]);
    sequence.start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(glowPulse, { toValue: 1, duration: 2000, useNativeDriver: false }),
        Animated.timing(glowPulse, { toValue: 0, duration: 2000, useNativeDriver: false }),
      ])
    ).start();

    Animated.loop(
      Animated.timing(particleAnim, { toValue: 1, duration: 6000, useNativeDriver: true })
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(ringScale, { toValue: 1.5, duration: 3000, useNativeDriver: true }),
          Animated.timing(ringOpacity, { toValue: 0.6, duration: 500, useNativeDriver: true }),
        ]),
        Animated.timing(ringOpacity, { toValue: 0, duration: 2500, useNativeDriver: true }),
        Animated.timing(ringScale, { toValue: 0.8, duration: 0, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const triggerShake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 12, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -12, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 4, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handleLogin = async () => {
    if (!password.trim() || isLoading) return;
    Keyboard.dismiss();
    setIsLoading(true);
    setError('');

    Animated.sequence([
      Animated.timing(buttonScale, { toValue: 0.92, duration: 80, useNativeDriver: true }),
      Animated.spring(buttonScale, { toValue: 1, tension: 200, friction: 10, useNativeDriver: true }),
    ]).start();

    await new Promise(resolve => setTimeout(resolve, 600));

    const success = await login(password);
    if (success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/' as never);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setAttempts(prev => prev + 1);
      setError('Falsches Passwort');
      triggerShake();
      setIsLoading(false);
    }
  };

  const logoRotation = logoRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['-180deg', '0deg'],
  });

  const glowColor = glowPulse.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(0, 200, 255, 0.05)', 'rgba(0, 200, 255, 0.15)'],
  });

  const particle1Y = particleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [height, -50],
  });

  const particle2Y = particleAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [height + 100, -50, height + 100],
  });

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['#030508', '#06080d', '#0a0e18', '#06080d']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      <Animated.View style={[styles.particle, { top: particle1Y, left: width * 0.2, opacity: 0.3 }]}>
        <View style={[styles.particleDot, { backgroundColor: '#00c8ff' }]} />
      </Animated.View>
      <Animated.View style={[styles.particle, { top: particle2Y, left: width * 0.7, opacity: 0.2 }]}>
        <View style={[styles.particleDot, { backgroundColor: '#8b5cf6', width: 4, height: 4 }]} />
      </Animated.View>
      <Animated.View style={[styles.particle, { top: particle1Y, left: width * 0.5, opacity: 0.15 }]}>
        <View style={[styles.particleDot, { backgroundColor: '#10b981', width: 3, height: 3 }]} />
      </Animated.View>

      <Animated.View style={[styles.gridOverlay, { backgroundColor: glowColor }]} />

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <Animated.View style={[styles.logoArea, { transform: [{ scale: logoScale }, { rotate: logoRotation }] }]}>
            <Animated.View style={[styles.pulseRing, { transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
            <View style={styles.logoOuter}>
              <LinearGradient
                colors={['#00c8ff', '#0098cc', '#8b5cf6']}
                style={styles.logoGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Shield size={40} color="#fff" />
              </LinearGradient>
            </View>
          </Animated.View>

          <Animated.View style={{ opacity: titleOpacity, transform: [{ translateY: titleSlide }] }}>
            <Text style={styles.title}>Developer AI</Text>
          </Animated.View>

          <Animated.View style={{ opacity: subtitleOpacity }}>
            <Text style={styles.subtitle}>Intelligente Entwicklungsumgebung</Text>
            <View style={styles.featureRow}>
              {[
                { icon: <Terminal size={12} color="#00c8ff" />, label: 'Full-Stack' },
                { icon: <Code size={12} color="#8b5cf6" />, label: '25+ Tools' },
                { icon: <Zap size={12} color="#10b981" />, label: 'Self-Healing' },
              ].map((feat) => (
                <View key={feat.label} style={styles.featureBadge}>
                  {feat.icon}
                  <Text style={styles.featureText}>{feat.label}</Text>
                </View>
              ))}
            </View>
          </Animated.View>

          <Animated.View
            style={[
              styles.formArea,
              {
                opacity: formOpacity,
                transform: [{ translateY: formSlide }, { translateX: shakeAnim }],
              },
            ]}
          >
            <View style={[styles.inputContainer, error ? styles.inputError : null]}>
              <Lock size={18} color={error ? '#ef4444' : '#505568'} />
              <TextInput
                style={styles.input}
                placeholder="Passwort eingeben"
                placeholderTextColor="#505568"
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={(t) => { setPassword(t); setError(''); }}
                onSubmitEditing={handleLogin}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                testID="password-input"
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                {showPassword ? (
                  <EyeOff size={18} color="#505568" />
                ) : (
                  <Eye size={18} color="#505568" />
                )}
              </TouchableOpacity>
            </View>

            {error ? (
              <Animated.View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
                {attempts >= 3 && (
                  <Text style={styles.errorHint}>Hinweis: Überprüfe Groß-/Kleinschreibung</Text>
                )}
              </Animated.View>
            ) : null}

            <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
              <TouchableOpacity
                style={[styles.loginButton, isLoading && styles.loginButtonLoading]}
                onPress={handleLogin}
                disabled={isLoading || !password.trim()}
                activeOpacity={0.8}
                testID="login-button"
              >
                <LinearGradient
                  colors={isLoading ? ['#0098cc', '#006688'] : ['#00c8ff', '#0098cc']}
                  style={styles.loginButtonGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                >
                  {isLoading ? (
                    <Text style={styles.loginButtonText}>Verifiziere...</Text>
                  ) : (
                    <>
                      <Text style={styles.loginButtonText}>Anmelden</Text>
                      <ChevronRight size={20} color="#fff" />
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>

          <View style={styles.footer}>
            <View style={styles.securityBadge}>
              <Shield size={11} color="#22c55e" />
              <Text style={styles.securityText}>Verschlüsselte Verbindung</Text>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#030508',
  },
  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  particle: {
    position: 'absolute',
  },
  particleDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
  },
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  logoArea: {
    marginBottom: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 200, 255, 0.3)',
  },
  logoOuter: {
    width: 88,
    height: 88,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(0, 200, 255, 0.25)',
  },
  logoGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '800' as const,
    color: '#eef0f6',
    textAlign: 'center' as const,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: '#8b90a0',
    textAlign: 'center' as const,
    marginTop: 6,
    marginBottom: 16,
  },
  featureRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 36,
    justifyContent: 'center',
  },
  featureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  featureText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: '#8b90a0',
  },
  formArea: {
    width: '100%',
    maxWidth: 360,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d1017',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#1e2538',
    paddingHorizontal: 16,
    height: 56,
    gap: 12,
  },
  inputError: {
    borderColor: 'rgba(239, 68, 68, 0.5)',
    backgroundColor: 'rgba(239, 68, 68, 0.03)',
  },
  input: {
    flex: 1,
    color: '#eef0f6',
    fontSize: 16,
    paddingVertical: 0,
  },
  eyeButton: {
    padding: 4,
  },
  errorContainer: {
    marginTop: 10,
    paddingHorizontal: 4,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '500' as const,
  },
  errorHint: {
    color: '#8b90a0',
    fontSize: 11,
    marginTop: 3,
  },
  loginButton: {
    marginTop: 16,
    borderRadius: 16,
    overflow: 'hidden',
  },
  loginButtonLoading: {
    opacity: 0.85,
  },
  loginButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 54,
    gap: 8,
  },
  loginButtonText: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#fff',
  },
  footer: {
    marginTop: 40,
    alignItems: 'center',
  },
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(34, 197, 94, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.12)',
  },
  securityText: {
    fontSize: 11,
    color: '#22c55e',
    fontWeight: '500' as const,
  },
});
