# Analisis de Seguridad - WhatsApp Dispatcher

Fecha de analisis: 2026-04-13

Este documento detalla las vulnerabilidades de seguridad encontradas en el proyecto y el plan de remediacion para cada una antes de exponer el servicio a internet para recibir webhooks de Meta.

---

## Hallazgos por Severidad

---

### CRITICO

Estos hallazgos deben resolverse antes de exponer el servicio a internet.

---

#### 1. No se verifica la firma de Meta (X-Hub-Signature-256)

- **Archivo:** `src/routes/webhook.routes.js` (lineas 43-129)
- **Descripcion:** El endpoint POST `/webhook` no verifica el header `X-Hub-Signature-256` que Meta envia en cada request. Meta firma cada webhook con HMAC-SHA256 usando el App Secret de la aplicacion de Facebook/WhatsApp.
- **Impacto:** Cualquier persona que conozca la URL del webhook puede enviar payloads falsos. Un atacante puede:
  - Inyectar mensajes falsos que se enruten a las apps downstream
  - Triggear acciones en el sistema (transferencias, envio de mensajes)
  - Abusar del servicio para enviar mensajes de WhatsApp a traves de la API
- **Referencia:** https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests

**Como corregir:**

1. Agregar la variable de entorno `META_APP_SECRET` a la configuracion (`src/config/index.js`):
   ```js
   whatsapp: {
     // ...existente...
     appSecret: process.env.META_APP_SECRET,
   }
   ```

2. Crear un middleware de verificacion de firma. Ejemplo:
   ```js
   // src/middlewares/webhookSignature.js
   const crypto = require('crypto');
   const config = require('../config');
   const logger = require('../utils/logger');

   function verifyMetaSignature(req, res, next) {
     // En desarrollo, permitir sin firma (opcional)
     if (!config.isProduction() && !config.whatsapp.appSecret) {
       return next();
     }

     if (!config.whatsapp.appSecret) {
       logger.error('META_APP_SECRET no configurado');
       return res.sendStatus(500);
     }

     const signature = req.headers['x-hub-signature-256'];
     if (!signature) {
       logger.warn('Webhook sin firma X-Hub-Signature-256', { ip: req.ip });
       return res.sendStatus(401);
     }

     const expectedSignature = 'sha256=' + crypto
       .createHmac('sha256', config.whatsapp.appSecret)
       .update(req.rawBody) // Requiere capturar el raw body
       .digest('hex');

     if (!crypto.timingSafeEqual(
       Buffer.from(signature),
       Buffer.from(expectedSignature)
     )) {
       logger.warn('Firma de webhook invalida', { ip: req.ip });
       return res.sendStatus(401);
     }

     next();
   }

   module.exports = { verifyMetaSignature };
   ```

3. **Importante:** Para que funcione, se necesita capturar el raw body. Modificar `src/index.js`:
   ```js
   app.use(express.json({
     limit: '1mb',
     verify: (req, res, buf) => {
       req.rawBody = buf;
     }
   }));
   ```

4. Aplicar el middleware al endpoint POST `/webhook` en `src/routes/webhook.routes.js`:
   ```js
   const { verifyMetaSignature } = require('../middlewares/webhookSignature');

   router.post('/', webhookRateLimitMiddleware, verifyMetaSignature, asyncHandler(async (req, res) => {
     // ...handler existente...
   }));
   ```

5. Agregar `META_APP_SECRET` al `.env.example`:
   ```
   META_APP_SECRET=tu_app_secret_de_facebook
   ```

6. Validar en produccion que este configurado (agregar a `validateConfig()` en `src/config/index.js`):
   ```js
   if (!config.whatsapp.appSecret) {
     errors.push('META_APP_SECRET no esta configurado');
   }
   ```

---

#### 2. Verify Token con valor default inseguro

- **Archivo:** `src/config/index.js` (linea 28)
- **Codigo actual:**
  ```js
  verifyToken: process.env.VERIFY_TOKEN || 'default_token'
  ```
- **Descripcion:** Si la variable de entorno `VERIFY_TOKEN` no esta configurada, el sistema usa `default_token` como token de verificacion del webhook. Este valor esta en el codigo fuente y es trivialmente adivinable.
- **Impacto:** Un atacante puede verificar su propio webhook apuntando a la URL del servicio.

