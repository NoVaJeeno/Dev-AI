import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Animated,
  Dimensions,
} from 'react-native';
import {
  X,
  Maximize2,
  Minimize2,
  RefreshCw,
  Smartphone,
  Monitor,
  Tablet,
  Download,
  Code,
  Eye,
  Play,
} from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { Project } from '@/types';

interface LivePreviewProps {
  project: Project;
  visible: boolean;
  onClose: () => void;
  onSaveLocal: (project: Project) => void;
}

type DeviceMode = 'phone' | 'tablet' | 'desktop';

const DEVICE_SIZES: Record<DeviceMode, { width: number; height: number }> = {
  phone: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: Dimensions.get('window').width - 40, height: Dimensions.get('window').height - 200 },
};

function buildHtmlBundle(project: Project): string {
  try {
    const htmlFile = project.files.find(
      f => f.type === 'file' && (f.name === 'index.html' || f.path.endsWith('.html'))
    );
    const cssFiles = project.files.filter(f => f.type === 'file' && f.name.endsWith('.css'));
    const jsFiles = project.files.filter(
      f => f.type === 'file' && (f.name.endsWith('.js') || f.name.endsWith('.jsx')) && !f.name.endsWith('.test.js')
    );

    if (htmlFile) {
      let html = htmlFile.content;
      const cssInject = cssFiles.map(f => `<style>${f.content}</style>`).join('\n');
      const jsInject = jsFiles.map(f => `<script>${f.content}<\/script>`).join('\n');
      if (html.includes('</head>')) {
        html = html.replace('</head>', `${cssInject}\n</head>`);
      } else {
        html = `${cssInject}\n${html}`;
      }
      if (html.includes('</body>')) {
        html = html.replace('</body>', `${jsInject}\n</body>`);
      } else {
        html = `${html}\n${jsInject}`;
      }
      return html;
    }

    const mainTsx = project.files.find(
      f => f.type === 'file' && (f.path === 'App.tsx' || f.path === 'App.jsx' || f.path === 'src/App.tsx' || f.path === 'src/App.jsx')
    );
    const mainJs = project.files.find(
      f => f.type === 'file' && (f.path === 'index.js' || f.path === 'src/index.js' || f.path === 'main.js')
    );
    const allCss = cssFiles.map(f => f.content).join('\n');

    if (project.type === 'web' || mainTsx || mainJs) {
      const appCode = mainTsx?.content || mainJs?.content || '';
      return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${project.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0a0a0f; color: #fff; }
    ${allCss}
  </style>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    ${appCode}
    try {
      if (typeof App !== 'undefined') {
        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(React.createElement(App));
      }
    } catch(e) {
      document.getElementById('root').innerHTML = '<div style="padding:20px;color:#ef4444;">' + e.message + '</div>';
    }
  <\/script>
</body>
</html>`;
    }

    const allCode = project.files
      .filter(f => f.type === 'file')
      .map(f => `// ${f.path}\n${f.content}`)
      .join('\n\n');

    return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${project.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: monospace; background: #0d1117; color: #e6edf3; padding: 20px; }
    .title { color: #00c8ff; font-size: 20px; margin-bottom: 8px; }
    .file-section { background: #161b22; border: 1px solid #30363d; border-radius: 8px; margin-bottom: 12px; overflow: hidden; }
    .file-header { background: #1c2129; padding: 8px 12px; border-bottom: 1px solid #30363d; font-size: 13px; color: #00c8ff; }
    .file-content { padding: 12px; font-size: 13px; white-space: pre-wrap; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="title">${project.name}</div>
  ${project.files.filter(f => f.type === 'file').map(f =>
    `<div class="file-section"><div class="file-header">${f.path}</div><div class="file-content">${f.content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div></div>`
  ).join('\n')}
</body>
</html>`;
  } catch (e) {
    return `<html><body style="background:#0d1117;color:#ef4444;padding:20px;font-family:monospace;">Build Error: ${e}</body></html>`;
  }
}

export const LivePreview: React.FC<LivePreviewProps> = React.memo(
  ({ project, visible, onClose, onSaveLocal }) => {
    const [deviceMode, setDeviceMode] = useState<DeviceMode>('phone');
    const [showCode, setShowCode] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const slideAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      Animated.spring(slideAnim, {
        toValue: visible ? 1 : 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
    }, [visible, slideAnim]);

    const htmlContent = useCallback(() => {
      return buildHtmlBundle(project);
    }, [project, refreshKey]);

    const handleRefresh = useCallback(() => {
      setRefreshKey(k => k + 1);
    }, []);

    const handleSaveLocal = useCallback(() => {
      onSaveLocal(project);
    }, [project, onSaveLocal]);

    if (!visible) return null;

    const deviceSize = DEVICE_SIZES[deviceMode];
    const html = htmlContent();

    return (
      <Animated.View
        style={[
          styles.container,
          isFullscreen && styles.containerFullscreen,
          {
            opacity: slideAnim,
            transform: [{
              translateY: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }),
            }],
          },
        ]}
      >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.statusDot} />
            <Text style={styles.headerTitle} numberOfLines={1}>{project.name}</Text>
            <View style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>{project.type}</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.headerButton} onPress={handleRefresh}>
              <RefreshCw size={14} color={theme.colors.text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerButton} onPress={() => setIsFullscreen(!isFullscreen)}>
              {isFullscreen ? <Minimize2 size={14} color={theme.colors.text} /> : <Maximize2 size={14} color={theme.colors.text} />}
            </TouchableOpacity>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <X size={14} color={theme.colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.toolbar}>
          <View style={styles.deviceSelector}>
            {([['phone', Smartphone], ['tablet', Tablet], ['desktop', Monitor]] as const).map(([mode, Icon]) => (
              <TouchableOpacity
                key={mode}
                style={[styles.deviceButton, deviceMode === mode && styles.deviceButtonActive]}
                onPress={() => setDeviceMode(mode)}
              >
                <Icon size={13} color={deviceMode === mode ? theme.colors.primary : theme.colors.textTertiary} />
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.toolbarRight}>
            <TouchableOpacity
              style={[styles.toolbarButton, showCode && styles.toolbarButtonActive]}
              onPress={() => setShowCode(true)}
            >
              <Code size={13} color={showCode ? theme.colors.primary : theme.colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toolbarButton, !showCode && styles.toolbarButtonActive]}
              onPress={() => setShowCode(false)}
            >
              <Eye size={13} color={!showCode ? theme.colors.primary : theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.previewArea}>
          {showCode ? (
            <ScrollView style={styles.codeView}>
              <Text style={styles.codeText}>{html}</Text>
            </ScrollView>
          ) : (
            <View style={[styles.previewFrame, { alignItems: 'center' }]}>
              {Platform.OS === 'web' ? (
                <View
                  style={[
                    styles.deviceFrame,
                    deviceMode === 'phone' && styles.phoneFrame,
                    {
                      width: Math.min(deviceSize.width, Dimensions.get('window').width - 40),
                      maxHeight: isFullscreen ? Dimensions.get('window').height - 160 : 380,
                    },
                  ]}
                >
                  <iframe
                    key={refreshKey}
                    srcDoc={html}
                    style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8, backgroundColor: '#0d1117' }}
                    sandbox="allow-scripts allow-same-origin allow-modals allow-forms allow-popups"
                    title={`Preview: ${project.name}`}
                  />
                </View>
              ) : (
                <View style={styles.nativePreview}>
                  <Play size={28} color={theme.colors.primary} />
                  <Text style={styles.nativePreviewTitle}>Live Preview</Text>
                  <Text style={styles.nativePreviewSubtitle}>
                    {project.files.filter(f => f.type === 'file').length} Dateien
                  </Text>
                  <View style={styles.fileList}>
                    {project.files.filter(f => f.type === 'file').slice(0, 6).map(f => (
                      <View key={f.id} style={styles.fileListItem}>
                        <View style={styles.fileDot} />
                        <Text style={styles.fileListText} numberOfLines={1}>{f.path}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerInfo}>{project.files.filter(f => f.type === 'file').length} Dateien</Text>
          <TouchableOpacity style={styles.saveButton} onPress={handleSaveLocal}>
            <Download size={14} color="#fff" />
            <Text style={styles.saveButtonText}>Speichern</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.backgroundSecondary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginHorizontal: 10,
    marginVertical: 6,
    overflow: 'hidden',
    maxHeight: 520,
  },
  containerFullscreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    margin: 0,
    borderRadius: 0,
    maxHeight: undefined,
    zIndex: 1000,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundTertiary,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: theme.colors.success,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: theme.colors.text,
    flex: 1,
  },
  typeBadge: {
    backgroundColor: theme.colors.primaryMuted,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  typeBadgeText: {
    fontSize: 9,
    fontWeight: '600' as const,
    color: theme.colors.primary,
    textTransform: 'uppercase' as const,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 4,
  },
  headerButton: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  deviceSelector: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderRadius: 7,
    padding: 2,
    gap: 2,
  },
  deviceButton: {
    width: 30,
    height: 26,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceButtonActive: {
    backgroundColor: theme.colors.backgroundTertiary,
  },
  toolbarRight: {
    flexDirection: 'row',
    gap: 3,
  },
  toolbarButton: {
    width: 30,
    height: 26,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbarButtonActive: {
    backgroundColor: theme.colors.primaryMuted,
  },
  previewArea: {
    flex: 1,
    minHeight: 260,
  },
  previewFrame: {
    flex: 1,
    backgroundColor: theme.colors.codeBackground,
    padding: 6,
  },
  deviceFrame: {
    flex: 1,
    backgroundColor: '#000',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: theme.colors.border,
  },
  phoneFrame: {
    borderRadius: 20,
    borderWidth: 3,
    borderColor: '#333',
  },
  codeView: {
    flex: 1,
    backgroundColor: theme.colors.codeBackground,
    padding: 10,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: theme.colors.codeText,
    lineHeight: 15,
  },
  nativePreview: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  nativePreviewTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: theme.colors.text,
    marginTop: 10,
  },
  nativePreviewSubtitle: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 3,
  },
  fileList: {
    marginTop: 14,
    width: '100%',
    gap: 5,
  },
  fileListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fileDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.primary,
  },
  fileListText: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    fontFamily: 'monospace',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundTertiary,
  },
  footerInfo: {
    fontSize: 11,
    color: theme.colors.textTertiary,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  saveButtonText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#fff',
  },
});
