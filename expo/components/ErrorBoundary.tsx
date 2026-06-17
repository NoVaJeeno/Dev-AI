import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, AppState } from 'react-native';
import { AlertTriangle, RefreshCw, Shield, Zap } from 'lucide-react-native';
import { theme } from '@/constants/theme';

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
  loopDetected: boolean;
}

const MAX_AUTO_RETRIES = 5;
const LOOP_WINDOW_MS = 12000;
const LOOP_THRESHOLD = 4;
const AUTO_RECOVER_DELAY = 600;

export class ErrorBoundary extends Component<Props, State> {
  private pulseAnim = new Animated.Value(1);
  private recoverTimeout: ReturnType<typeof setTimeout> | null = null;
  private errorTimestamps: number[] = [];
  private appStateSubscription: { remove: () => void } | null = null;
  private mounted = false;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      retryCount: 0,
      loopDetected: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    try {
      console.error('[ErrorBoundary] Caught:', error.message);
      if (errorInfo.componentStack) {
        console.error('[ErrorBoundary] Stack:', errorInfo.componentStack.substring(0, 500));
      }
    } catch {}
  }

  componentDidMount() {
    this.mounted = true;
  }

  componentDidUpdate(_: Props, prevState: State) {
    if (!this.mounted) return;

    if (this.state.hasError && !prevState.hasError) {
      const now = Date.now();
      this.errorTimestamps.push(now);
      this.errorTimestamps = this.errorTimestamps.filter(t => now - t < LOOP_WINDOW_MS);

      if (this.errorTimestamps.length >= LOOP_THRESHOLD) {
        this.setState({ loopDetected: true });
        this.startPulse();
        return;
      }

      if (this.state.retryCount >= MAX_AUTO_RETRIES) {
        this.startPulse();
        return;
      }

      this.recoverTimeout = setTimeout(() => {
        if (!this.mounted) return;
        this.setState(prev => ({
          hasError: false,
          error: null,
          retryCount: prev.retryCount + 1,
          loopDetected: false,
        }));
      }, AUTO_RECOVER_DELAY);
    }
  }

  componentWillUnmount() {
    this.mounted = false;
    if (this.recoverTimeout) clearTimeout(this.recoverTimeout);
    if (this.appStateSubscription) {
      try { this.appStateSubscription.remove(); } catch {}
    }
    try { this.pulseAnim.stopAnimation(); } catch {}
  }

  startPulse = () => {
    try {
      this.pulseAnim.stopAnimation();
      Animated.loop(
        Animated.sequence([
          Animated.timing(this.pulseAnim, { toValue: 0.5, duration: 1200, useNativeDriver: true }),
          Animated.timing(this.pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
        ])
      ).start();
    } catch {}
  };

  handleRetry = () => {
    this.errorTimestamps = [];
    try { this.pulseAnim.stopAnimation(); } catch {}
    this.pulseAnim.setValue(1);
    if (this.recoverTimeout) {
      clearTimeout(this.recoverTimeout);
      this.recoverTimeout = null;
    }
    this.setState({
      hasError: false,
      error: null,
      retryCount: 0,
      loopDetected: false,
    });
  };

  render() {
    if (this.state.hasError && (this.state.loopDetected || this.state.retryCount >= MAX_AUTO_RETRIES)) {
      return (
        <View style={styles.container}>
          <Animated.View style={[styles.iconWrap, { opacity: this.pulseAnim }]}>
            <AlertTriangle size={40} color="#ff6b6b" />
          </Animated.View>
          <Text style={styles.title}>
            {this.state.loopDetected ? 'Loop erkannt & gestoppt' : 'Fehler erkannt'}
          </Text>
          <Text style={styles.message}>
            {this.state.loopDetected
              ? 'Die App hat einen wiederholten Fehler erkannt und den Loop-Schutz aktiviert.'
              : (this.props.fallbackMessage || this.state.error?.message || 'Ein unerwarteter Fehler ist aufgetreten.')}
          </Text>
          <View style={styles.errorInfo}>
            <Shield size={14} color="#8b90a0" />
            <Text style={styles.errorInfoText}>
              {this.state.loopDetected
                ? `Loop-Schutz aktiv · ${this.state.retryCount} Versuche`
                : `${this.state.retryCount}/${MAX_AUTO_RETRIES} automatische Reparaturversuche`}
            </Text>
          </View>
          <TouchableOpacity style={styles.retryButton} onPress={this.handleRetry} activeOpacity={0.7}>
            <RefreshCw size={18} color="#06080d" />
            <Text style={styles.retryText}>App neu starten</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Animated.View style={{ opacity: this.pulseAnim }}>
            <View style={styles.recoveringIconWrap}>
              <Zap size={32} color={theme?.colors?.primary || '#00c8ff'} />
            </View>
          </Animated.View>
          <Text style={styles.title}>Selbstreparatur aktiv...</Text>
          <Text style={styles.message}>
            {this.state.retryCount > 0
              ? `Reparaturversuch ${this.state.retryCount}/${MAX_AUTO_RETRIES}...`
              : 'Die App erholt sich automatisch. Bitte warten...'}
          </Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${((this.state.retryCount + 1) / MAX_AUTO_RETRIES) * 100}%` }]} />
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#06080d',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 107, 107, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  recoveringIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 200, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 200, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: '#eef0f6',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: '#8b90a0',
    textAlign: 'center' as const,
    marginBottom: 20,
    lineHeight: 20,
  },
  errorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 28,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(139, 144, 160, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(139, 144, 160, 0.1)',
  },
  errorInfoText: {
    fontSize: 12,
    color: '#8b90a0',
  },
  progressBar: {
    width: 200,
    height: 4,
    backgroundColor: 'rgba(139, 144, 160, 0.1)',
    borderRadius: 2,
    overflow: 'hidden' as const,
    marginBottom: 28,
  },
  progressFill: {
    height: 4,
    backgroundColor: '#00c8ff',
    borderRadius: 2,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#00c8ff',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
  },
  retryText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#06080d',
  },
});