**Como corregir:**

1. Eliminar el valor por defecto en `src/config/index.js`:
   ```js
   verifyToken: process.env.VERIFY_TOKEN,
   ```

2. Agregar a la validacion de configuracion en `validateConfig()`:
   ```js
   if (!config.whatsapp.verifyToken) {
     errors.push('VERIFY_TOKEN no esta configurado');
   }
   ```

3. Generar un token seguro para produccion (32+ caracteres aleatorios):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

---

#### 3. API Key del asesor hardcodeada

- **Archivo:** `src/config/index.js` (linea 38)
- **Codigo actual:**
  ```js
  apiKey: process.env.ASESOR_API_KEY || 'dev-external-key-change-in-production'
  ```
- **Descripcion:** Si `ASESOR_API_KEY` no esta configurada, se usa una key de desarrollo que esta visible en el codigo fuente. Esta key se envia como header `X-API-Key` a la app de asesores.
- **Impacto:** Cualquiera que lea el codigo puede autenticarse contra el servicio de asesores.

**Como corregir:**

1. Eliminar el valor por defecto en `src/config/index.js`:
   ```js
   apiKey: process.env.ASESOR_API_KEY,
   ```

2. Agregar validacion en produccion:
   ```js
   if (config.apps['asesor'] && !config.asesor.apiKey) {
     errors.push('ASESOR_API_KEY no esta configurado pero hay app de asesor registrada');
   }
   ```

---

#### 4. Auth bypass cuando API_KEY no esta configurada

- **Archivo:** `src/middlewares/auth.js` (lineas 15-17)
- **Codigo actual:**
  ```js
  if (!config.apiKey) {
      logger.debug('No hay API Key configurada, permitiendo acceso');
      return next();
  }
  ```
- **Descripcion:** Si la variable de entorno `API_KEY` no esta seteada, TODOS los endpoints protegidos quedan abiertos sin autenticacion. Los endpoints afectados son: `POST /enviar`, `POST /enviar-template`, `POST /transferir`, `POST /finalizar/:numero`, `GET /estado`.
- **Impacto:** Un atacante puede enviar mensajes de WhatsApp, transferir conversaciones y ver el estado completo del sistema sin autenticacion.

**Como corregir:**

1. En produccion, no permitir el bypass. Modificar `src/middlewares/auth.js`:
   ```js
   const config = require('../config');
   const crypto = require('crypto');

   function authenticate(req, res, next) {
     if (!config.apiKey) {
       if (config.isProduction()) {
         throw new UnauthorizedError('API Key no configurada en el servidor');
       }
       // Solo permitir bypass en desarrollo
       logger.debug('Modo desarrollo: acceso sin API Key');
       return next();
     }

     const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

     if (!apiKey) {
       throw new UnauthorizedError('API Key requerida');
     }

     // Comparacion segura contra timing attacks
     const apiKeyBuffer = Buffer.from(apiKey);
     const expectedBuffer = Buffer.from(config.apiKey);

     if (apiKeyBuffer.length !== expectedBuffer.length ||
         !crypto.timingSafeEqual(apiKeyBuffer, expectedBuffer)) {
       throw new UnauthorizedError('API Key invalida');
     }

     next();
   }
   ```

2. Hacer que `API_KEY` sea obligatoria en produccion (`src/config/index.js` en `validateConfig()`):
   ```js
   if (!config.apiKey) {
     errors.push('API_KEY no esta configurada');
   }
   ```

---

### ALTO

---

#### 5. CORS habilitado innecesariamente

- **Archivo:** `src/index.js` (linea 29)
- **Codigo actual:**
  ```js
  app.use(cors());
  ```
- **Descripcion:** CORS solo es necesario cuando un frontend en browser necesita llamar a la API. Este dispatcher solo recibe llamadas server-to-server (webhooks de Meta, apps backend como bot y asesor). Tener CORS habilitado sin restricciones permite que cualquier sitio web malicioso haga requests al dispatcher desde el browser de un usuario.
- **Impacto:** Superficie de ataque innecesaria. Cualquier sitio web puede hacer requests cross-origin al dispatcher.

**Como corregir:**

