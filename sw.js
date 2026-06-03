const CACHE_NAME = 'thumbsync-cache-v1';
const ASSETS_TO_CACHE = [
  'index.html',
  'app.js',
  'favicon.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable.png',
  'manifest.webmanifest',
  'logodosite.jpg',
  'mock_data/lista.txt'
];

// Instalação do Service Worker - fazendo cache estático inicial resiliente
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Faz o cache dos assets um por um. Assim, se o 'app.js' original não existir devido à compilação/hash do Vite,
      // as outras peças (index, manifest, favicon, etc.) ainda são cacheadas com sucesso.
      const cachePromises = ASSETS_TO_CACHE.map((asset) => {
        return cache.add(asset).catch(err => {
          console.warn(`Pré-caching ignorado ou falhou para o asset individual: ${asset}`, err);
        });
      });
      return Promise.all(cachePromises);
    }).then(() => self.skipWaiting())
  );
});

// Ativação do Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Removendo cache antigo:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Interceptação de requisições de rede
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Se for uma requisição de API, bypass total (sempre direto para a rede) para garantir frescor dos dados
  if (url.pathname.includes('/api/') || event.request.method !== 'GET') {
    return; // Deixa o navegador tratar normalmente (sempre rede)
  }

  // Para outros assets estáticos, tenta Rede primeiro e se falhar (ex: offline), busca no Cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Se a resposta for válida, coloca uma cópia no cache (se for do mesmo site/origem)
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Se a rede falhar (offline), tenta recuperar do cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Fallback dinâmico opcional se aplicável
        });
      })
  );
});
