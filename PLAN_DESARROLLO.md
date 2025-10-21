# Plan de Desarrollo - Dispatcher Omnicanalidad

## Objetivo
Convertir el dispatcher actual en un servicio de producción robusto, escalable y dockerizado, manteniendo simplicidad y evitando sobre-ingeniería.

## Principios de Desarrollo
- **Código limpio**: Separación de responsabilidades clara
- **Pragmático**: Solo lo necesario, sin complejidad innecesaria
- **Escalable**: Diseño horizontal-ready desde el inicio
- **Robusto**: Manejo de errores, retries, circuit breakers
- **Observable**: Logs, métricas y health checks completos

---

## Fase 1: Refactorización y Robustez (Semana 1-2)

### 1.1 Reestructuración del Código

**Objetivo**: Mejorar la organización sin cambiar funcionalidad

```
dispatcher/
├── src/
│   ├── config/
│   │   ├── index.js              # Configuración principal
│   │   └── apps.js               # Parser de aplicaciones
│   ├── middlewares/
│   │   ├── auth.js               # Autenticación
│   │   ├── validator.js          # Validación de requests
│   │   ├── errorHandler.js       # Manejo de errores centralizado
│   │   └── requestLogger.js      # Logging de requests
│   ├── services/
│   │   ├── redis.service.js      # Servicio Redis (con circuit breaker)
│   │   ├── whatsapp.service.js   # Servicio WhatsApp (con retry)
│   │   └── router.service.js     # Lógica de enrutamiento
│   ├── utils/
│   │   ├── logger.js             # Winston logger
│   │   ├── circuitBreaker.js     # Circuit breaker genérico
│   │   └── retry.js              # Retry logic genérico
│   ├── routes/
│   │   ├── index.js              # Router principal
│   │   ├── webhook.routes.js     # Rutas de webhook
│   │   └── admin.routes.js       # Rutas administrativas
│   ├── validators/
│   │   └── schemas.js            # Joi schemas
│   └── index.js                  # Entry point
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── .env.example
├── .dockerignore
├── Dockerfile
├── docker-compose.yml
├── docker-compose.prod.yml
└── package.json
```

### 1.2 Mejoras de Robustez

#### Circuit Breaker Pattern
- **Para qué**: Evitar llamadas a servicios caídos
- **Dónde**: Llamadas a apps externas (bot, software)
- **Biblioteca**: `opossum` (ligera, battle-tested)

```javascript
// src/utils/circuitBreaker.js
const CircuitBreaker = require('opossum');

function createBreaker(fn, options = {}) {
  return new CircuitBreaker(fn, {
    timeout: options.timeout || 10000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    ...options
  });
}
```

#### Retry Logic
- **Para qué**: Reintentos en fallos transitorios
- **Dónde**: Redis, WhatsApp API
- **Biblioteca**: `async-retry` o implementación simple

```javascript
// src/utils/retry.js
async function retry(fn, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const delay = options.delay || 1000;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(delay * Math.pow(2, i)); // Exponential backoff
    }
  }
}
```

#### Validación de Entrada
- **Biblioteca**: `joi` o `express-validator`
- **Dónde**: Todos los endpoints públicos

```javascript
// src/validators/schemas.js
const Joi = require('joi');

const enviarSchema = Joi.object({
  numero: Joi.string().pattern(/^549\d{10}$/).required(),
  mensaje: Joi.string().max(4096).required()
});

const transferirSchema = Joi.object({
  numero: Joi.string().pattern(/^549\d{10}$/).required(),
  app_destino: Joi.string().required(),
  contexto: Joi.object().optional()
});
```