1. Eliminar CORS completamente en `src/index.js`:
   ```js
   // ELIMINAR estas lineas:
   const cors = require('cors');
   app.use(cors());
   ```

2. Desinstalar la dependencia:
   ```bash
   npm uninstall cors
   ```

3. Sin el header `Access-Control-Allow-Origin`, los browsers bloquean todo por defecto. Es el comportamiento mas seguro y con cero configuracion.

4. Si en el futuro se necesita un panel admin web que llame al dispatcher, agregar CORS solo para esas rutas puntuales, no de forma global.

---

#### 6. Endpoints sensibles sin autenticacion

- **Archivo:** `src/routes/admin.routes.js`
- **Endpoints afectados:**
  - `GET /health` (linea 27) - expone estado de Redis, entorno, cantidad de apps
  - `GET /metrics` (linea 83) - expone metricas internas de Prometheus (CPU, memoria, contadores)
  - `GET /aplicaciones` (linea 259) - expone nombres y URLs de las apps downstream
  - `GET /` (linea 276) - expone version, entorno y lista de endpoints
- **Impacto:** Un atacante obtiene informacion para planificar ataques: infraestructura interna, URLs de servicios, version del software, estado de dependencias.

**Como corregir:**

1. Proteger `/metrics` y `/estado` con autenticacion (ya la tienen parcialmente):
   ```js
   router.get('/metrics', authenticate, asyncHandler(async (req, res) => {
     // ...existente...
   }));
   ```

2. Reducir informacion en `/health` publico (solo devolver status):
   ```js
   router.get('/health', asyncHandler(async (req, res) => {
     const redisOk = await redisService.healthCheck();
     const statusCode = redisOk ? 200 : 503;
     res.status(statusCode).json({ status: redisOk ? 'healthy' : 'unhealthy' });
   }));

   // Health detallado solo con auth
   router.get('/health/detail', authenticate, asyncHandler(async (req, res) => {
     // ...version detallada actual...
   }));
   ```

3. Proteger `/aplicaciones` con autenticacion:
   ```js
   router.get('/aplicaciones', authenticate, (req, res) => {
     // ...existente...
   });
   ```

4. Reducir informacion en `/` (root):
   ```js
   router.get('/', (req, res) => {
     res.json({
       service: 'WhatsApp Dispatcher',
       status: 'running',
     });
   });
   ```

---

#### 7. Logging de datos sensibles

- **Archivos afectados:**
  - `src/index.js:101` - Logea prefijo del token de WhatsApp
  - `src/index.js:103` - Logea el verify token **completo**
  - `src/services/whatsapp.service.js:33` - Logea prefijo del token en cada envio
  - `src/services/whatsapp.service.js:83` - Logea headers de error (incluye header `Authorization` con Bearer token)
  - `src/routes/webhook.routes.js:32-33` - Logea el token esperado vs recibido en verificacion fallida
  - `src/routes/webhook.routes.js:49` - Logea body completo del webhook (contiene datos personales: nombres, telefonos, mensajes de usuarios)
  - `src/middlewares/requestLogger.js:69-74` - Logea headers completos del request (pueden incluir API keys)
- **Impacto:** Si los logs son accedidos por un atacante (file inclusion, log aggregator comprometido, backup no cifrado), obtiene tokens, API keys y datos personales de los usuarios.

**Como corregir:**

1. En `src/index.js`, eliminar el logging de tokens al inicio:
   ```js
   // ANTES (inseguro):
   logger.info(`Token: ${config.whatsapp.token.substring(0, 20)}...`);
   logger.info(`Verify Token: ${config.whatsapp.verifyToken}`);

   // DESPUES (seguro):
   logger.info(`Token: ${config.whatsapp.token ? 'configurado' : 'NO CONFIGURADO'}`);
   logger.info(`Verify Token: ${config.whatsapp.verifyToken ? 'configurado' : 'NO CONFIGURADO'}`);
   ```

2. En `src/services/whatsapp.service.js`, eliminar logging de tokens y headers:
   ```js
   // Eliminar estas lineas:
   // logger.info(`Token (primeros 20 chars): ${...}`);
   // logger.error(`Headers enviados: ${JSON.stringify(error.config?.headers)}`);

   // Reemplazar con:
   logger.info('Preparando envio a Meta', { numero, tipo: 'texto' });
   logger.error('Error enviando mensaje', {
     status: error.response?.status,
     errorCode: error.response?.data?.error?.code,
   });
   ```

