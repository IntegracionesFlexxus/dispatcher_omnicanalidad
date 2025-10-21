# 🚀 Dispatcher WhatsApp - Documentación Técnica Completa

## 📋 Índice

1. [Arquitectura](#arquitectura)
2. [Requisitos](#requisitos)
3. [Estructura del Proyecto](#estructura)
4. [Instalación](#instalación)
5. [Configuración](#configuración)
6. [Código Fuente](#código-fuente)
7. [APIs y Endpoints](#apis)
8. [Integración con Apps](#integración)
9. [Deployment](#deployment)
10. [Monitoreo](#monitoreo)
11. [Troubleshooting](#troubleshooting)

---

## 🏗️ Arquitectura {#arquitectura}

```
┌─────────────────────────────────────────────────┐
│              WhatsApp Cloud API                 │
└────────────────────┬────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────┐
│           DISPATCHER (Node.js + Redis)          │
│                                                 │
│  Endpoints:                                     │
│  • POST /webhook    (recibe de WhatsApp)        │
│  • POST /enviar     (apps envían mensajes)      │
│  • POST /transferir (cambiar routing)           │
│  • POST /finalizar  (terminar conversación)     │
│  • GET  /estado     (ver estado)                │
│  • GET  /health     (health check)              │
│                                                 │
│  Estado persistido en Redis:                    │
│  • routing:numero → app_asignada                │
│  • stats:mensajes → contador                    │
└──────────┬──────────────────────────┬───────────┘
           │                          │
           ↓                          ↓
    ┌─────────────┐          ┌──────────────────┐
    │  BOT (3000) │          │ SOFTWARE (4000)  │
    │             │          │                  │
    │ Recibe:     │          │ Recibe:          │
    │ POST /webhook│         │ POST /webhook    │
    │             │          │                  │
    │ Envía:      │          │ Envía:           │
    │ POST /enviar │         │ POST /enviar     │
    └─────────────┘          └──────────────────┘
```

**Características:**
- ✅ Estado persistente (sobrevive a reinicios)
- ✅ Asíncrono (apps responden cuando quieran)
- ✅ Desacoplado (apps no se conocen entre sí)
- ✅ Escalable (múltiples instancias con Redis)

---

## 📦 Requisitos {#requisitos}

### Software necesario:

- **Node.js** 16+ (recomendado: 18 LTS)
- **Redis** 6+ 
- **npm** o **yarn**

### Servicios externos:

- **WhatsApp Business API** (token + phone number ID)
- **Dominio con SSL** para el webhook

### Conocimientos básicos:

- JavaScript/Node.js
- Express.js
- Redis básico
- HTTP/REST APIs

---

## 📁 Estructura del Proyecto {#estructura}

```
dispatcher/
├── src/
│   ├── index.js           # Punto de entrada
│   ├── config.js          # Configuración
│   ├── redis.js           # Cliente Redis
│   ├── whatsapp.js        # API WhatsApp
│   ├── router.js          # Lógica de enrutamiento
│   └── logger.js          # Sistema de logs
├── .env                   # Variables de entorno
├── .env.example           # Ejemplo de configuración
├── package.json           # Dependencias
├── docker-compose.yml     # Para levantar Redis
├── Dockerfile             # Para containerizar
├── README.md              # Documentación
└── logs/                  # Logs (gitignored)
```

---

## 🔧 Instalación {#instalación}

### Paso 1: Clonar o crear el proyecto

```bash
mkdir dispatcher
cd dispatcher
```

### Paso 2: Crear package.json

```json
{
  "name": "whatsapp-dispatcher",
  "version": "1.0.0",
  "description": "Dispatcher robusto para WhatsApp con Redis",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js",
    "test": "jest",
    "docker:up": "docker-compose up -d",
    "docker:down": "docker-compose down"
  },
  "dependencies": {
    "express": "^4.18.2",
    "axios": "^1.6.2",
    "redis": "^4.6.10",
    "dotenv": "^16.3.1",
    "winston": "^3.11.0",
    "express-rate-limit": "^7.1.5",
    "helmet": "^7.1.0",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "nodemon": "^3.0.2",
    "jest": "^29.7.0"
  }
}
```

### Paso 3: Instalar dependencias

```bash
npm install
```

### Paso 4: Configurar Redis (con Docker)

Crear `docker-compose.yml`:

```yaml
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

volumes:
  redis-data:
```

Levantar Redis:

```bash
npm run docker:up
```

---

## ⚙️ Configuración {#configuración}

### Archivo `.env`

```bash
# ========== SERVIDOR ==========
NODE_ENV=production
PORT=8080
HOST=0.0.0.0

# ========== REDIS ==========
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# ========== WHATSAPP ==========
WHATSAPP_TOKEN=EAAxxxxx...tu_token_aqui
PHONE_NUMBER_ID=123456789012345
VERIFY_TOKEN=mi_token_secreto_seguro_12345

# ========== APLICACIONES ==========
# Formato: KEY=nombre|url|prioridad
BOT_APP=BOT|http://localhost:3000|1
ASESOR_APP=SOFTWARE_ASESORES|http://localhost:4000|2

# Para agregar más apps:
# VENTAS_APP=VENTAS|http://localhost:5000|3
# SOPORTE_APP=SOPORTE|http://localhost:6000|4

# ========== SEGURIDAD ==========
# API Key para autenticar las apps (opcional)
API_KEY=tu_api_key_super_secreta

# ========== RATE LIMITING ==========
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# ========== LOGS ==========
LOG_LEVEL=info
LOG_FILE=logs/dispatcher.log

# ========== TIMEOUTS ==========
APP_TIMEOUT_MS=10000
WHATSAPP_TIMEOUT_MS=5000
REDIS_TIMEOUT_MS=2000
```

### Archivo `.env.example` (para compartir)

```bash
# Copiar este archivo a .env y completar

NODE_ENV=production
PORT=8080

REDIS_HOST=localhost
REDIS_PORT=6379

WHATSAPP_TOKEN=tu_token_de_whatsapp
PHONE_NUMBER_ID=tu_phone_number_id
VERIFY_TOKEN=tu_token_de_verificacion

BOT_APP=BOT|http://localhost:3000|1
ASESOR_APP=SOFTWARE_ASESORES|http://localhost:4000|2

API_KEY=cambiar_esto_por_algo_seguro
```

---

## 💻 Código Fuente {#código-fuente}

### 1. `src/config.js` - Configuración centralizada

```javascript
require('dotenv').config();

// Parsear aplicaciones del .env
function parseApps() {
    const apps = {};
    const envVars = Object.keys(process.env);
    
    envVars.forEach(key => {
        if (key.endsWith('_APP')) {
            const [nombre, url, prioridad] = process.env[key].split('|');
            const appKey = key.replace('_APP', '').toLowerCase();
            
            apps[appKey] = {
                nombre: nombre.trim(),
                url: url.trim(),
                prioridad: parseInt(prioridad) || 99
            };
        }
    });
    
    return apps;
}

module.exports = {
    // Servidor
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: parseInt(process.env.PORT) || 8080,
    HOST: process.env.HOST || '0.0.0.0',
    
    // Redis
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB) || 0,
        timeout: parseInt(process.env.REDIS_TIMEOUT_MS) || 2000
    },
    
    // WhatsApp
    whatsapp: {
        token: process.env.WHATSAPP_TOKEN,
        phoneNumberId: process.env.PHONE_NUMBER_ID,
        verifyToken: process.env.VERIFY_TOKEN || 'default_token',
        timeout: parseInt(process.env.WHATSAPP_TIMEOUT_MS) || 5000
    },
    
    // Aplicaciones registradas
    apps: parseApps(),
    
    // Seguridad
    apiKey: process.env.API_KEY,
    
    // Rate Limiting
    rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
        max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
    },
    
    // Logs
    log: {
        level: process.env.LOG_LEVEL || 'info',
        file: process.env.LOG_FILE || 'logs/dispatcher.log'
    },
    
    // Timeouts
    appTimeout: parseInt(process.env.APP_TIMEOUT_MS) || 10000
};
```

### 2. `src/logger.js` - Sistema de logs

```javascript
const winston = require('winston');
const config = require('./config');
const fs = require('fs');
const path = require('path');

// Crear carpeta de logs si no existe
const logDir = path.dirname(config.log.file);
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const logger = winston.createLogger({
    level: config.log.level,
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    ),
    defaultMeta: { service: 'dispatcher' },
    transports: [
        // Escribir a archivo
        new winston.transports.File({ 
            filename: config.log.file,
            maxsize: 10485760, // 10MB
            maxFiles: 5
        }),
        // Escribir errores en archivo separado
        new winston.transports.File({ 
            filename: 'logs/error.log', 
            level: 'error',
            maxsize: 10485760,
            maxFiles: 5
        })
    ]
});

// En desarrollo, también mostrar en consola
if (config.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

module.exports = logger;
```

### 3. `src/redis.js` - Cliente Redis

```javascript
const redis = require('redis');
const config = require('./config');
const logger = require('./logger');

let client;

// Conectar a Redis
async function connect() {
    try {
        client = redis.createClient({
            socket: {
                host: config.redis.host,
                port: config.redis.port,
                connectTimeout: config.redis.timeout
            },
            password: config.redis.password,
            database: config.redis.db
        });

        client.on('error', (err) => {
            logger.error('Redis error:', err);
        });

        client.on('connect', () => {
            logger.info('✅ Conectado a Redis');
        });

        client.on('disconnect', () => {
            logger.warn('⚠️ Desconectado de Redis');
        });

        await client.connect();
        
        return client;
    } catch (error) {
        logger.error('❌ Error conectando a Redis:', error);
        throw error;
    }
}

// Obtener aplicación asignada a un número
async function getAppAsignada(numero) {
    try {
        const app = await client.get(`routing:${numero}`);
        return app || 'bot'; // Default: bot
    } catch (error) {
        logger.error('Error obteniendo app asignada:', error);
        return 'bot';
    }
}

// Asignar aplicación a un número
async function setAppAsignada(numero, app) {
    try {
        await client.set(`routing:${numero}`, app);
        await client.expire(`routing:${numero}`, 86400); // 24 horas
        logger.info(`Routing: ${numero} → ${app}`);
    } catch (error) {
        logger.error('Error asignando app:', error);
        throw error;
    }
}

// Eliminar asignación (volver al bot)
async function clearAppAsignada(numero) {
    try {
        await client.del(`routing:${numero}`);
        logger.info(`Routing limpiado: ${numero} → bot`);
    } catch (error) {
        logger.error('Error limpiando routing:', error);
        throw error;
    }
}

// Incrementar contador de mensajes
async function incrementStats(key) {
    try {
        await client.incr(`stats:${key}`);
    } catch (error) {
        logger.error('Error incrementando stats:', error);
    }
}

// Obtener estadísticas
async function getStats() {
    try {
        const keys = await client.keys('stats:*');
        const stats = {};
        
        for (const key of keys) {
            const value = await client.get(key);
            const statName = key.replace('stats:', '');
            stats[statName] = parseInt(value) || 0;
        }
        
        return stats;
    } catch (error) {
        logger.error('Error obteniendo stats:', error);
        return {};
    }
}

// Obtener todas las conversaciones activas
async function getAllRoutings() {
    try {
        const keys = await client.keys('routing:*');
        const routings = [];
        
        for (const key of keys) {
            const numero = key.replace('routing:', '');
            const app = await client.get(key);
            const ttl = await client.ttl(key);
            
            routings.push({
                numero,
                app,
                expira_en: ttl
            });
        }
        
        return routings;
    } catch (error) {
        logger.error('Error obteniendo routings:', error);
        return [];
    }
}

// Verificar salud de Redis
async function healthCheck() {
    try {
        await client.ping();
        return true;
    } catch (error) {
        return false;
    }
}

module.exports = {
    connect,
    getAppAsignada,
    setAppAsignada,
    clearAppAsignada,
    incrementStats,
    getStats,
    getAllRoutings,
    healthCheck,
    getClient: () => client
};
```

### 4. `src/whatsapp.js` - Cliente WhatsApp

```javascript
const axios = require('axios');
const config = require('./config');
const logger = require('./logger');

const WHATSAPP_API = 'https://graph.facebook.com/v18.0';

// Enviar mensaje a WhatsApp
async function enviarMensaje(numero, texto) {
    if (!config.whatsapp.token || !config.whatsapp.phoneNumberId) {
        logger.error('Token de WhatsApp no configurado');
        throw new Error('WhatsApp no configurado');
    }

    try {
        const url = `${WHATSAPP_API}/${config.whatsapp.phoneNumberId}/messages`;
        
        const response = await axios.post(
            url,
            {
                messaging_product: 'whatsapp',
                to: numero,
                text: { body: texto }
            },
            {
                headers: {
                    'Authorization': `Bearer ${config.whatsapp.token}`,
                    'Content-Type': 'application/json'
                },
                timeout: config.whatsapp.timeout
            }
        );

        logger.info(`✅ Mensaje enviado a ${numero}`);
        return response.data;
        
    } catch (error) {
        logger.error(`❌ Error enviando mensaje a ${numero}:`, {
            error: error.message,
            response: error.response?.data
        });
        throw error;
    }
}

// Validar que el webhook viene de WhatsApp
function validarWebhook(body) {
    return body.object === 'whatsapp_business_account';
}

// Extraer mensaje del webhook de WhatsApp
function extraerMensaje(body) {
    try {
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const mensaje = value?.messages?.[0];
        
        if (!mensaje) return null;
        
        return {
            id: mensaje.id,
            from: mensaje.from,
            timestamp: mensaje.timestamp,
            type: mensaje.type,
            text: mensaje.text?.body || '',
            mensaje_completo: mensaje
        };
    } catch (error) {
        logger.error('Error extrayendo mensaje:', error);
        return null;
    }
}

module.exports = {
    enviarMensaje,
    validarWebhook,
    extraerMensaje
};
```

### 5. `src/router.js` - Lógica de enrutamiento

```javascript
const axios = require('axios');
const config = require('./config');
const logger = require('./logger');
const redis = require('./redis');

// Enviar mensaje a una aplicación
async function enviarAApp(appKey, body) {
    const app = config.apps[appKey];
    
    if (!app) {
        logger.error(`Aplicación "${appKey}" no existe`);
        return { error: 'App no encontrada' };
    }

    try {
        const url = `${app.url}/webhook`;
        
        logger.info(`→ Enviando a ${app.nombre} (${url})`);
        
        const response = await axios.post(url, body, {
            timeout: config.appTimeout,
            headers: { 
                'Content-Type': 'application/json',
                'X-Dispatcher': 'true'
            },
            validateStatus: () => true // No lanzar error en status !== 200
        });

        if (response.status >= 200 && response.status < 300) {
            logger.info(`✅ ${app.nombre} respondió OK`);
            return response.data;
        } else {
            logger.warn(`⚠️ ${app.nombre} respondió con status ${response.status}`);
            return { error: `Status ${response.status}` };
        }
        
    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            logger.error(`❌ ${app.nombre} no está disponible (${app.url})`);
        } else if (error.code === 'ETIMEDOUT') {
            logger.error(`❌ ${app.nombre} timeout`);
        } else {
            logger.error(`❌ Error conectando a ${app.nombre}:`, error.message);
        }
        
        return { error: error.message };
    }
}

// Enrutar mensaje a la aplicación correcta
async function enrutarMensaje(numero, body) {
    // Obtener app asignada desde Redis
    const appKey = await redis.getAppAsignada(numero);
    
    // Enviar a la app
    const resultado = await enviarAApp(appKey, body);
    
    // Incrementar estadísticas
    await redis.incrementStats('mensajes_total');
    await redis.incrementStats(`mensajes_${appKey}`);
    
    return {
        appKey,
        appNombre: config.apps[appKey]?.nombre,
        resultado
    };
}

// Transferir conversación a otra app
async function transferir(numero, appDestino, contexto = {}) {
    if (!config.apps[appDestino]) {
        throw new Error(`Aplicación "${appDestino}" no existe`);
    }

    const appAnterior = await redis.getAppAsignada(numero);
    
    // Cambiar routing en Redis
    await redis.setAppAsignada(numero, appDestino);
    
    logger.info(`🔀 Transferencia: ${numero} de ${appAnterior} → ${appDestino}`);
    
    // Notificar a la nueva app
    await enviarAApp(appDestino, {
        tipo: 'nueva_conversacion',
        numero: numero,
        contexto: contexto,
        desde_app: appAnterior
    });
    
    return {
        anterior: appAnterior,
        nueva: appDestino
    };
}

// Finalizar conversación (volver al bot)
async function finalizar(numero) {
    const appAnterior = await redis.getAppAsignada(numero);
    
    await redis.clearAppAsignada(numero);
    
    logger.info(`🔚 Finalizado: ${numero} (era ${appAnterior})`);
    
    return { app_anterior: appAnterior };
}

module.exports = {
    enviarAApp,
    enrutarMensaje,
    transferir,
    finalizar
};
```

### 6. `src/index.js` - Servidor principal

```javascript
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const logger = require('./logger');
const redis = require('./redis');
const whatsapp = require('./whatsapp');
const router = require('./router');

const app = express();

// ========== MIDDLEWARES ==========

// Seguridad
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    message: 'Demasiadas solicitudes, intenta más tarde'
});
app.use(limiter);

// Logger de requests
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        body: req.body
    });
    next();
});

// Middleware de autenticación (opcional)
function authMiddleware(req, res, next) {
    if (!config.apiKey) return next(); // Sin auth si no hay API key
    
    const apiKey = req.headers['x-api-key'];
    
    if (apiKey !== config.apiKey) {
        logger.warn('Intento de acceso no autorizado', { ip: req.ip });
        return res.status(401).json({ error: 'No autorizado' });
    }
    
    next();
}

// ========== ENDPOINTS ==========

// Health Check
app.get('/health', async (req, res) => {
    const redisOk = await redis.healthCheck();
    const whatsappOk = !!(config.whatsapp.token && config.whatsapp.phoneNumberId);
    
    const health = {
        status: redisOk && whatsappOk ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        redis: redisOk ? 'connected' : 'disconnected',
        whatsapp: whatsappOk ? 'configured' : 'not_configured',
        apps: Object.keys(config.apps).length
    };
    
    const statusCode = health.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(health);
});

// Verificación de WhatsApp (GET)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
        logger.info('✅ Webhook verificado por WhatsApp');
        res.status(200).send(challenge);
    } else {
        logger.warn('❌ Verificación de webhook fallida');
        res.sendStatus(403);
    }
});

// Recibir mensajes de WhatsApp (POST)
app.post('/webhook', async (req, res) => {
    // Responder inmediatamente a WhatsApp
    res.sendStatus(200);
    
    try {
        const body = req.body;
        
        // Validar que viene de WhatsApp
        if (!whatsapp.validarWebhook(body)) {
            logger.warn('Webhook inválido recibido');
            return;
        }

        // Extraer mensaje
        const mensaje = whatsapp.extraerMensaje(body);
        
        if (!mensaje) {
            logger.debug('Webhook sin mensaje (probablemente status update)');
            return;
        }

        logger.info(`📨 Mensaje de ${mensaje.from}: "${mensaje.text}"`);
        
        // Enrutar a la app correcta
        const resultado = await router.enrutarMensaje(mensaje.from, body);
        
        logger.info(`✅ Enrutado a ${resultado.appNombre}`);
        
    } catch (error) {
        logger.error('❌ Error procesando webhook:', error);
    }
});

// Enviar mensaje a WhatsApp
app.post('/enviar', authMiddleware, async (req, res) => {
    try {
        const { numero, mensaje } = req.body;
        
        if (!numero || !mensaje) {
            return res.status(400).json({ 
                error: 'Faltan campos requeridos',
                required: ['numero', 'mensaje']
            });
        }

        await whatsapp.enviarMensaje(numero, mensaje);
        await redis.incrementStats('mensajes_enviados');
        
        res.json({ 
            ok: true,
            mensaje: 'Mensaje enviado'
        });
        
    } catch (error) {
        logger.error('Error en /enviar:', error);
        res.status(500).json({ 
            error: 'Error enviando mensaje',
            detalle: error.message
        });
    }
});

// Transferir conversación a otra app
app.post('/transferir', authMiddleware, async (req, res) => {
    try {
        const { numero, app_destino, contexto } = req.body;
        
        if (!numero || !app_destino) {
            return res.status(400).json({ 
                error: 'Faltan campos requeridos',
                required: ['numero', 'app_destino']
            });
        }

        const resultado = await router.transferir(numero, app_destino, contexto);
        await redis.incrementStats('transferencias');
        
        res.json({ 
            ok: true,
            ...resultado
        });
        
    } catch (error) {
        logger.error('Error en /transferir:', error);
        res.status(500).json({ 
            error: 'Error transfiriendo',
            detalle: error.message
        });
    }
});

// Finalizar conversación
app.post('/finalizar/:numero', authMiddleware, async (req, res) => {
    try {
        const numero = req.params.numero;
        
        const resultado = await router.finalizar(numero);
        await redis.incrementStats('finalizaciones');
        
        // Opcional: enviar mensaje de despedida
        if (req.body.mensaje_despedida !== false) {
            await whatsapp.enviarMensaje(
                numero,
                '👋 Conversación finalizada. Si necesitas ayuda, vuelve a escribir.'
            );
        }
        
        res.json({ 
            ok: true,
            ...resultado
        });
        
    } catch (error) {
        logger.error('Error en /finalizar:', error);
        res.status(500).json({ 
            error: 'Error finalizando',
            detalle: error.message
        });
    }
});

// Ver estado del sistema
app.get('/estado', authMiddleware, async (req, res) => {
    try {
        const routings = await redis.getAllRoutings();
        const stats = await redis.getStats();
        
        res.json({
            total_conversaciones: routings.length,
            conversaciones: routings,
            estadisticas: stats,
            aplicaciones: Object.keys(config.apps).map(key => ({
                key,
                nombre: config.apps[key].nombre,
                url: config.apps[key].url
            }))
        });
        
    } catch (error) {
        logger.error('Error en /estado:', error);
        res.status(500).json({ 
            error: 'Error obteniendo estado' 
        });
    }
});

// Listar aplicaciones registradas
app.get('/aplicaciones', (req, res) => {
    const apps = Object.entries(config.apps).map(([key, data]) => ({
        key,
        nombre: data.nombre,
        url: data.url,
        prioridad: data.prioridad
    }));
    
    res.json({ aplicaciones: apps });
});

// Ruta raíz
app.get('/', (req, res) => {
    res.json({
        service: 'WhatsApp Dispatcher',
        version: '1.0.0',
        status: 'running',
        endpoints: {
            health: 'GET /health',
            webhook: 'POST /webhook',
            enviar: 'POST /enviar',
            transferir: 'POST /transferir',
            finalizar: 'POST /finalizar/:numero',
            estado: 'GET /estado',
            aplicaciones: 'GET /aplicaciones'
        }
    });
});

// Manejo de errores 404
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint no encontrado' });
});

// Manejo de errores global
app.use((err, req, res, next) => {
    logger.error('Error no manejado:', err);
    res.status(500).json({ 
        error: 'Error interno del servidor' 
    });
});

// ========== INICIO DEL SERVIDOR ==========

async function iniciar() {
    try {
        // Conectar a Redis
        logger.info('Conectando a Redis...');
        await redis.connect();
        
        // Validar configuración de WhatsApp
        if (!config.whatsapp.token || !config.whatsapp.phoneNumberId) {
            logger.warn('⚠️ WhatsApp no configurado completamente');
        }
        
        // Iniciar servidor
        app.listen(config.PORT, config.HOST, () => {
            logger.info('');
            logger.info('🚀 ========================================');
            logger.info(`   DISPATCHER corriendo en ${config.HOST}:${config.PORT}`);
            logger.info('🚀 ========================================');
            logger.info('');
            logger.info(`📍 Webhook: https://tu-dominio.com/webhook`);
            logger.info(`🔧 Aplicaciones registradas: ${Object.keys(config.apps).length}`);
            Object.entries(config.apps).forEach(([key, app]) => {
                logger.info(`   • ${app.nombre} → ${app.url}`);
            });
            logger.info('');
            logger.info('✅ Sistema listo para recibir mensajes');
            logger.info('');
        });
        
    } catch (error) {
        logger.error('❌ Error fatal iniciando:', error);
        process.exit(1);
    }
}

// Manejo de shutdown graceful
process.on('SIGTERM', async () => {
    logger.info('Recibido SIGTERM, cerrando...');
    await redis.getClient().quit();
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('Recibido SIGINT, cerrando...');
    await redis.getClient().quit();
    process.exit(0);
});

// Iniciar
iniciar();
```

---

## 📡 APIs y Endpoints {#apis}

### Para las Aplicaciones (Bot, Software, etc.)

#### 1. `POST /enviar` - Enviar mensaje a WhatsApp

**Request:**
```json
{
  "numero": "5493512345678",
  "mensaje": "Hola desde el bot"
}
```

**Response:**
```json
{
  "ok": true,
  "mensaje": "Mensaje enviado"
}
```

#### 2. `POST /transferir` - Transferir conversación

**Request:**
```json
{
  "numero": "5493512345678",
  "app_destino": "asesor",
  "contexto": {
    "razon": "Cliente solicitó asesor",
    "data": "..."
  }
}
```

**Response:**
```json
{
  "ok": true,
  "anterior": "bot",
  "nueva": "asesor"
}
```

#### 3. `POST /finalizar/:numero` - Finalizar conversación

**Request:**
```bash
POST /finalizar/5493512345678
```

**Body (opcional):**
```json
{
  "mensaje_despedida": true
}
```

**Response:**
```json
{
  "ok": true,
  "app_anterior": "asesor"
}
```

#### 4. `GET /estado` - Ver estado del sistema

**Response:**
```json
{
  "total_conversaciones": 3,
  "conversaciones": [
    {
      "numero": "5493512345678",
      "app": "asesor",
      "expira_en": 82500
    }
  ],
  "estadisticas": {
    "mensajes_total": 150,
    "mensajes_bot": 100,
    "mensajes_asesor": 50,
    "mensajes_enviados": 145,
    "transferencias": 5,
    "finalizaciones": 3
  },
  "aplicaciones": [...]
}
```

### Para WhatsApp

#### `POST /webhook` - Recibir mensajes

Manejado internamente por el dispatcher.

#### `GET /webhook` - Verificación

WhatsApp lo usa para validar el webhook.

---

## 🔌 Integración con Apps {#integración}

### Ejemplo: Bot (Node.js)

```javascript
// bot/index.js
const express = require('express');
const axios = require('axios');
const app = express();

const DISPATCHER_URL = 'http://localhost:8080';

app.use(express.json());

// Recibir mensajes del dispatcher
app.post('/webhook', async (req, res) => {
    // Acknowledge inmediato
    res.sendStatus(200);
    
    try {
        const body = req.body;
        
        // Nueva conversación transferida
        if (body.tipo === 'nueva_conversacion') {
            console.log('Nueva conversación:', body.numero);
            return;
        }
        
        // Mensaje del cliente
        const mensaje = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (!mensaje) return;
        
        const numero = mensaje.from;
        const texto = mensaje.text?.body || '';
        
        console.log(`Mensaje de ${numero}: "${texto}"`);
        
        // Procesar mensaje (IA, reglas, etc.)
        const respuesta = await procesarMensaje(texto);
        
        // Si necesita asesor
        if (respuesta.necesitaAsesor) {
            // Transferir
            await axios.post(`${DISPATCHER_URL}/transferir`, {
                numero: numero,
                app_destino: 'asesor',
                contexto: { razon: 'Cliente pidió asesor' }
            });
            
            // Enviar mensaje de transición
            await axios.post(`${DISPATCHER_URL}/enviar`, {
                numero: numero,
                mensaje: '👤 Te conectamos con un asesor...'
            });
        } else {
            // Responder normalmente
            await axios.post(`${DISPATCHER_URL}/enviar`, {
                numero: numero,
                mensaje: respuesta.texto
            });
        }
        
    } catch (error) {
        console.error('Error:', error);
    }
});

async function procesarMensaje(texto) {
    // Tu lógica aquí
    if (texto.toLowerCase().includes('asesor')) {
        return { necesitaAsesor: true };
    }
    
    return { 
        necesitaAsesor: false,
        texto: `Recibí: ${texto}`
    };
}

app.listen(3000, () => {
    console.log('Bot en puerto 3000');
});
```

### Ejemplo: Software de Gestión

```javascript
// software/index.js
const express = require('express');
const axios = require('axios');
const app = express();

const DISPATCHER_URL = 'http://localhost:8080';

app.use(express.json());

// Recibir del dispatcher
app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    
    const body = req.body;
    
    // Nueva conversación
    if (body.tipo === 'nueva_conversacion') {
        console.log('📥 Nueva conversación:', body.numero);
        // Mostrar en interfaz, crear ticket, etc.
        return;
    }
    
    // Mensaje del cliente
    const mensaje = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (mensaje) {
        console.log(`💬 ${mensaje.from}: ${mensaje.text.body}`);
        // Mostrar en chat del asesor
    }
});

// Asesor envía respuesta
app.post('/asesor-responde', async (req, res) => {
    const { numero, mensaje } = req.body;
    
    await axios.post(`${DISPATCHER_URL}/enviar`, {
        numero: numero,
        mensaje: `👤 Asesor: ${mensaje}`
    });
    
    res.json({ ok: true });
});

// Asesor finaliza
app.post('/asesor-finaliza/:numero', async (req, res) => {
    await axios.post(`${DISPATCHER_URL}/finalizar/${req.params.numero}`);
    res.json({ ok: true });
});

app.listen(4000, () => {
    console.log('Software en puerto 4000');
});
```

---

## 🚀 Deployment {#deployment}

### Opción 1: VPS con PM2

```bash
# Instalar PM2
npm install -g pm2

# Iniciar dispatcher
pm2 start src/index.js --name dispatcher

# Ver logs
pm2 logs dispatcher

# Reiniciar
pm2 restart dispatcher

# Auto-start en boot
pm2 startup
pm2 save
```

### Opción 2: Docker

Crear `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src ./src

EXPOSE 8080

CMD ["node", "src/index.js"]
```

Crear `docker-compose.yml` completo:

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes
    restart: unless-stopped
    
  dispatcher:
    build: .
    ports:
      - "8080:8080"
    depends_on:
      - redis
    environment:
      - NODE_ENV=production
      - REDIS_HOST=redis
    env_file:
      - .env
    restart: unless-stopped
    volumes:
      - ./logs:/app/logs

volumes:
  redis-data:
```

Iniciar:

```bash
docker-compose up -d
```

---

## 📊 Monitoreo {#monitoreo}

### Ver logs en tiempo real

```bash
# Con PM2
pm2 logs dispatcher

# Con Docker
docker-compose logs -f dispatcher

# Archivo directo
tail -f logs/dispatcher.log
```

### Health check

```bash
curl http://localhost:8080/health
```

### Estadísticas

```bash
curl http://localhost:8080/estado \
  -H "X-API-Key: tu_api_key"
```

---

## 🐛 Troubleshooting {#troubleshooting}

### Problema: Dispatcher no arranca

**Solución:**
```bash
# Verificar Redis
docker ps | grep redis

# Ver logs
pm2 logs dispatcher

# Verificar .env
cat .env | grep REDIS
```

### Problema: Apps no reciben mensajes

**Solución:**
```bash
# Verificar que la app esté corriendo
curl http://localhost:3000

# Ver routing en Redis
redis-cli
> KEYS routing:*
> GET routing:5493512345678
```

### Problema: Mensajes no llegan a WhatsApp

**Solución:**
```bash
# Verificar token
curl http://localhost:8080/health

# Ver logs de error
tail -f logs/error.log

# Test manual
curl -X POST http://localhost:8080/enviar \
  -H "Content-Type: application/json" \
  -H "X-API-Key: tu_api_key" \
  -d '{"numero":"tu_numero","mensaje":"test"}'
```

---

## ✅ Checklist de Producción

- [ ] Redis corriendo y persistente
- [ ] `.env` configurado correctamente
- [ ] Tokens de WhatsApp válidos
- [ ] SSL configurado en el dominio
- [ ] Webhook verificado en WhatsApp
- [ ] Apps corriendo y respondiendo
- [ ] PM2 o Docker configurado
- [ ] Logs rotando correctamente
- [ ] Health checks funcionando
- [ ] Backup de Redis configurado
- [ ] Monitoreo configurado
- [ ] Alertas configuradas

---

¡Listo para producción! 🎉