#### Graceful Shutdown Mejorado
```javascript
// src/index.js
let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Recibido ${signal}, iniciando shutdown graceful...`);

  // Dejar de aceptar nuevas conexiones
  server.close(() => {
    logger.info('Servidor HTTP cerrado');
  });

  // Esperar requests en proceso (máximo 30s)
  await new Promise(resolve => setTimeout(resolve, 30000));

  // Cerrar conexiones
  await redis.disconnect();
  logger.info('Redis desconectado');

  process.exit(0);
}
```

### 1.3 Gestión de Errores Mejorada

```javascript
// src/middlewares/errorHandler.js
class AppError extends Error {
  constructor(message, statusCode, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
  }
}

function errorHandler(err, req, res, next) {
  err.statusCode = err.statusCode || 500;

  if (config.NODE_ENV === 'development') {
    res.status(err.statusCode).json({
      error: err.message,
      stack: err.stack
    });
  } else {
    // Producción: no exponer detalles
    if (err.isOperational) {
      res.status(err.statusCode).json({ error: err.message });
    } else {
      logger.error('Error no operacional:', err);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
}
```

---

## Fase 2: Containerización (Semana 2)

### 2.1 Dockerfile Multi-Stage Optimizado

```dockerfile
# Dockerfile
# Etapa 1: Dependencias
FROM node:18-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Etapa 2: Build (si hay TypeScript o build steps)
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src ./src
# Si necesitas build: RUN npm run build

# Etapa 3: Runtime
FROM node:18-alpine AS runtime

# Crear usuario no-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copiar solo lo necesario
COPY --from=dependencies --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs src ./src
COPY --chown=nodejs:nodejs package.json ./

# Crear directorio de logs
RUN mkdir -p logs && chown nodejs:nodejs logs

# Cambiar a usuario no-root
USER nodejs

# Exponer puerto
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Comando
CMD ["node", "src/index.js"]
```

### 2.2 Docker Compose para Desarrollo

```yaml
# docker-compose.yml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    container_name: dispatcher-redis
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3
    networks:
      - dispatcher-network

  dispatcher:
    build:
      context: .
      target: runtime
    container_name: dispatcher-app
    ports:
      - "8080:8080"
    depends_on:
      redis:
        condition: service_healthy
    environment:
      - NODE_ENV=development
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    env_file:
      - .env
    volumes:
      - ./src:/app/src  # Hot reload en desarrollo
      - ./logs:/app/logs
    restart: unless-stopped
    networks:
      - dispatcher-network
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

networks:
  dispatcher-network:
    driver: bridge

volumes:
  redis-data:
```

### 2.3 Docker Compose para Producción

```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure
        max_attempts: 3
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    networks:
      - dispatcher-network

  dispatcher:
    image: dispatcher:latest
    deploy:
      replicas: 3  # Escalar horizontalmente
      restart_policy:
        condition: on-failure
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
    environment:
      - NODE_ENV=production
      - REDIS_HOST=redis
    env_file:
      - .env.production
    networks:
      - dispatcher-network
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3

networks:
  dispatcher-network:

volumes:
  redis-data:
```

### 2.4 .dockerignore

```
node_modules
npm-debug.log
logs
*.log
.env
.env.local
.git
.gitignore
README.md
.vscode
.idea
coverage
.nyc_output
tests
*.test.js
*.spec.js
docker-compose*.yml
Dockerfile
```

---

## Fase 3: Escalabilidad (Semana 3)

### 3.1 Configuración para Múltiples Instancias

**Consideraciones clave:**
- Redis como estado compartido (ya implementado ✅)
- No hay estado en memoria (stateless) ✅
- Sessions en Redis (si es necesario)

**Mejoras necesarias:**

#### Rate Limiting Distribuido
```javascript
// Cambiar de express-rate-limit a rate-limiter-flexible
const { RateLimiterRedis } = require('rate-limiter-flexible');

const rateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'ratelimit',
  points: 100, // requests
  duration: 60, // por minuto
  blockDuration: 60 // bloquear por 60s
});

