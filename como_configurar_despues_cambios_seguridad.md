# Como Configurar el Dispatcher Despues de los Cambios de Seguridad

Esta guia explica paso a paso como configurar todas las variables y servicios externos despues de implementar las mejoras de seguridad documentadas en `mejoras_seguridad.md`.

---

## Indice

1. [Requisitos previos](#1-requisitos-previos)
2. [Configuracion en Meta (Facebook Developers)](#2-configuracion-en-meta-facebook-developers)
3. [Generar claves seguras](#3-generar-claves-seguras)
4. [Configurar el archivo .env de produccion](#4-configurar-el-archivo-env-de-produccion)
5. [Configurar Redis para produccion](#5-configurar-redis-para-produccion)
6. [Configurar el reverse proxy (HTTPS)](#6-configurar-el-reverse-proxy-https)
7. [Verificar que todo funciona](#7-verificar-que-todo-funciona)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Requisitos previos

Antes de empezar necesitas:

- Cuenta de Facebook Developers con una app creada
- Cuenta de WhatsApp Business con un numero de telefono verificado
- Acceso al servidor donde va a correr el dispatcher
- Un dominio con HTTPS (Meta requiere HTTPS para webhooks)
- Docker y Docker Compose instalados en el servidor

---

## 2. Configuracion en Meta (Facebook Developers)

### 2.1 Obtener el App Secret (META_APP_SECRET)

El App Secret es lo que Meta usa para firmar cada webhook que envia. Despues de los cambios de seguridad, el dispatcher va a verificar esta firma para asegurarse de que el webhook realmente viene de Meta.

1. Ir a https://developers.facebook.com/apps/
2. Seleccionar tu aplicacion
3. En el menu lateral, ir a **Configuracion de la app** > **Basica**
4. En el campo **Clave secreta de la app** (App Secret), hacer clic en **Mostrar**
5. Copiar el valor completo

Ese valor es el que vas a usar como `META_APP_SECRET` en tu `.env`.

**IMPORTANTE:** Nunca compartas ni commitees este valor. Si se filtra, ir a la misma pagina y hacer clic en **Restablecer la clave secreta**. Tene en cuenta que esto invalida la clave anterior inmediatamente, asi que hay que actualizar el `.env` y reiniciar el dispatcher al toque.

### 2.2 Obtener el Token de WhatsApp (WHATSAPP_TOKEN)

Hay dos tipos de token:

**Token temporal (para desarrollo):**
1. Ir a https://developers.facebook.com/apps/
2. Seleccionar tu app > **WhatsApp** > **Configuracion de la API**
3. En la seccion **Token de acceso temporal**, copiar el token
4. Este token vence en 24 horas

**Token permanente (para produccion):**
1. Ir a https://business.facebook.com/settings/system-users
2. Crear un **Usuario del sistema** (o usar uno existente)
3. Asignarle el permiso **whatsapp_business_messaging** sobre tu app
4. Generar un token para ese usuario del sistema
5. Copiar el token generado

El token permanente no vence, pero se puede revocar desde la misma pagina si se compromete.

### 2.3 Obtener el Phone Number ID (PHONE_NUMBER_ID)

1. Ir a tu app en Facebook Developers
2. En el menu lateral: **WhatsApp** > **Configuracion de la API**
3. En la seccion **Numero de telefono**, aparece el **ID del numero de telefono**
4. Es un numero largo, ejemplo: `123456789012345`

### 2.4 Configurar el Webhook en Meta

Una vez que el dispatcher este corriendo con HTTPS, hay que decirle a Meta donde enviar los webhooks.

1. Ir a tu app en Facebook Developers
2. En el menu lateral: **WhatsApp** > **Configuracion**
3. En la seccion **Webhook**, hacer clic en **Editar**
4. Completar:
   - **URL de devolucion de llamada:** `https://tu-dominio.com/webhook`
   - **Token de verificacion:** el mismo valor que pusiste en `VERIFY_TOKEN` en tu `.env`
5. Hacer clic en **Verificar y guardar**

Si la verificacion falla, revisar:
- Que el dispatcher este corriendo y accesible desde internet
- Que la URL sea HTTPS (Meta no acepta HTTP)
- Que el `VERIFY_TOKEN` coincida exactamente entre Meta y tu `.env`
- Que el puerto 443 este abierto en el firewall

### 2.5 Suscribirse a los campos del webhook

Despues de verificar el webhook, hay que elegir que eventos recibir:

1. En la misma seccion de Webhook, buscar **Campos de webhook**
2. Suscribirse a **messages** (obligatorio para recibir mensajes)
3. Opcionalmente suscribirse a:
   - **message_deliveries** - confirmaciones de entrega
   - **message_reads** - confirmaciones de lectura
   - **messaging_postbacks** - respuestas a botones/listas

### 2.6 Diagrama del flujo de verificacion

```
Meta                          Tu Servidor
  |                                |
  |  GET /webhook                  |
  |  ?hub.mode=subscribe           |
  |  &hub.verify_token=TU_TOKEN    |
  |  &hub.challenge=CHALLENGE_123  |
  |------------------------------->|
  |                                | Compara hub.verify_token con VERIFY_TOKEN del .env
  |                                | Si coincide:
  |  200 OK                        |
  |  Body: CHALLENGE_123           |
  |<-------------------------------|
  |                                |
  | Webhook verificado OK          |
```

### 2.7 Diagrama del flujo de mensajes (post cambios de seguridad)

```
Meta                              Tu Servidor
  |                                    |
  | POST /webhook                      |
  | Header: X-Hub-Signature-256=sha256=abc123  |
  | Body: { object: "whatsapp_business_account", entry: [...] }
  |--------------------------------------->|
  |                                    | 1. Calcula HMAC-SHA256 del body con META_APP_SECRET
  |                                    | 2. Compara con X-Hub-Signature-256
  |                                    | 3. Si NO coincide -> 401 (rechaza)
  |                                    | 4. Si coincide -> procesa el mensaje
  |  200 OK                            |
  |<---------------------------------------|
```

---

## 3. Generar claves seguras

Despues de los cambios de seguridad, hay 6 claves que van en el `.env`. Algunas las copias de Meta, otras las generas vos.

### Cuales se copian de Meta (NO las generas vos)

Estas 2 claves ya existen en tu cuenta de Facebook Developers. Solo hay que copiarlas:

| Variable | De donde copiarla |
|----------|-------------------|
| `META_APP_SECRET` | Facebook Developers > tu app > Configuracion > Basica > Clave secreta de la app (ver seccion 2.1) |
| `WHATSAPP_TOKEN` | Facebook Developers > tu app > WhatsApp > Configuracion de la API > Token (ver seccion 2.2) |

### Cuales generas vos

Estas 4 claves son como "passwords largas" que vos inventas. Para que sean seguras (imposibles de adivinar), se generan con un comando que crea texto aleatorio.

**Paso 1:** Abrir una terminal con Node instalado.

**Paso 2:** Ejecutar este comando UNA vez por cada clave que necesites:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Paso 3:** El comando imprime algo como esto (64 caracteres aleatorios):

```
a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1
```

**Paso 4:** Copiar ese texto y pegarlo como valor de la variable en el `.env`.

**Paso 5:** Repetir (ejecutar el comando de nuevo) para cada clave. Cada una debe tener un valor DIFERENTE.

### Ejemplo concreto

Ejecutas el comando 4 veces y te da 4 valores diferentes:

```
Primera ejecucion  ->  a3f8b2c1d4e5f6...  (copiar para VERIFY_TOKEN)
Segunda ejecucion  ->  7b2e9f4a1c8d3e...  (copiar para API_KEY)
Tercera ejecucion  ->  f1a2b3c4d5e6f7...  (copiar para ASESOR_API_KEY)
Cuarta ejecucion   ->  9e8d7c6b5a4f3e...  (copiar para REDIS_PASSWORD)
```

Y el `.env` queda asi:

```
VERIFY_TOKEN=a3f8b2c1d4e5f6...
API_KEY=7b2e9f4a1c8d3e...
ASESOR_API_KEY=f1a2b3c4d5e6f7...
REDIS_PASSWORD=9e8d7c6b5a4f3e...
```

### Que es cada clave y a quien se la das

| Variable | Que es | A quien se la das |
|----------|--------|-------------------|
| `VERIFY_TOKEN` | Una password que vos elegis. Meta te la pide cuando configuras el webhook. El dispatcher la compara para verificar que es Meta. | La pegas en Meta al configurar el webhook (seccion 2.4), y la misma en el `.env` |
| `API_KEY` | La password que las apps necesitan para llamar al dispatcher (enviar mensajes, transferir, etc). | Se la das a cada app que llama al dispatcher: el bot, el asesor, etc. Ellos la mandan como header `X-API-Key` |
| `ASESOR_API_KEY` | La password que el dispatcher manda al software de asesores cuando le hace forward de un mensaje. | Se la das al equipo del software de asesores para que la configuren en su lado |
| `REDIS_PASSWORD` | La password de Redis. Solo la usa el dispatcher internamente. | A nadie. Solo va en el `.env` del servidor |

---

## 4. Configurar el archivo .env de produccion

Crear el archivo `.env.production` (o `.env` en el servidor) con estos valores:

```bash
# ========== SERVIDOR ==========
NODE_ENV=production
PORT=8080
HOST=0.0.0.0

# ========== WHATSAPP ==========
# Obtener de Meta (ver seccion 2.2)
WHATSAPP_TOKEN=EAAxxxxx_tu_token_permanente_aqui

# Obtener de Meta (ver seccion 2.3)
PHONE_NUMBER_ID=123456789012345

# Generar con crypto (ver seccion 3)
# Este mismo valor se configura en Meta al verificar el webhook
VERIFY_TOKEN=pegar_valor_generado_aqui

# ========== SEGURIDAD META ==========
# Obtener de Meta (ver seccion 2.1)
META_APP_SECRET=pegar_app_secret_de_facebook_aqui

# ========== SEGURIDAD API ==========
# Generar con crypto (ver seccion 3)
# Compartir con las apps que llaman al dispatcher (bot, asesor, etc.)
API_KEY=pegar_valor_generado_aqui

# ========== APLICACIONES ==========
# Formato: KEY=nombre|url|prioridad
BOT_APP=BOT|http://bot-service:4800/webhook|1
ASESOR_APP=SOFTWARE_ASESORES|http://asesor-service:3001/api/external|2

# ========== ASESOR ==========
ASESOR_CHANNEL_ID=1
# Generar con crypto (ver seccion 3)
ASESOR_API_KEY=pegar_valor_generado_aqui

# ========== REDIS ==========
REDIS_HOST=redis
REDIS_PORT=6379
# Generar con crypto (ver seccion 3)
REDIS_PASSWORD=pegar_valor_generado_aqui
REDIS_DB=0
REDIS_TIMEOUT_MS=2000

# ========== RATE LIMITING ==========
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# ========== LOGS ==========
LOG_LEVEL=info
LOG_FILE=logs/dispatcher.log

# ========== TIMEOUTS ==========
APP_TIMEOUT_MS=10000
WHATSAPP_TIMEOUT_MS=5000

# ========== CIRCUIT BREAKER ==========
CIRCUIT_BREAKER_TIMEOUT_MS=10000
CIRCUIT_BREAKER_ERROR_THRESHOLD=50
CIRCUIT_BREAKER_RESET_TIMEOUT_MS=30000
```

### Permisos del archivo .env

El archivo `.env` contiene secretos. Asegurarse de que solo el usuario que corre el servicio pueda leerlo:

```bash
chmod 600 .env.production
```

### Verificar que .env no esta en git

El `.gitignore` ya incluye `.env` y `.env.*` (excepto `.env.example`). Verificar con:

```bash
git status
# No deberia aparecer ningun archivo .env (excepto .env.example)
```

---

## 5. Configurar Redis para produccion

### 5.1 Agregar Redis al docker-compose.prod.yml

Despues de los cambios de seguridad, el `docker-compose.prod.yml` deberia incluir Redis:

```yaml
version: '3.8'

services:
  dispatcher:
    image: dispatcher:latest
    build:
      context: .
      target: runtime
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production
    volumes:
      - ./logs:/app/logs
    depends_on:
      redis:
        condition: service_healthy
    restart: always

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD} --appendonly yes
    ports:
      - "127.0.0.1:6379:6379"  # Solo accesible desde localhost
    volumes:
      - redis_data:/data
    restart: always
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

volumes:
  redis_data:
```

Notas:
- El puerto de Redis se expone solo en `127.0.0.1` para que no sea accesible desde internet
- `--appendonly yes` activa persistencia en disco (los datos sobreviven reinicios)
- `depends_on` con `condition: service_healthy` asegura que Redis este listo antes de iniciar el dispatcher

---

## 6. Configurar el reverse proxy (HTTPS)

Meta requiere HTTPS para webhooks. El dispatcher corre en HTTP (puerto 8080), asi que necesitas un reverse proxy adelante que maneje TLS.

### Opcion A: Nginx con Let's Encrypt (en el servidor)

Ejemplo de configuracion de Nginx:

```nginx
server {
    listen 80;
    server_name tu-dominio.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name tu-dominio.com;

    ssl_certificate /etc/letsencrypt/live/tu-dominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tu-dominio.com/privkey.pem;

    # Headers de seguridad
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;

    # Limitar tamanio del body (defensa adicional)
    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_connect_timeout 10s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }
}
```

Para obtener el certificado SSL con Let's Encrypt:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d tu-dominio.com
```

### Opcion B: Cloudflare (mas simple)

1. Agregar tu dominio a Cloudflare
2. Cambiar los nameservers de tu dominio a los de Cloudflare
3. En Cloudflare, crear un registro A apuntando a la IP de tu servidor
4. En SSL/TLS, seleccionar modo **Full (strict)**
5. Cloudflare maneja HTTPS automaticamente

Ventaja: tambien te da proteccion DDoS y firewall gratis.

### Opcion C: Traefik (si ya usas Docker)

Agregar Traefik al `docker-compose.prod.yml` como reverse proxy con certificados automaticos de Let's Encrypt.

---

## 7. Verificar que todo funciona

### 7.1 Verificar el arranque

```bash
# Levantar servicios
docker-compose -f docker-compose.prod.yml up -d

# Ver logs del dispatcher
docker-compose -f docker-compose.prod.yml logs -f dispatcher

# Deberia ver:
# - "Redis conectado" (no "Almacenamiento en MEMORIA")
# - "WhatsApp configurado"
# - "X aplicacion(es) registrada(s)"
# - "DISPATCHER corriendo en 0.0.0.0:8080"
# - NO deberia ver tokens ni claves en los logs
```

### 7.2 Verificar health check

```bash
# Health basico (sin auth)
curl https://tu-dominio.com/health
# Deberia devolver: {"status":"healthy"}

# Health detallado (con auth)
curl https://tu-dominio.com/health/detail \
  -H "X-API-Key: TU_API_KEY"
```

### 7.3 Verificar que la auth funciona

```bash
# Sin API Key -> deberia dar 401
curl -X POST https://tu-dominio.com/enviar \
  -H "Content-Type: application/json" \
  -d '{"numero":"5491112345678","mensaje":"test"}'
# Respuesta esperada: {"error":{"message":"API Key requerida","statusCode":401}}

# Con API Key correcta -> deberia funcionar
curl -X POST https://tu-dominio.com/enviar \
  -H "Content-Type: application/json" \
  -H "X-API-Key: TU_API_KEY" \
  -d '{"numero":"5491112345678","mensaje":"test"}'
```

### 7.4 Verificar el webhook de Meta

1. Ir a Facebook Developers > tu app > WhatsApp > Configuracion
2. Editar el webhook con la URL `https://tu-dominio.com/webhook` y tu `VERIFY_TOKEN`
3. Si la verificacion es exitosa, el webhook queda configurado
4. Enviar un mensaje de prueba al numero de WhatsApp
5. Verificar en los logs que:
   - La firma se verifico correctamente
   - El mensaje se enruto a la app correcta

### 7.5 Verificar que los webhooks falsos se rechazan

```bash
# Webhook sin firma -> deberia dar 401
curl -X POST https://tu-dominio.com/webhook \
  -H "Content-Type: application/json" \
  -d '{"object":"whatsapp_business_account","entry":[]}'
# Respuesta esperada: 401

# Webhook con firma invalida -> deberia dar 401
curl -X POST https://tu-dominio.com/webhook \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=firma_falsa" \
  -d '{"object":"whatsapp_business_account","entry":[]}'
# Respuesta esperada: 401
```

---

## 8. Troubleshooting

### "Webhook verification failed" al configurar en Meta

- Verificar que la URL sea HTTPS y accesible desde internet
- Verificar que el `VERIFY_TOKEN` en el `.env` coincida exactamente con el que pusiste en Meta
- Verificar que el dispatcher este corriendo: `curl https://tu-dominio.com/health`
- Verificar en los logs: `docker-compose -f docker-compose.prod.yml logs dispatcher | grep -i verif`

### "401" en todos los webhooks de Meta

- Verificar que `META_APP_SECRET` en el `.env` sea el correcto
- Ir a Facebook Developers > Configuracion > Basica > copiar de nuevo el App Secret
- Reiniciar el dispatcher despues de cambiar el `.env`
- Verificar en los logs si dice "firma invalida" o "sin firma"

### "API Key requerida" al llamar desde las apps

- Las apps (bot, asesor) deben enviar el header `X-API-Key` con el valor de `API_KEY` del `.env`
- Ejemplo para el bot:
  ```
  Headers: { "X-API-Key": "tu_api_key_aqui", "Content-Type": "application/json" }
  ```
- Si la app usa `Authorization: Bearer`, tambien funciona:
  ```
  Headers: { "Authorization": "Bearer tu_api_key_aqui" }
  ```

### Redis no conecta

- Verificar que el contenedor de Redis este corriendo: `docker ps | grep redis`
- Verificar que `REDIS_HOST` sea `redis` (nombre del servicio en docker-compose) y no `localhost`
- Verificar que `REDIS_PASSWORD` coincida entre el `.env` y el `command` de Redis en docker-compose
- Probar conexion manual: `docker exec -it redis redis-cli -a TU_PASSWORD ping`

### Meta deja de enviar webhooks

Meta desactiva webhooks si recibe muchos errores consecutivos (timeouts, 5xx). Si esto pasa:

1. Verificar que el dispatcher responde rapido al webhook (debe devolver 200 en menos de 5 segundos)
2. Ir a Facebook Developers > tu app > WhatsApp > Configuracion
3. Verificar que el webhook siga suscrito a **messages**
4. Si se desactivo, volver a suscribirse

### Regenerar claves comprometidas

Si una clave se filtra, regenerarla inmediatamente:

| Clave comprometida | Que hacer |
|---------------------|-----------|
| `META_APP_SECRET` | Ir a Facebook Developers > Configuracion > Basica > Restablecer clave secreta. Actualizar `.env` y reiniciar |
| `WHATSAPP_TOKEN` | Ir a Business Settings > System Users > revocar token y generar uno nuevo. Actualizar `.env` y reiniciar |
| `VERIFY_TOKEN` | Generar nuevo valor, actualizar `.env`, reiniciar, y re-verificar webhook en Meta con el nuevo token |
| `API_KEY` | Generar nuevo valor, actualizar `.env`, reiniciar, y actualizar el valor en todas las apps que llaman al dispatcher |
| `ASESOR_API_KEY` | Generar nuevo valor, actualizar `.env` del dispatcher y del software de asesores, reiniciar ambos |
| `REDIS_PASSWORD` | Generar nuevo valor, actualizar `.env`, recrear contenedor de Redis: `docker-compose down && docker-compose up -d` |