3. En `src/routes/webhook.routes.js`, no logear el token esperado ni el body completo:
   ```js
   // ANTES:
   logger.warn('Verificacion fallida', { receivedToken: token, expectedToken: config.whatsapp.verifyToken });
   logger.info('Body completo:', { body: JSON.stringify(req.body, null, 2) });

   // DESPUES:
   logger.warn('Verificacion de webhook fallida', { ip: req.ip });
   logger.info('Webhook recibido', { messageType: req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.type });
   ```

4. En `src/middlewares/requestLogger.js`, no logear headers completos:
   ```js
   // ANTES:
   logger.debug('Webhook recibido', { body: JSON.stringify(req.body), headers: req.headers });

   // DESPUES:
   logger.debug('Webhook recibido', { contentType: req.headers['content-type'] });
   ```

---

#### 8. Comparacion de API Key vulnerable a timing attack

- **Archivo:** `src/middlewares/auth.js` (linea 31)
- **Codigo actual:**
  ```js
  if (apiKey !== config.apiKey) {
  ```
- **Descripcion:** La comparacion con `!==` en JavaScript retorna `false` en el primer caracter que difiere. Un atacante puede medir microsegundos de diferencia en la respuesta para inferir la API key caracter por caracter.
- **Impacto:** Con suficientes requests, un atacante puede descubrir la API key.

**Como corregir:**

Ya incluido en la correccion del punto 4. Usar `crypto.timingSafeEqual()`:
```js
const crypto = require('crypto');

const apiKeyBuffer = Buffer.from(apiKey);
const expectedBuffer = Buffer.from(config.apiKey);

if (apiKeyBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(apiKeyBuffer, expectedBuffer)) {
  throw new UnauthorizedError('API Key invalida');
}
```

---

#### 9. Almacenamiento en memoria en produccion

- **Archivo:** `src/services/redis.service.js`
- **Descripcion:** El servicio de "Redis" es en realidad un almacenamiento en memoria usando `Map()`. El `docker-compose.prod.yml` configura 3 replicas, lo que significa que cada replica tiene su propio estado independiente.
- **Impacto:**
  - Los datos de routing se pierden al reiniciar el servidor
  - Con multiples replicas, un usuario puede ser enrutado a diferentes apps segun que replica reciba el request
  - Las estadisticas son inconsistentes entre replicas

**Como corregir:**

1. Implementar Redis real para produccion. Agregar al `docker-compose.prod.yml`:
   ```yaml
   redis:
     image: redis:7-alpine
     command: redis-server --requirepass ${REDIS_PASSWORD}
     ports:
       - "6379:6379"
     volumes:
       - redis_data:/data
     restart: always

   volumes:
     redis_data:
   ```

2. Crear un servicio Redis real (`src/services/redis.service.real.js`) usando la libreria `ioredis` o `redis`.

3. Bloquear inicio en produccion si Redis no esta disponible:
   ```js
   if (config.isProduction() && !redisService.isRedisConnected()) {
     logger.error('Redis no disponible en produccion');
     process.exit(1);
   }
   ```

---

### MEDIO

---

#### 10. Rate limiter en memoria no funciona con multiples replicas

- **Archivo:** `src/middlewares/rateLimiter.js` (linea 12)
- **Descripcion:** `RateLimiterMemory` es per-process. Con 3 replicas, un atacante obtiene 3x el limite (300 requests/minuto en vez de 100).
- **Impacto:** Rate limiting inefectivo en produccion con multiples instancias.

**Como corregir:**

Cambiar a `RateLimiterRedis` cuando Redis este disponible:
```js
const { RateLimiterRedis } = require('rate-limiter-flexible');
const redisService = require('../services/redis.service');

const rateLimiter = new RateLimiterRedis({
  storeClient: redisService.getClient(),
  points: config.rateLimit.max,
  duration: config.rateLimit.windowMs / 1000,
  blockDuration: 60,
});
```

---

#### 11. Body limit excesivo (10MB)