const rateLimiterMiddleware = async (req, res, next) => {
  try {
    await rateLimiter.consume(req.ip);
    next();
  } catch (err) {
    res.status(429).json({ error: 'Demasiadas solicitudes' });
  }
};
```

#### Lock Distribuido (si es necesario)
```javascript
// Para operaciones críticas que no pueden ejecutarse concurrentemente
const Redlock = require('redlock');

const redlock = new Redlock([redisClient], {
  retryCount: 3,
  retryDelay: 200
});

async function operacionCritica(numero) {
  const lock = await redlock.acquire([`lock:${numero}`], 5000);
  try {
    // operación crítica
  } finally {
    await lock.release();
  }
}
```

### 3.2 Load Balancing

**Docker Compose hace load balancing automático:**

Cuando escalas el servicio con múltiples réplicas:

```bash
docker-compose -f docker-compose.prod.yml up -d --scale dispatcher=3
```

Docker Compose automáticamente distribuye el tráfico entre las 3 instancias usando round-robin.

**¿Cuándo necesitas un load balancer externo (Nginx, HAProxy, etc.)?**

Solo en estos casos:
- Necesitas SSL/TLS termination
- Requieres rate limiting avanzado a nivel de proxy
- Usas Kubernetes (necesitas Ingress)
- Tu cloud provider requiere un load balancer específico

**Para la mayoría de casos, Docker Compose es suficiente.**

### 3.3 Redis Cluster (Para alta disponibilidad)

**Opción 1: Redis Sentinel** (Recomendado para empezar)
```yaml
# docker-compose.prod.yml
services:
  redis-master:
    image: redis:7-alpine
    command: redis-server --appendonly yes

  redis-sentinel:
    image: redis:7-alpine
    command: redis-sentinel /etc/redis/sentinel.conf
    volumes:
      - ./sentinel.conf:/etc/redis/sentinel.conf
```

**Opción 2: Redis Cluster** (Para escala mayor)
- Configurar cuando tengas > 10k mensajes/minuto
- Requiere al menos 6 nodos (3 masters + 3 replicas)

---

## Fase 4: Observabilidad (Semana 3-4)

### 4.1 Métricas con Prometheus

```javascript
// src/utils/metrics.js
const promClient = require('prom-client');

const register = new promClient.Registry();

// Métricas por defecto (CPU, memoria, etc.)
promClient.collectDefaultMetrics({ register });

// Métricas custom
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duración de requests HTTP',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

const mensajesRecibidos = new promClient.Counter({
  name: 'mensajes_recibidos_total',
  help: 'Total de mensajes recibidos',
  labelNames: ['app'],
  registers: [register]
});

const mensajesEnviados = new promClient.Counter({
  name: 'mensajes_enviados_total',
  help: 'Total de mensajes enviados a WhatsApp',
  registers: [register]
});

const transferencias = new promClient.Counter({
  name: 'transferencias_total',
  help: 'Total de transferencias entre apps',
  labelNames: ['origen', 'destino'],
  registers: [register]
});

const erroresRedis = new promClient.Counter({
  name: 'redis_errores_total',
  help: 'Errores de Redis',
  registers: [register]
});

module.exports = {
  register,
  httpRequestDuration,
  mensajesRecibidos,
  mensajesEnviados,
  transferencias,
  erroresRedis
};
```

**Endpoint de métricas:**
```javascript
// src/routes/admin.routes.js
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

### 4.2 Logs Estructurados Mejorados

```javascript
// src/utils/logger.js
const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()  // Formato JSON para parsing automático
  ),
  defaultMeta: {
    service: 'dispatcher',
    version: process.env.npm_package_version,
    hostname: os.hostname()
  },
  transports: [
    new winston.transports.File({
      filename: 'logs/dispatcher.json',  // JSON logs
      maxsize: 10485760,
      maxFiles: 10
    }),
    new winston.transports.File({
      filename: 'logs/error.json',
      level: 'error',
      maxsize: 10485760,
      maxFiles: 10
    })
  ]
});

// Correlación de requests
function addRequestId(req, res, next) {
  req.id = crypto.randomUUID();
  logger.defaultMeta.requestId = req.id;
  next();
}
```

