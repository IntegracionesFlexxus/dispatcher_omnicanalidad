# 🔒 Guía de Seguridad - WhatsApp Dispatcher

Esta guía explica las políticas de seguridad implementadas en el WhatsApp Dispatcher y cómo configurarlas correctamente para proteger tu sistema en producción.

---

## 📋 Índice

1. [Resumen de Seguridad](#resumen-de-seguridad)
2. [Verificación de Firma de Webhooks](#verificación-de-firma-de-webhooks)
3. [Sanitización de Logs](#sanitización-de-logs)
4. [CORS Restrictivo](#cors-restrictivo)
5. [Gestión de API Keys](#gestión-de-api-keys)
6. [Checklist de Despliegue Seguro](#checklist-de-despliegue-seguro)
7. [Monitoreo y Respuesta a Incidentes](#monitoreo-y-respuesta-a-incidentes)

---

## 🎯 Resumen de Seguridad

El WhatsApp Dispatcher implementa múltiples capas de seguridad:

| Capa de Seguridad | Estado | Descripción |
|-------------------|--------|-------------|
| ✅ Verificación de Firma de Webhooks | **ACTIVA** | Valida X-Hub-Signature-256 de WhatsApp |
| ✅ Sanitización de Logs | **ACTIVA** | Oculta tokens y secrets en logs |
| ✅ CORS Restrictivo | **ACTIVA** | Bloquea orígenes no autorizados |
| ✅ Helmet Security Headers | **ACTIVA** | Headers HTTP seguros |
| ✅ Rate Limiting | **ACTIVA** | Límite de requests por IP |
| ✅ Usuario no-root en Docker | **ACTIVA** | Contenedor corre con usuario limitado |
| ⚠️ API Key Authentication | **OPCIONAL** | Requiere configuración manual |

---

## 🔐 1. Verificación de Firma de Webhooks

### ¿Qué protege?

Previene que atacantes envíen webhooks falsos a tu servidor haciéndose pasar por WhatsApp. Sin esta verificación, cualquiera podría inyectar mensajes maliciosos en tu sistema.

### ¿Cómo funciona?

WhatsApp firma cada webhook con un hash HMAC-SHA256 usando tu **App Secret**. El dispatcher valida esta firma antes de procesar el mensaje.

```
Webhook de WhatsApp → Header X-Hub-Signature-256 → Middleware verifica → ✅ Procesa / ❌ Rechaza
```

### Configuración

#### Paso 1: Obtener el App Secret

1. Ve a [Facebook Developers](https://developers.facebook.com/)
2. Selecciona tu aplicación de WhatsApp Business
3. Ve a **Settings > Basic**
4. Busca el campo **App Secret** (haz clic en "Show" para verlo)
5. Copia el valor

#### Paso 2: Configurar la Variable de Entorno

**En archivo .env (desarrollo):**
```bash
WHATSAPP_APP_SECRET=tu_app_secret_aqui
```

**En Portainer (producción):**

Agregar variable de entorno en la configuración del contenedor:
```
WHATSAPP_APP_SECRET=tu_app_secret_aqui
```

#### Paso 3: Verificar que Funciona

Inicia el servidor y busca en los logs:

✅ **Con App Secret configurado:**
```
✅ Firma de webhook verificada correctamente
```

⚠️ **Sin App Secret configurado:**
```
⚠️  WHATSAPP_APP_SECRET no configurado - verificación de firma deshabilitada
⚠️  Esto es un riesgo de seguridad en producción
```

### Comportamiento

| Entorno | App Secret | Comportamiento |
|---------|-----------|---------------|
| Desarrollo | NO configurado | ⚠️ Permite webhooks sin firma (warning) |
| Desarrollo | Configurado | ✅ Valida firma |
| Producción | NO configurado | ⚠️ Permite webhooks sin firma (warning) |
| Producción | Configurado | ✅ Valida firma, rechaza inválidos |

**Recomendación**: Configurar SIEMPRE en producción.

### Troubleshooting

**Error: "Firma de webhook inválida"**

Causas comunes:
- App Secret incorrecto → Verifica en Facebook Developers
- Body del webhook modificado → El middleware debe ejecutarse ANTES de otros que modifiquen `req.body`
- Encoding incorrecto → El dispatcher espera UTF-8

Verifica en logs:
```
⚠️  Firma de webhook inválida
   • IP: 173.252.XX.XX
   • Received signature: sha256=abc123...
   • Expected signature: sha256=def456...
```

---

## 📝 2. Sanitización de Logs

### ¿Qué protege?

Previene la exposición de tokens, API keys y otros secrets en archivos de log. Sin sanitización, un atacante con acceso a logs podría obtener credenciales completas.

### ¿Qué se sanitiza?

#### Antes (❌ INSEGURO):
```javascript
logger.info(`Token (primeros 20 chars): EAAKTrzWzTJIBP5rQLBR...`);
logger.error(`Headers: ${JSON.stringify({
  "Authorization": "Bearer EAAKTrzWzTJIBP5rQLBRlv4Kv3ZCpLClGw63ZCH175SU1ZAZBLY..."
})}`);
```

#### Después (✅ SEGURO):
```javascript
logger.info(`Token: EAAK...DZDZ`);  // Solo primeros y últimos 4 caracteres
logger.error(`Headers: ${JSON.stringify({
  "Authorization": "***REDACTED***"
})}`);
```

### Funciones Disponibles

El módulo `src/utils/sanitize.js` provee:

```javascript
const {
  sanitizeToken,      // Oculta tokens mostrando solo inicio/fin
  sanitizeHeaders,    // Oculta Authorization, X-API-Key, etc.
  sanitizeUrl,        // Oculta query params sensibles
  sanitizeObject,     // Sanitiza objetos completos recursivamente
  sanitizeError       // Sanitiza errores de axios/http
} = require('./utils/sanitize');
```

### Uso en Tu Código

Si agregas nuevos logs con información sensible, usa estas funciones:

```javascript
// ❌ NO HAGAS ESTO:
logger.info(`API Key: ${apiKey}`);
logger.error(`Error:`, error);

// ✅ HAZ ESTO:
logger.info(`API Key: ${sanitizeToken(apiKey)}`);
logger.error(`Error:`, sanitizeError(error));
```

### Headers Sanitizados Automáticamente

- `Authorization`
- `X-API-Key`
- `X-Hub-Signature`
- `X-Hub-Signature-256`
- `Cookie` / `Set-Cookie`

### Campos de Objetos Sanitizados

Al usar `sanitizeObject()`, estos campos se ocultan:
- `password`
- `token` / `api_key` / `apiKey`
- `secret` / `app_secret`
- `authorization`
- Cualquier variación en mayúsculas/minúsculas

### Verificación

Busca en tus logs (`logs/dispatcher.log`):

✅ **Debe aparecer así:**
```
Token: EAAK...DZDZ
Headers enviados: { "Authorization": "***REDACTED***" }
```

❌ **NO debe aparecer así:**
```
Token: EAAKTrzWzTJIBP5rQLBRlv4Kv3ZCpLClGw63ZCH175SU1ZAZBLywZAw4cFcsnCVL...
Headers enviados: { "Authorization": "Bearer EAAKTrzW..." }
```

---

## 🌐 3. CORS Restrictivo

### ¿Qué protege?

Previene que sitios web maliciosos hagan requests a tu API desde navegadores de usuarios. Sin CORS restrictivo, un atacante podría crear una página web que use tu API sin autorización.

### Comportamiento por Entorno

#### Desarrollo (NODE_ENV=development)

```javascript
// CORS PERMISIVO - Permite todos los orígenes
app.use(cors());
```

✅ Útil para desarrollo local
⚠️ No usar en producción

**Logs:**
```
🔓 CORS: Modo desarrollo (todos los orígenes permitidos)
```

#### Producción (NODE_ENV=production)

**Opción A: Con orígenes permitidos**

```bash
# .env o Portainer
ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
```

```javascript
// Solo estos dominios pueden hacer requests desde navegadores
app.use(cors({
  origin: ['https://app.example.com', 'https://admin.example.com'],
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'X-App-Name', 'Authorization']
}));
```

**Logs:**
```
🔒 CORS: Modo restrictivo
   • allowedOrigins: ['https://app.example.com', 'https://admin.example.com']
```

**Opción B: Sin orígenes (solo server-to-server)**

```bash
# .env o Portainer
ALLOWED_ORIGINS=
```

```javascript
// Bloquea TODOS los requests desde navegadores
// Solo permite server-to-server
app.use(cors({ origin: false }));
```

**Logs:**
```
🔒 CORS: Modo restrictivo (solo server-to-server)
```

### ¿Cuál configuración usar?

| Caso de Uso | Configuración Recomendada |
|-------------|--------------------------|
| API solo para backend/mobile | `ALLOWED_ORIGINS=` (vacío) - Bloquea navegadores |
| API con frontend web | `ALLOWED_ORIGINS=https://tu-frontend.com` |
| Múltiples frontends | `ALLOWED_ORIGINS=https://app.com,https://admin.com` |
| Desarrollo local | Automático (permite todos) |

### Configuración en Portainer

1. Ve a tu contenedor > **Duplicate/Edit**
2. Sección **Env** (variables de entorno)
3. Agrega:
   ```
   Name: ALLOWED_ORIGINS
   Value: https://tu-dominio.com
   ```
4. **Deploy the container**

### Testing

#### Test 1: Request desde navegador bloqueado

Si configuraste `ALLOWED_ORIGINS=` (vacío), al hacer un fetch desde el navegador:

```javascript
fetch('https://tu-dispatcher.com/estado', {
  headers: { 'X-API-Key': 'tu_key' }
})
.then(r => r.json())
.catch(e => console.log('Bloqueado por CORS'));
```

**Resultado esperado:**
```
❌ Access to fetch at 'https://tu-dispatcher.com/estado' from origin 'https://sitio-malicioso.com'
   has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present.
```

#### Test 2: Request server-to-server funciona

```bash
curl -X GET https://tu-dispatcher.com/estado \
  -H "X-API-Key: tu_key"
```

**Resultado esperado:**
```
✅ 200 OK
{ "status": "ok", ... }
```

### Troubleshooting

**Error: "CORS policy: No 'Access-Control-Allow-Origin' header"**

- ✅ Esto es **CORRECTO** si el request viene de un origen no autorizado
- Si el request DEBE permitirse, agrega el dominio a `ALLOWED_ORIGINS`
- Verifica que el dominio incluya protocolo: `https://` no `www.example.com`

**Error: "CORS policy: Credentials flag is 'true'"**

- Verifica que tu frontend no envíe `credentials: 'include'` sin estar en `ALLOWED_ORIGINS`

---

## 🔑 4. Gestión de API Keys

### Generación de API Keys Seguras

❌ **NO uses valores débiles:**
```bash
API_KEY=123456
API_KEY=LO_QUE_QUIERAS
API_KEY=mi_api_key
```

✅ **Genera claves criptográficamente seguras:**

**Opción A: OpenSSL (Linux/Mac/WSL)**
```bash
openssl rand -base64 32
# Output: 3K8jP2fX9mN4qR7sT1vU6wY0zC5bH8aE4gJ9lM2nO7pQ
```

**Opción B: Node.js**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Opción C: PowerShell (Windows)**
```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

### Configuración en Portainer

1. Genera una API Key segura (ver arriba)
2. En Portainer, ve a tu contenedor > **Duplicate/Edit**
3. Sección **Env** (variables de entorno)
4. Agrega o actualiza:
   ```
   Name: API_KEY
   Value: 3K8jP2fX9mN4qR7sT1vU6wY0zC5bH8aE4gJ9lM2nO7pQ
   ```
5. **Deploy the container**

### Rotación de API Keys

**Cuando rotar:**
- Cada 90 días (recomendado)
- Si la key se expone (logs, git, comunicación insegura)
- Cuando un empleado con acceso deja la empresa
- Después de un incidente de seguridad

**Procedimiento:**

1. **Genera nueva API Key**
   ```bash
   openssl rand -base64 32
   ```

2. **Actualiza en Portainer**
   - Variable: `API_KEY`
   - Nuevo valor: `[nueva_key_generada]`
   - Deploy

3. **Actualiza en clientes**
   - Aplicaciones que consumen el dispatcher
   - Update header `X-API-Key: [nueva_key]`

4. **Verifica funcionamiento**
   ```bash
   curl -X GET https://tu-dispatcher.com/estado \
     -H "X-API-Key: [nueva_key]"
   ```

5. **Monitorea logs** durante 24h
   - Verifica requests fallidos con key antigua
   - Asegura que todos los clientes actualizaron

### API Keys Múltiples (Futuro)

Actualmente el dispatcher usa una API Key global. Para mayor seguridad, considera implementar:

- **API Keys por aplicación**: Una key diferente para bot, asesor, admin, etc.
- **API Keys con permisos**: Algunas keys solo pueden leer, otras escribir
- **API Keys con expiración**: Rotación automática cada X días

---

## ✅ 5. Checklist de Despliegue Seguro

Antes de desplegar a producción, verifica:

### Variables de Entorno

```bash
# ========== OBLIGATORIAS ==========
☑ WHATSAPP_TOKEN         # Token de WhatsApp Cloud API
☑ PHONE_NUMBER_ID        # ID del número de WhatsApp
☑ VERIFY_TOKEN           # Token de verificación de webhook
☑ WHATSAPP_APP_SECRET    # App Secret para verificar firma de webhooks

# ========== RECOMENDADAS ==========
☑ API_KEY                # API Key fuerte (generada con openssl rand -base64 32)
☑ NODE_ENV=production    # Activa modo producción (CORS restrictivo, logs JSON)
☑ ALLOWED_ORIGINS        # Vacío (server-to-server) o dominios específicos

# ========== OPCIONALES ==========
☐ RATE_LIMIT_MAX_REQUESTS  # Por defecto: 100 req/min
☐ LOG_LEVEL                # Por defecto: info (usar 'warn' en prod para menos logs)
```

### Configuración de Infraestructura

```bash
☑ HTTPS/TLS configurado (Certificado SSL válido)
☑ Reverse proxy (Nginx/Traefik) delante del dispatcher
☑ Firewall configurado (solo puertos 80/443 públicos)
☑ Rate limiting adicional en reverse proxy
☑ Logs centralizados (CloudWatch, Splunk, ELK)
☑ Monitoreo de métricas (Prometheus + Grafana)
☑ Backups automatizados
☑ Alertas configuradas (CPU, memoria, errores 5xx)
```

### Docker/Portainer

```bash
☑ Imagen Docker actualizada (sin vulnerabilidades)
☑ Usuario no-root en contenedor (nodejs:1001)
☑ Resource limits configurados (CPU, memoria)
☑ Health checks activos
☑ Restart policy: always
☑ Logs con log driver adecuado (json-file con size limit)
☑ Secrets NO en variables de entorno visibles (usar Docker Secrets si es posible)
```

### Testing de Seguridad

```bash
☑ npm audit (sin vulnerabilidades críticas/altas)
☑ Docker scan de imagen
☑ Test de webhook con firma válida → ✅ Acepta
☑ Test de webhook con firma inválida → ❌ Rechaza 401
☑ Test de request sin API Key → ❌ Rechaza 401
☑ Test de CORS desde origen no permitido → ❌ Bloqueado
☑ Test de rate limiting → 429 después de límite
☑ Revisar logs: NO aparecen tokens completos
```

---

## 📊 6. Monitoreo y Respuesta a Incidentes

### Métricas de Seguridad

El dispatcher expone métricas de Prometheus en `/metrics`:

```prometheus
# Webhooks con firma inválida
dispatcher_security_events_total{type="webhook_signature_failed",severity="critical"}

# Requests sin API Key
dispatcher_security_events_total{type="invalid_api_key",severity="high"}

# Rate limit alcanzado
dispatcher_http_request_duration_seconds_count{status="429"}
```

### Dashboards Recomendados (Grafana)

**Panel 1: Seguridad**
- Webhooks rechazados por firma inválida (últimas 24h)
- Requests con API Key inválida (últimas 24h)
- Rate limits alcanzados por IP

**Panel 2: Disponibilidad**
- Uptime del servicio
- Latencia de requests (P50, P95, P99)
- Error rate (% de 5xx)

**Panel 3: WhatsApp API**
- Mensajes enviados exitosamente
- Errores de WhatsApp API por tipo
- Latencia de llamadas a WhatsApp

### Alertas Críticas

Configura alertas para:

```yaml
# Alerta 1: Webhooks con firma inválida
- name: webhook_signature_failed
  condition: > 5 intentos en 5 minutos
  action: Notificar equipo seguridad
  urgency: ALTA

# Alerta 2: API Key inválida repetida
- name: api_key_bruteforce
  condition: > 10 intentos desde misma IP en 1 minuto
  action: Bloquear IP, notificar
  urgency: CRÍTICA

# Alerta 3: Error rate alto
- name: error_rate_high
  condition: > 5% requests con 5xx por 5 minutos
  action: Notificar on-call
  urgency: ALTA

# Alerta 4: WhatsApp API token inválido
- name: whatsapp_token_invalid
  condition: HTTP 401 desde WhatsApp API
  action: Notificar, revisar token
  urgency: CRÍTICA
```

### Respuesta a Incidentes

#### Incidente 1: Token de WhatsApp Comprometido

**Síntomas:**
- Mensajes enviados que no autorizaste
- Cargos inesperados en Meta Business
- Alerta de uso anómalo

**Respuesta:**

1. **INMEDIATO (< 5 min)**
   - Desactivar dispatcher (detener contenedor)
   - Revocar token en Facebook Business Manager
   - Generar nuevo token

2. **CORTO PLAZO (< 1 hora)**
   - Auditar logs: identificar requests maliciosos
   - Identificar origen de la filtración
   - Actualizar token en Portainer
   - Reiniciar dispatcher

3. **SEGUIMIENTO**
   - Revisar cargos de WhatsApp API
   - Implementar alertas de uso anómalo
   - Revisar accesos a logs/secrets

#### Incidente 2: API Key Filtrada

**Síntomas:**
- Requests desde IPs desconocidas
- Uso anómalo de API
- Múltiples intentos de envío

**Respuesta:**

1. **INMEDIATO**
   - Rotar API_KEY inmediatamente
   - Identificar IPs maliciosas en logs
   - Bloquear IPs en firewall

2. **CORTO PLAZO**
   - Auditar todos los requests con key filtrada
   - Actualizar key en clientes legítimos
   - Verificar funcionamiento post-rotación

3. **SEGUIMIENTO**
   - Revisar cómo se filtró la key
   - Implementar rotación periódica
   - Capacitar equipo sobre gestión de secrets

#### Incidente 3: Ataque de Webhooks Falsos

**Síntomas:**
- Alerta: Webhooks con firma inválida
- IPs no conocidas intentando POST /webhook
- Logs de mensajes extraños

**Respuesta:**

1. **VERIFICAR** que `WHATSAPP_APP_SECRET` está configurado
2. **CONFIRMAR** que middleware de firma está activo
3. **BLOQUEAR** IPs atacantes en firewall
4. **MONITOREAR** logs por 24h

---

## 🔗 Referencias y Recursos

### Documentación Oficial

- [WhatsApp Cloud API - Webhook Security](https://developers.facebook.com/docs/graph-api/webhooks/getting-started)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)

### Herramientas de Seguridad

- **npm audit**: Escanea vulnerabilidades en dependencias
- **Docker scan**: Analiza imágenes de Docker
- **Snyk**: Monitoreo continuo de vulnerabilidades
- **OWASP ZAP**: Testing de seguridad web

### Comandos Útiles

```bash
# Auditar dependencias
npm audit

# Arreglar vulnerabilidades automáticamente
npm audit fix

# Escanear imagen Docker
docker scan dispatcher:latest

# Ver logs de seguridad
docker logs dispatcher 2>&1 | grep -i "firma\|api key\|unauthorized"

# Generar API Key segura
openssl rand -base64 32
```

---

## 📞 Soporte

Si tienes dudas sobre seguridad o detectas una vulnerabilidad:

1. **NO** abras un issue público con detalles de la vulnerabilidad
2. Contacta al equipo de seguridad directamente
3. Proporciona detalles: logs sanitizados, pasos para reproducir, impacto

---

## 📝 Changelog

| Versión | Fecha | Cambios |
|---------|-------|---------|
| 1.0.0 | 2025-01-XX | Verificación de firma webhooks, sanitización de logs, CORS restrictivo |

---

## 📄 Licencia

Este documento es parte del proyecto WhatsApp Dispatcher.

**IMPORTANTE**: Las configuraciones de seguridad aquí descritas son responsabilidad del operador del sistema. El equipo de desarrollo provee las herramientas, pero la configuración correcta en producción es responsabilidad de quien despliega el sistema.