- **Archivo:** `src/index.js` (linea 32)
- **Codigo actual:**
  ```js
  app.use(express.json({ limit: '10mb' }));
  ```
- **Descripcion:** Un webhook de WhatsApp tipicamente no supera unos pocos KB. Un limite de 10MB permite a un atacante enviar payloads enormes que consumen memoria del servidor.
- **Impacto:** Denial of Service por consumo de memoria.

**Como corregir:**

Reducir el limite global y aplicar uno especifico para webhooks:
```js
// Limite global conservador
app.use(express.json({ limit: '1mb' }));

// O limite especifico por ruta (en webhook.routes.js):
router.post('/', express.json({ limit: '256kb' }), webhookRateLimitMiddleware, asyncHandler(...));
```

---

#### 12. No hay validacion del body del webhook POST

- **Archivo:** `src/routes/webhook.routes.js` (lineas 43-46)
- **Descripcion:** El endpoint POST `/webhook` no tiene middleware `validateBody()`. Acepta cualquier JSON y lo pasa directamente a las apps downstream via `routerService.enrutarMensaje()`.
- **Impacto:** Un atacante puede enviar payloads malformados o con campos extra que las apps downstream no esperan, potencialmente explotando vulnerabilidades en ellas.

**Como corregir:**

Agregar un schema Joi para validar la estructura minima del webhook de Meta:
```js
// En src/validators/schemas.js
const webhookBodySchema = Joi.object({
  object: Joi.string().valid('whatsapp_business_account').required(),
  entry: Joi.array().items(
    Joi.object({
      id: Joi.string().required(),
      changes: Joi.array().items(
        Joi.object({
          value: Joi.object().required(),
          field: Joi.string().required(),
        })
      ).required(),
    })
  ).required(),
});
```

Aplicar en la ruta:
```js
router.post('/', webhookRateLimitMiddleware, validateBody(webhookBodySchema), asyncHandler(...));
```

---

#### 13. Metricas con label de IP permiten cardinality explosion

- **Archivo:** `src/utils/metrics.js` (linea 98) y `src/middlewares/rateLimiter.js` (linea 31)
- **Codigo actual:**
  ```js
  rateLimitHits.labels(req.ip).inc();
  ```
- **Descripcion:** Cada IP unica crea una nueva serie temporal en Prometheus. Un atacante con IPs rotativas puede crear miles de series, consumiendo memoria hasta crashear el servidor.
- **Impacto:** Denial of Service via cardinality explosion en Prometheus.

**Como corregir:**

Eliminar el label de IP de la metrica:
```js
// En metrics.js:
const rateLimitHits = new promClient.Counter({
  name: 'dispatcher_rate_limit_hits_total',
  help: 'Total de requests bloqueados por rate limiting',
  // Sin labelNames de IP
  registers: [register],
});

// En rateLimiter.js:
rateLimitHits.inc(); // Sin labels
```

Si se necesita rastrear IPs, hacerlo en los logs (no en metricas).

---

#### 14. Error handler expone stack traces cuando NODE_ENV no es production

- **Archivo:** `src/middlewares/errorHandler.js` (lineas 84-93)
- **Descripcion:** Si `NODE_ENV` no esta explicitamente seteado como `production`, se devuelven stack traces completos al cliente, incluyendo rutas de archivos del servidor y dependencias.
- **Impacto:** Information disclosure que facilita ataques dirigidos.

**Como corregir:**

Invertir la logica para que solo muestre detalles si explicitamente es desarrollo:
```js
if (config.isDevelopment()) {
  // Mostrar detalles solo en desarrollo explicito
  return res.status(err.statusCode).json({
    error: {
      message: err.message,
      stack: err.stack,
    },
  });
}

// En cualquier otro caso (production, staging, undefined): ocultar detalles
```

---

### BAJO

---

#### 15. Dockerfile usa Node 18

- **Archivo:** `Dockerfile` (linea 4)
- **Descripcion:** Node 18 LTS llego a End of Life en abril 2025. No recibe mas parches de seguridad.

**Como corregir:**

Actualizar a Node 20 o 22:
```dockerfile
FROM node:20-alpine AS dependencies
# ...
FROM node:20-alpine AS runtime
```

Actualizar `engines` en `package.json`:
```json
"engines": {
  "node": ">=20.0.0"
}
```

