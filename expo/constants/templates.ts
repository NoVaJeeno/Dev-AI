import { Project } from '@/types';

interface TemplateFile {
  path: string;
  content: string;
}

interface ProjectTemplate {
  type: Project['type'];
  description: string;
  files: TemplateFile[];
}

export const PROJECT_TEMPLATES: Record<string, ProjectTemplate> = {
  'react-native-app': {
    type: 'react-native',
    description: 'React Native App mit Expo, Navigation und grundlegender Struktur',
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "{{PROJECT_NAME}}",
  "version": "1.0.0",
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "web": "expo start --web"
  },
  "dependencies": {
    "expo": "~54.0.0",
    "expo-router": "~6.0.0",
    "react": "19.1.0",
    "react-native": "0.81.5",
    "react-native-safe-area-context": "~5.6.0",
    "react-native-screens": "~4.16.0"
  },
  "devDependencies": {
    "typescript": "~5.9.0",
    "@types/react": "~19.1.0"
  }
}`,
      },
      {
        path: 'tsconfig.json',
        content: `{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": { "@/*": ["./*"] }
  }
}`,
      },
      {
        path: 'app/_layout.tsx',
        content: `import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}`,
      },
      {
        path: 'app/index.tsx',
        content: `import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>{{PROJECT_NAME}}</Text>
        <Text style={styles.subtitle}>Willkommen zu deiner App!</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  title: { fontSize: 32, fontWeight: '700', color: '#fff', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#888' },
});`,
      },
    ],
  },

  'nextjs-app': {
    type: 'web',
    description: 'Next.js Web App mit App Router und Tailwind CSS',
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "{{PROJECT_NAME}}",
  "version": "1.0.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "latest",
    "react": "latest",
    "react-dom": "latest"
  },
  "devDependencies": {
    "typescript": "latest",
    "@types/react": "latest",
    "tailwindcss": "latest",
    "autoprefixer": "latest",
    "postcss": "latest"
  }
}`,
      },
      {
        path: 'app/layout.tsx',
        content: `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '{{PROJECT_NAME}}',
  description: 'Built with Next.js',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}`,
      },
      {
        path: 'app/page.tsx',
        content: `export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="text-center">
        <h1 className="text-5xl font-bold text-white mb-4">{{PROJECT_NAME}}</h1>
        <p className="text-gray-400 text-lg">Willkommen zu deiner Web App!</p>
      </div>
    </main>
  );
}`,
      },
      {
        path: 'app/globals.css',
        content: `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}`,
      },
      {
        path: 'tailwind.config.ts',
        content: `import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: [],
};

export default config;`,
      },
    ],
  },

  'express-api': {
    type: 'api',
    description: 'Express.js REST API mit TypeScript, CORS und Error Handling',
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "{{PROJECT_NAME}}",
  "version": "1.0.0",
  "scripts": {
    "dev": "ts-node-dev --respawn src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "express": "latest",
    "cors": "latest",
    "dotenv": "latest"
  },
  "devDependencies": {
    "typescript": "latest",
    "@types/express": "latest",
    "@types/cors": "latest",
    "ts-node-dev": "latest"
  }
}`,
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}`,
      },
      {
        path: 'src/index.ts',
        content: `import express from 'express';
import cors from 'cors';
import { router } from './routes';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/api', router);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});`,
      },
      {
        path: 'src/routes/index.ts',
        content: `import { Router } from 'express';

export const router = Router();

router.get('/', (_req, res) => {
  res.json({ message: 'Welcome to {{PROJECT_NAME}} API' });
});

router.get('/items', (_req, res) => {
  res.json({ items: [], total: 0 });
});`,
      },
    ],
  },

  'landing-page': {
    type: 'web',
    description: 'Moderne Landing Page mit HTML, CSS und JavaScript',
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{PROJECT_NAME}}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <nav class="navbar">
    <div class="container">
      <a href="#" class="logo">{{PROJECT_NAME}}</a>
      <div class="nav-links">
        <a href="#features">Features</a>
        <a href="#about">About</a>
        <a href="#contact">Kontakt</a>
        <a href="#" class="btn btn-primary">Jetzt starten</a>
      </div>
    </div>
  </nav>

  <section class="hero">
    <div class="container">
      <h1 class="hero-title">{{PROJECT_NAME}}</h1>
      <p class="hero-subtitle">Die moderne Lösung für dein Business</p>
      <div class="hero-actions">
        <a href="#" class="btn btn-primary btn-lg">Kostenlos testen</a>
        <a href="#" class="btn btn-outline btn-lg">Mehr erfahren</a>
      </div>
    </div>
  </section>

  <section id="features" class="features">
    <div class="container">
      <h2 class="section-title">Features</h2>
      <div class="features-grid">
        <div class="feature-card">
          <div class="feature-icon">⚡</div>
          <h3>Schnell</h3>
          <p>Blitzschnelle Performance für optimale Nutzererfahrung.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🔒</div>
          <h3>Sicher</h3>
          <p>Enterprise-Level Sicherheit für deine Daten.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🎨</div>
          <h3>Modern</h3>
          <p>Zeitgemäßes Design das begeistert.</p>
        </div>
      </div>
    </div>
  </section>

  <footer class="footer">
    <div class="container">
      <p>&copy; 2026 {{PROJECT_NAME}}. Alle Rechte vorbehalten.</p>
    </div>
  </footer>

  <script src="main.js"></script>
</body>
</html>`,
      },
      {
        path: 'styles.css',
        content: `* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --primary: #00d4ff;
  --bg: #0a0a0f;
  --surface: #12121a;
  --text: #ffffff;
  --text-secondary: #a0a0b0;
  --border: #2a2a3a;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}

.container { max-width: 1200px; margin: 0 auto; padding: 0 20px; }

.navbar {
  position: fixed; top: 0; width: 100%; z-index: 100;
  background: rgba(10, 10, 15, 0.9); backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border); padding: 16px 0;
}
.navbar .container { display: flex; align-items: center; justify-content: space-between; }
.logo { color: var(--primary); font-size: 20px; font-weight: 700; text-decoration: none; }
.nav-links { display: flex; align-items: center; gap: 24px; }
.nav-links a { color: var(--text-secondary); text-decoration: none; font-size: 14px; transition: color 0.2s; }
.nav-links a:hover { color: var(--text); }

.btn {
  display: inline-block; padding: 10px 24px; border-radius: 8px;
  font-weight: 600; text-decoration: none; transition: all 0.2s; font-size: 14px; cursor: pointer; border: none;
}
.btn-primary { background: var(--primary); color: var(--bg); }
.btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }
.btn-outline { border: 1px solid var(--border); color: var(--text); background: transparent; }
.btn-outline:hover { border-color: var(--primary); color: var(--primary); }
.btn-lg { padding: 14px 32px; font-size: 16px; }

.hero {
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  text-align: center; padding-top: 80px;
}
.hero-title { font-size: 64px; font-weight: 800; margin-bottom: 16px; background: linear-gradient(135deg, var(--primary), #7c3aed); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.hero-subtitle { font-size: 20px; color: var(--text-secondary); margin-bottom: 40px; }
.hero-actions { display: flex; gap: 16px; justify-content: center; }

.features { padding: 100px 0; }
.section-title { font-size: 36px; font-weight: 700; text-align: center; margin-bottom: 60px; }
.features-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; }
.feature-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 16px; padding: 32px; text-align: center; transition: transform 0.2s;
}
.feature-card:hover { transform: translateY(-4px); }
.feature-icon { font-size: 48px; margin-bottom: 16px; }
.feature-card h3 { font-size: 20px; margin-bottom: 8px; }
.feature-card p { color: var(--text-secondary); font-size: 14px; }

.footer { padding: 40px 0; border-top: 1px solid var(--border); text-align: center; color: var(--text-secondary); font-size: 14px; }

@media (max-width: 768px) {
  .hero-title { font-size: 36px; }
  .hero-actions { flex-direction: column; align-items: center; }
  .nav-links { display: none; }
}`,
      },
      {
        path: 'main.js',
        content: `document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      if (href === '#') return;
      e.preventDefault();
      const target = document.querySelector(href);
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    });
  });

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.feature-card').forEach(card => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    card.style.transition = 'opacity 0.6s, transform 0.6s';
    observer.observe(card);
  });
});`,
      },
    ],
  },

  'react-dashboard': {
    type: 'web',
    description: 'React Dashboard mit Sidebar, Charts-Platzhalter und responsivem Layout',
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "{{PROJECT_NAME}}",
  "version": "1.0.0",
  "dependencies": {
    "react": "latest",
    "react-dom": "latest",
    "react-router-dom": "latest"
  },
  "devDependencies": {
    "typescript": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "vite": "latest",
    "@vitejs/plugin-react": "latest"
  }
}`,
      },
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{PROJECT_NAME}}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="root"></div>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script type="text/babel" src="App.jsx"></script>
</body>
</html>`,
      },
      {
        path: 'App.jsx',
        content: `function App() {
  const [activeTab, setActiveTab] = React.useState('dashboard');

  const stats = [
    { label: 'Users', value: '12,847', change: '+12%', color: '#00d4ff' },
    { label: 'Revenue', value: '$48,294', change: '+8%', color: '#10b981' },
    { label: 'Orders', value: '1,284', change: '+23%', color: '#7c3aed' },
    { label: 'Growth', value: '94%', change: '+5%', color: '#f59e0b' },
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-logo">{{PROJECT_NAME}}</div>
        <nav className="sidebar-nav">
          {['dashboard', 'analytics', 'users', 'settings'].map(tab => (
            <button key={tab} className={\`nav-item \${activeTab === tab ? 'active' : ''}\`} onClick={() => setActiveTab(tab)}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <h1>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</h1>
        </header>
        <div className="content">
          <div className="stats-grid">
            {stats.map(stat => (
              <div key={stat.label} className="stat-card">
                <span className="stat-label">{stat.label}</span>
                <span className="stat-value">{stat.value}</span>
                <span className="stat-change" style={{color: stat.color}}>{stat.change}</span>
              </div>
            ))}
          </div>
          <div className="chart-placeholder">
            <p>Chart wird hier angezeigt</p>
          </div>
        </div>
      </main>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));`,
      },
      {
        path: 'styles.css',
        content: `* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, sans-serif; background: #0a0a0f; color: #fff; }
.app { display: flex; min-height: 100vh; }
.sidebar { width: 240px; background: #12121a; border-right: 1px solid #2a2a3a; padding: 20px; }
.sidebar-logo { font-size: 18px; font-weight: 700; color: #00d4ff; margin-bottom: 32px; }
.sidebar-nav { display: flex; flex-direction: column; gap: 4px; }
.nav-item { background: none; border: none; color: #a0a0b0; padding: 10px 14px; border-radius: 8px; text-align: left; cursor: pointer; font-size: 14px; }
.nav-item:hover { background: #1e1e2e; color: #fff; }
.nav-item.active { background: #00d4ff20; color: #00d4ff; }
.main { flex: 1; }
.topbar { padding: 20px 24px; border-bottom: 1px solid #2a2a3a; }
.topbar h1 { font-size: 24px; }
.content { padding: 24px; }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
.stat-card { background: #12121a; border: 1px solid #2a2a3a; border-radius: 12px; padding: 20px; }
.stat-label { display: block; color: #a0a0b0; font-size: 13px; margin-bottom: 8px; }
.stat-value { display: block; font-size: 28px; font-weight: 700; margin-bottom: 4px; }
.stat-change { font-size: 13px; font-weight: 600; }
.chart-placeholder { background: #12121a; border: 1px solid #2a2a3a; border-radius: 12px; padding: 60px; text-align: center; color: #606070; }`,
      },
    ],
  },
};
