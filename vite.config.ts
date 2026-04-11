import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
  
  server: {
    port: 3007,
    host: '0.0.0.0',
    allowedHosts: [
      'futebol.felixsystems.com.br',
      'localhost',
      '127.0.0.1',
      '172.19.0.2'
    ],
    // Configuração para HMR funcionar com domínio customizado
    hmr: {
      host: 'localhost',
      port: 3007
    },
    // Headers CORS para desenvolvimento
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization'
    },
    // Proxy para APIs externas (resolve CORS)
    proxy: {
      '/api/proxy/football-data': {
        target: 'https://api.football-data.org/v4',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/proxy\/football-data/, ''),
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            // Adiciona headers da API
            if (req.body && req.body.headers) {
              Object.entries(req.body.headers).forEach(([key, value]) => {
                if (value) proxyReq.setHeader(key, value as string);
              });
            }
          });
        }
      },
      '/api/proxy/api-football': {
        target: 'https://v3.football.api-sports.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/proxy\/api-football/, '')
      }
    }
  }
})