### 4.3 Health Checks Robustos

```javascript
// src/routes/admin.routes.js
app.get('/health', async (req, res) => {
  const checks = {
    redis: await checkRedis(),
    whatsapp: checkWhatsAppConfig(),
    disk: await checkDiskSpace(),
    memory: checkMemory()
  };

  const isHealthy = Object.values(checks).every(c => c.status === 'ok');
  const status = isHealthy ? 200 : 503;

  res.status(status).json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks
  });
});

app.get('/health/live', (req, res) => {
  // Kubernetes liveness probe (simple, rápido)
  res.status(200).json({ status: 'alive' });
});

app.get('/health/ready', async (req, res) => {
  // Kubernetes readiness probe (verifica dependencias)
  const redisOk = await checkRedis();
  const status = redisOk.status === 'ok' ? 200 : 503;
  res.status(status).json({ ready: redisOk.status === 'ok' });
});
```

### 4.4 Tracing (Opcional, solo si es necesario)

```javascript
// Si necesitas distributed tracing
const { trace } = require('@opentelemetry/api');
const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');

// Configurar solo en producción si hay problemas de performance
```

---

## Fase 5: Testing (Semana 4)

### 5.1 Estructura de Tests

```javascript
// tests/unit/router.service.test.js
const { enrutarMensaje } = require('../../src/services/router.service');

describe('Router Service', () => {
  it('debe enrutar al bot por defecto', async () => {
    const resultado = await enrutarMensaje('5491234567890', {});
    expect(resultado.appKey).toBe('bot');
  });

  it('debe enrutar a la app asignada', async () => {
    await redis.setAppAsignada('5491234567890', 'asesor');
    const resultado = await enrutarMensaje('5491234567890', {});
    expect(resultado.appKey).toBe('asesor');
  });
});
```

```javascript
// tests/integration/webhook.test.js
const request = require('supertest');
const app = require('../../src/index');

describe('POST /webhook', () => {
  it('debe procesar mensaje de WhatsApp', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ /* ... */ }]
    };

    const response = await request(app)
      .post('/webhook')
      .send(payload);

    expect(response.status).toBe(200);
  });
});
```

### 5.2 Configuración de Jest

```javascript
// package.json
{
  "scripts": {
    "test": "jest --coverage",
    "test:watch": "jest --watch",
    "test:unit": "jest tests/unit",
    "test:integration": "jest tests/integration"
  },
  "jest": {
    "testEnvironment": "node",
    "coverageDirectory": "coverage",
    "collectCoverageFrom": [
      "src/**/*.js",
      "!src/index.js"
    ],
    "testMatch": [
      "**/*.test.js",
      "**/*.spec.js"
    ]
  }
}
```

### 5.3 Mocks y Fixtures

```javascript
// tests/mocks/redis.mock.js
const redisMock = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  ping: jest.fn().mockResolvedValue('PONG')
};

// tests/fixtures/whatsapp-messages.js
const mensajeTexto = {
  object: 'whatsapp_business_account',
  entry: [{
    changes: [{
      value: {
        messages: [{
          from: '5491234567890',
          text: { body: 'Hola' }
        }]
      }
    }]
  }]
};
```

---

## Fase 6: CI/CD Básico (Semana 4-5)

### 6.1 GitHub Actions

```yaml
# .github/workflows/ci.yml
name: CI/CD

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint

      - name: Run tests
        run: npm test
        env:
          REDIS_HOST: localhost
          REDIS_PORT: 6379

      - name: Upload coverage
        uses: codecov/codecov-action@v3

  build:
    runs-on: ubuntu-latest
    needs: test

    steps:
      - uses: actions/checkout@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2

      - name: Build Docker image
        uses: docker/build-push-action@v4
        with:
          context: .
          push: false
          tags: dispatcher:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main'

    steps:
      - name: Deploy to production
        run: |
          # Script de deployment (SSH, Docker, etc.)
          echo "Deploying..."
```