---

#### 16. Falta configuracion adicional de Helmet

- **Archivo:** `src/index.js` (linea 28)
- **Descripcion:** `helmet()` se usa con configuracion por defecto. Se pueden agregar headers adicionales de seguridad.

**Como corregir:**

```js
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 anio
    includeSubDomains: true,
    preload: true,
  },
}));
```

---

## Plan de Implementacion

### Fase 1 - Criticos (antes de exponer a internet)

| # | Tarea | Hallazgo | Esfuerzo |
|---|-------|----------|----------|
| 1 | Implementar verificacion de firma X-Hub-Signature-256 | #1 | Alto |
| 2 | Eliminar defaults inseguros de VERIFY_TOKEN | #2 | Bajo |
| 3 | Eliminar default inseguro de ASESOR_API_KEY | #3 | Bajo |
| 4 | Bloquear bypass de auth en produccion + timing-safe compare | #4, #8 | Medio |
| 5 | Agregar META_APP_SECRET como variable requerida | #1 | Bajo |
| 6 | Hacer API_KEY obligatoria en produccion | #4 | Bajo |

**Resultado:** El servicio rechaza webhooks no firmados por Meta, requiere autenticacion en todos los endpoints admin, y no tiene credenciales por defecto.

### Fase 2 - Altos (hardening antes de produccion)

| # | Tarea | Hallazgo | Esfuerzo |
|---|-------|----------|----------|
| 7 | Eliminar CORS (no se necesita, todo es server-to-server) | #5 | Bajo |
| 8 | Proteger /metrics, /aplicaciones con auth; reducir info en /health y / | #6 | Medio |
| 9 | Limpiar logging de tokens, headers y datos personales | #7 | Medio |
| 10 | Reducir body limit a 1MB (o 256KB para webhooks) | #11 | Bajo |
| 11 | Agregar schema de validacion para body del webhook POST | #12 | Medio |

**Resultado:** Se minimiza la superficie de ataque y la filtracion de informacion sensible.

### Fase 3 - Infraestructura (antes de escalar)

| # | Tarea | Hallazgo | Esfuerzo |
|---|-------|----------|----------|
| 12 | Implementar Redis real para produccion | #9 | Alto |
| 13 | Migrar rate limiter a Redis | #10 | Medio |
| 14 | Eliminar label de IP en metricas de rate limit | #13 | Bajo |
| 15 | Actualizar Node a 20 o 22 en Dockerfile | #15 | Bajo |
| 16 | Configurar Helmet con CSP y HSTS | #16 | Bajo |
| 17 | Invertir logica de error handler (ocultar por defecto) | #14 | Bajo |

**Resultado:** Infraestructura lista para multiples replicas con estado compartido y dependencias actualizadas.

---

## Variables de Entorno Nuevas Requeridas

Agregar al `.env.example` y configurar en produccion:

```
# SEGURIDAD (obligatorios en produccion)
META_APP_SECRET=tu_app_secret_de_facebook_app
API_KEY=clave_segura_generada_con_crypto
VERIFY_TOKEN=token_seguro_generado_con_crypto
ASESOR_API_KEY=clave_segura_para_asesor

# REDIS (obligatorio en produccion con multiples replicas)
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=password_seguro_de_redis
```

Para generar valores seguros:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Checklist Pre-Produccion

- [ ] META_APP_SECRET configurado y verificacion de firma implementada
- [ ] VERIFY_TOKEN con valor seguro (sin default)
- [ ] API_KEY configurada y obligatoria
- [ ] ASESOR_API_KEY configurada (sin default)
- [ ] CORS eliminado (dependencia desinstalada)
- [ ] Endpoints sensibles protegidos con auth
- [ ] Logs limpios de tokens y datos personales
- [ ] Body limit reducido
- [ ] Validacion de body en webhook POST
- [ ] Redis real implementado (si se usan multiples replicas)
- [ ] Rate limiter en Redis (si se usan multiples replicas)
- [ ] Node actualizado a v20+
- [ ] NODE_ENV=production configurado
- [ ] HTTPS configurado en el reverse proxy (nginx/cloudflare)
- [ ] Firewall configurado (solo puerto 443 expuesto)
