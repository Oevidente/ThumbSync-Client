const CACHE_NAME = 'thumbsync-cache-v1';
const ASSETS_TO_CACHE = [
  'index.html',
  'app.js',
  'favicon.png',
  'manifest.webmanifest',
  'logodosite.jpg'
];

// Instalação do Service Worker - fazendo cache estático inicial simples
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Faz o cache apenas dos assets básicos. Silencia falhas individuais de cache para não impedir instalação.
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn('Erro preliminar de caching de assets:', err);
      });
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