### 6.2 Scripts de Deployment

```bash
# scripts/deploy.sh
#!/bin/bash

set -e

echo "🚀 Iniciando deployment..."

# Pull latest
git pull origin main

# Build imagen
docker-compose -f docker-compose.prod.yml build

# Stop old containers
docker-compose -f docker-compose.prod.yml down

# Start new containers
docker-compose -f docker-compose.prod.yml up -d

# Health check
sleep 10
curl -f http://localhost:8080/health || exit 1

echo "✅ Deployment completado"
```

---

## Fase 7: Configuración como Servicio (Semana 5)

### 7.1 Systemd (Linux)

```ini
# /etc/systemd/system/dispatcher.service
[Unit]
Description=WhatsApp Dispatcher Service
After=network.target redis.service
Requires=redis.service

[Service]
Type=simple
User=nodejs
WorkingDirectory=/opt/dispatcher
Environment="NODE_ENV=production"
EnvironmentFile=/opt/dispatcher/.env
ExecStart=/usr/bin/node /opt/dispatcher/src/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**Comandos:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable dispatcher
sudo systemctl start dispatcher
sudo systemctl status dispatcher
journalctl -u dispatcher -f
```

### 7.2 PM2 (Alternativa)

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'dispatcher',
    script: './src/index.js',
    instances: 'max',  // Usar todos los CPUs
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production'
    },
    max_memory_restart: '500M',
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    autorestart: true,
    watch: false,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
```

**Comandos:**
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### 7.3 Docker Swarm (Orquestación simple)

```yaml
# docker-stack.yml
version: '3.8'

services:
  dispatcher:
    image: dispatcher:latest
    deploy:
      replicas: 3
      update_config:
        parallelism: 1
        delay: 10s
        order: start-first
      rollback_config:
        parallelism: 1
        delay: 5s
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
    networks:
      - dispatcher-net

networks:
  dispatcher-net:
    driver: overlay
```

**Comandos:**
```bash
docker swarm init
docker stack deploy -c docker-stack.yml dispatcher
docker service ls
docker service logs dispatcher_dispatcher
```

---

## Fase 8: Documentación y Handoff (Semana 5)

### 8.1 Actualizar README.md

```markdown
# Dispatcher WhatsApp - Guía de Producción

## Inicio Rápido

### Desarrollo Local
\`\`\`bash
cp .env.example .env
# Editar .env
docker-compose up -d
npm install
npm run dev
\`\`\`

### Producción con Docker
\`\`\`bash
docker-compose -f docker-compose.prod.yml up -d
\`\`\`

### Testing
\`\`\`bash
npm test
npm run test:coverage
\`\`\`

## Monitoreo

- Health: http://localhost:8080/health
- Métricas: http://localhost:8080/metrics
- Logs: `docker-compose logs -f dispatcher`

## Escalamiento

\`\`\`bash
docker-compose -f docker-compose.prod.yml up -d --scale dispatcher=5
\`\`\`
```

### 8.2 Runbook de Operaciones

```markdown
# Runbook - Dispatcher

## Despliegue

1. Verificar tests: `npm test`
2. Build: `docker-compose build`
3. Deploy: `./scripts/deploy.sh`
4. Verificar: `curl http://localhost:8080/health`

## Troubleshooting

### Dispatcher no responde
1. Verificar logs: `docker logs dispatcher-app`
2. Verificar Redis: `docker exec dispatcher-redis redis-cli ping`
3. Reiniciar: `docker-compose restart dispatcher`

### Mensajes no llegan
1. Verificar token WhatsApp en logs
2. Verificar routing: `redis-cli GET routing:NUMERO`
3. Verificar conectividad apps

## Alertas

- CPU > 80%: Escalar horizontalmente
- Memoria > 90%: Investigar memory leak
- Redis down: Activar replica
- Error rate > 5%: Revisar logs inmediatamente
```

---

## Cronograma Estimado

| Fase | Duración | Entregables |
|------|----------|-------------|
| 1. Refactorización | 1-2 semanas | Código limpio, circuit breakers, validaciones |
| 2. Containerización | 1 semana | Dockerfile, docker-compose, .dockerignore |
| 3. Escalabilidad | 1 semana | Rate limiting distribuido, load balancing |
| 4. Observabilidad | 1 semana | Métricas, logs estructurados, health checks |
| 5. Testing | 1 semana | Tests unitarios, integración, >80% coverage |
| 6. CI/CD | 3-5 días | GitHub Actions, scripts deployment |
| 7. Servicios | 2-3 días | Systemd/PM2/Swarm configurado |
| 8. Documentación | 2-3 días | README, runbook, diagramas actualizados |

**Total: 4-6 semanas** (dependiendo de recursos)

---

## Dependencias a Agregar

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "axios": "^1.6.2",
    "redis": "^4.6.10",
    "dotenv": "^16.3.1",
    "winston": "^3.11.0",
    "helmet": "^7.1.0",
    "cors": "^2.8.5",
    "joi": "^17.11.0",
    "opossum": "^8.1.0",
    "prom-client": "^15.0.0",
    "rate-limiter-flexible": "^3.0.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.2",
    "jest": "^29.7.0",
    "supertest": "^6.3.3",
    "eslint": "^8.55.0",
    "prettier": "^3.1.1"
  }
}
```

---

## Métricas de Éxito

### Performance
- [ ] Latencia P95 < 200ms
- [ ] Throughput > 1000 msg/min
- [ ] Uptime > 99.9%

### Calidad
- [ ] Test coverage > 80%
- [ ] 0 vulnerabilidades críticas
- [ ] Logs estructurados en JSON

### Operaciones
- [ ] Deployment < 5 minutos
- [ ] Rollback < 2 minutos
- [ ] MTTR < 15 minutos

---

## Decisiones Técnicas

### ✅ Incluidas (Esenciales)
- Circuit breaker (evitar cascading failures)
- Retry logic (resiliencia)
- Validación de entrada (seguridad)
- Métricas Prometheus (observabilidad)
- Health checks (orquestación)
- Logs estructurados (debugging)
- Tests (calidad)

### ❌ Excluidas (Sobre-ingeniería)
- Message queue (Redis suficiente por ahora)
- Service mesh (Istio/Linkerd) - solo si k8s
- Distributed tracing completo - solo si > 10 servicios
- Event sourcing - innecesario para este caso
- GraphQL - REST es suficiente

### 🤔 Evaluar Después
- Kubernetes (cuando > 10 instancias)
- Redis Cluster (cuando > 10k msg/min)
- APM tools (New Relic/Datadog) - si presupuesto permite
- Message broker (RabbitMQ/Kafka) - si > 100k msg/día

---

## Notas de Implementación

### Orden Sugerido
1. **Primero**: Refactorización básica (semana 1)
2. **Segundo**: Docker + Testing (semana 2)
3. **Tercero**: Observabilidad (semana 3)
4. **Cuarto**: CI/CD + Deploy (semana 4)
5. **Quinto**: Optimización y docs (semana 5)

### Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| WhatsApp API cambia | Media | Alto | Tests de integración, versionado |
| Redis downtime | Baja | Crítico | Sentinel/Cluster, backups |
| Apps externas caídas | Alta | Medio | Circuit breakers, fallbacks |
| Picos de tráfico | Media | Alto | Auto-scaling, rate limiting |

---

## Siguientes Pasos

1. **Validar plan** con el equipo
2. **Crear repositorio** Git
3. **Configurar entorno** de desarrollo
4. **Comenzar Fase 1** - Refactorización
5. **Iterar** semanalmente con demos

¿Listo para empezar? 🚀
