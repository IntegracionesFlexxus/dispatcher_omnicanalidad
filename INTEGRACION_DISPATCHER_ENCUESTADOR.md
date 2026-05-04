# Integración: Dispatcher ↔ Encuestador

## Descripción

El **Dispatcher** es el servicio central que recibe todos los webhooks de WhatsApp desde Meta y los enruta al servicio correspondiente. El **Encuestador** es uno de esos servicios, encargado de gestionar encuestas automatizadas por WhatsApp.

---

## Arquitectura

```
WhatsApp → Meta → Dispatcher (10.250.0.68:8062)
                      │
                      ├── Bot          → http://10.250.0.68:4800/webhook
                      ├── Asesor (CRM) → http://10.250.0.68:6001/api/external/conversations/create
                      └── Encuestador  → http://{IP}:{PUERTO}/api/dispatcher/incoming
```

---

## Configuración en el Dispatcher

Agregar en la configuración del Dispatcher:

```
ENCUESTADOR_APP=ENCUESTADOR|http://{IP}:{PUERTO}/api/dispatcher/incoming|{PRIORIDAD}
ENCUESTADOR_STATUS_URL=http://{IP}:{PUERTO}/api/dispatcher/status
ENCUESTADOR_STATUS_TIMEOUT_MS=3000
ENCUESTADOR_API_KEY=                    # opcional, ver sección "Autenticación"
ENCUESTADOR_ROUTING_TTL_SECONDS=600     # opcional, default 600 (10 min)
```

Ejemplo real:
```
ENCUESTADOR_APP=ENCUESTADOR|http://10.250.0.68:5060/api/dispatcher/incoming|3
ENCUESTADOR_STATUS_URL=http://10.250.0.68:5060/api/dispatcher/status
```

---

## Mecanismos de routing (Opción A + B)

El Dispatcher detecta que un número está en encuesta combinando dos mecanismos:

- **Opción A — Routing explícito (rápido):** El Encuestador llama `POST /encuesta/iniciar/:numero` al Dispatcher cuando arranca una encuesta. El Dispatcher graba en Redis `routing:numero → encuestador` con TTL. Cero latencia en webhooks subsiguientes — el routing se decide leyendo Redis.
- **Opción B — Status endpoint (red de seguridad):** Si Redis no tiene el routing (TTL expirado, restart, primer mensaje), el Dispatcher consulta `GET /api/dispatcher/status/:phone` al Encuestador antes de derivar a bot/asesor.

**Renovación automática del TTL:** cada mensaje del usuario que se reenvía al Encuestador renueva el TTL del routing en Redis a `ENCUESTADOR_ROUTING_TTL_SECONDS` (default 10 min). Mientras el usuario interactúe, el routing se mantiene fresco.

**Coexistencia con Asesor:** si el número estaba en `routing:asesor` cuando llega un mensaje y el status devuelve `has_active_survey: true`, el Dispatcher reenvía ese mensaje al Encuestador **sin sobrescribir el routing del asesor**. Cuando la encuesta termina, los mensajes vuelven solos al asesor.

---

## Endpoints del Dispatcher (que el Encuestador debe llamar)

> Todos requieren header `X-API-Key: <API_KEY del Dispatcher>`.

### `POST /encuesta/iniciar/:numero`

Marca el routing del número hacia `encuestador` en Redis. Llamarlo justo antes/después de mandar el template `abrir_encuesta`.

**No** dispara callback al Encuestador — es solo registro de routing.

#### Request
```http
POST /encuesta/iniciar/5493515524761
Headers:
  X-API-Key: <API_KEY>
  Content-Type: application/json
Body:
{
  "survey_instance_id": 123,        // opcional
  "phase": "AWAITING_OPTIN",        // opcional
  "ttl_seconds": 600                // opcional, default ENCUESTADOR_ROUTING_TTL_SECONDS
}
```

#### Response 200
```json
{
  "ok": true,
  "app_anterior": "bot",
  "app_actual": "encuestador",
  "ttl_seconds": 600,
  "survey_instance_id": 123,
  "phase": "AWAITING_OPTIN"
}
```

#### Response 503 (encuestador no registrado)
```json
{
  "ok": false,
  "error": "La app \"encuestador\" no está registrada en el dispatcher",
  "app_actual": "bot"
}
```

---

### `POST /encuesta/finalizar/:numero`

Limpia el routing en Redis. Llamarlo cuando la encuesta termina (completada / cancelada / timeout / rechazada). Los siguientes mensajes del usuario vuelven al routing por defecto (`bot`).

#### Request
```http
POST /encuesta/finalizar/5493515524761
Headers:
  X-API-Key: <API_KEY>
  Content-Type: application/json
Body:
{
  "motivo": "completada",           // opcional: completada|cancelada|timeout|rechazada
  "survey_instance_id": 123,        // opcional
  "mensaje_despedida": false        // opcional, default false
}
```

#### Response 200
```json
{
  "ok": true,
  "app_anterior": "encuestador",
  "app_actual": "bot",
  "motivo": "completada",
  "survey_instance_id": 123
}
```

#### Response 404 (el número no estaba en encuestador)
```json
{
  "ok": false,
  "error": "El número no tiene encuesta activa en el dispatcher",
  "app_actual": "bot"
}
```

---

## Endpoints del Encuestador (que el Dispatcher consume)

### 1. Recibir mensaje — `POST /api/dispatcher/incoming`

El Dispatcher llama a este endpoint cuando un mensaje entrante de WhatsApp corresponde a una encuesta activa.

**URL:** `http://{IP}:{PUERTO}/api/dispatcher/incoming`  
**Método:** `POST`  
**Content-Type:** `application/json`  
**Headers que envía el Dispatcher:**
- `X-Dispatcher: true`
- `X-Dispatcher-Version: 1.0.0`
- `Content-Type: application/json`

#### Request Body (formato real que envía el Dispatcher)

```json
{
  "customer_phone": "5493515524761",
  "customer_name": "Lucas Manavella",
  "message": "Si",
  "message_type": "button",
  "media_id": null,
  "mime_type": null,
  "filename": null,
  "raw_webhook": { "...": "webhook original de Meta" }
}
```

#### Campos

| Campo | Tipo | Origen | Descripción |
|---|---|---|---|
| `customer_phone` | string | `messages[0].from` | Teléfono del cliente con código de país |
| `customer_name` | string | `contacts[0].profile.name` | Nombre del contacto, fallback `"Cliente"` |
| `message` | string\|null | `caption` o `text` o `button.text` | Texto del mensaje o del botón. `null` si es media sin caption |
| `message_type` | string | `messages[0].type` | `text`, `button`, `interactive`, `image`, `document`, `video`, `audio` |
| `media_id` | string\|null | Meta Media ID | Solo para media (descargable vía `GET /media/:mediaId` del dispatcher) |
| `mime_type` | string\|null | mime del archivo | Solo para media |
| `filename` | string\|null | nombre original | Solo para media tipo `document` |
| `raw_webhook` | object | webhook completo | Para debug / casos no contemplados |

#### Response — Éxito (200)

```json
{
  "ok": true,
  "message": "Mensaje recibido y procesado"
}
```

#### Response — Error de validación (400)

```json
{
  "ok": false,
  "error": "Campos requeridos: customer_phone, message"
}
```

#### Response — Error interno (500)

```json
{
  "ok": false,
  "error": "Error interno al procesar el mensaje"
}
```

---

### 2. Consultar estado — `GET /api/dispatcher/status/:phone`

Permite al Dispatcher consultar si un teléfono tiene una encuesta activa. **Es la red de seguridad cuando Redis no tiene routing (Opción B).**

**URL:** `http://{IP}:{PUERTO}/api/dispatcher/status/{phone}`  
**Método:** `GET`  
**Headers que envía el Dispatcher:**
- `X-Dispatcher: true`
- `X-API-Key: <ENCUESTADOR_API_KEY>` (solo si está seteada en el `.env` del dispatcher)

**Timeout:** El dispatcher espera máximo `ENCUESTADOR_STATUS_TIMEOUT_MS` ms (default 3000). Si el endpoint no responde a tiempo, el dispatcher asume `has_active_survey: false` y enruta normalmente.

#### Ejemplo

```
GET /api/dispatcher/status/5493515524761
```

#### Response — Con encuesta activa

```json
{
  "ok": true,
  "has_active_survey": true,
  "phase": "AWAITING_SCORE",
  "survey_instance_id": 15
}
```

#### Response — Sin encuesta activa

```json
{
  "ok": true,
  "has_active_survey": false,
  "phase": null,
  "survey_instance_id": null
}
```

#### Posibles valores de `phase`

| Phase | Descripción |
|---|---|
| `AWAITING_OPTIN` | Esperando que el usuario acepte responder (SI/NO) |
| `AWAITING_SCORE` | Esperando puntaje (1-10) |
| `AWAITING_FOLLOWUP` | Esperando respuesta de seguimiento (texto libre) |
| `COMPLETED` | Encuesta completada |
| `CANCELLED` | Encuesta cancelada por el usuario o por intentos inválidos |

---

### 3. Health check — `GET /api/dispatcher/health`

Verifica que el servicio Encuestador está activo.

**URL:** `http://{IP}:{PUERTO}/api/dispatcher/health`  
**Método:** `GET`

#### Response

```json
{
  "ok": true,
  "service": "encuestador",
  "version": "1.0.0",
  "timestamp": "2026-04-28T13:00:00.000Z"
}
```

---

## Flujo de decisión del Dispatcher (algoritmo real)

```
Webhook entrante de WhatsApp (mensaje del cliente)
    │
    ├── 1. Leer routing en Redis: routing:{phone}
    │
    ├── 2a. Si routing = "encuestador":
    │       → Renovar TTL en Redis (ENCUESTADOR_ROUTING_TTL_SECONDS)
    │       → Reenviar a POST /api/dispatcher/incoming  ✅
    │
    ├── 2b. Si routing = "bot" o "asesor":
    │       → Llamar GET /api/dispatcher/status/{phone}  (Opción B, fallback)
    │       │
    │       ├── has_active_survey = true:
    │       │   ├── Si venía de "bot": persistir routing="encuestador" con TTL
    │       │   ├── Si venía de "asesor": NO sobrescribir (preservar)
    │       │   └── Reenviar a POST /api/dispatcher/incoming  ✅
    │       │
    │       └── has_active_survey = false:
    │           → Enrutar al servicio original (bot/asesor)
    │
    └── 3. Si Redis tenía routing="encuestador" porque el Encuestador llamó
           POST /encuesta/iniciar/:numero (Opción A) → camino 2a, sin
           consultar el status endpoint (cero latencia).
```

---

## Flujo completo de una encuesta (con A+B integrado)

```
1. Scheduler del Encuestador decide arrancar una encuesta para 5493515524761:
   a) (Opción A) Encuestador llama:
      POST http://dispatcher:8082/encuesta/iniciar/5493515524761
      Body: { "survey_instance_id": 123, "phase": "AWAITING_OPTIN" }
      → Dispatcher graba routing:5493515524761 → encuestador (TTL 600s) en Redis
   b) Encuestador envía template "abrir_encuesta" (vía API de Meta directamente
      o vía POST /enviar-template del dispatcher)
   → El cliente recibe los botones [SI] [NO]

2. Cliente presiona [SI]
   → Meta envía webhook al Dispatcher
   → Dispatcher lee Redis: routing="encuestador" → camino 2a (sin consultar status)
   → Renueva TTL a 600s
   → POST http://encuestador:5060/api/dispatcher/incoming
      Body: { customer_phone, customer_name, message:"Si", message_type:"button", ... }

3. Encuestador procesa el "Si" y envía la primera pregunta directamente vía API
   de Meta (o vía POST /enviar del dispatcher).

4. Cliente responde "8"
   → Webhook → Dispatcher → routing="encuestador" en Redis → renueva TTL → /incoming

5. Encuesta completada. Encuestador llama:
   POST http://dispatcher:8082/encuesta/finalizar/5493515524761
   Body: { "motivo": "completada", "survey_instance_id": 123 }
   → Dispatcher limpia routing en Redis. El número vuelve al bot por defecto.

6. Si el cliente responde DESPUÉS de finalizada:
   → Webhook → Redis no tiene routing → Dispatcher consulta GET /status/{phone}
     (Opción B). Encuestador responde has_active_survey:false
   → Dispatcher enruta al bot normal.
```

### Por qué A + B en lugar de solo A o solo B

- **Solo A:** si Redis se cae, expira el TTL antes de tiempo, o el dispatcher se reinicia sin persistencia, los mensajes del usuario caen al bot por error.
- **Solo B:** cada webhook agrega ~50-200ms de latencia HTTP esperando al status endpoint, y si el encuestador está caído el dispatcher usa fallback (timeout 3s) en cada mensaje.
- **A + B:** ruta feliz cero latencia (Redis hit). Si Redis falla, B salva el caso. Si el encuestador está caído, las encuestas en curso siguen funcionando vía A.

---

## Flujo cuando el cliente dice NO

```
1. Cliente presiona [NO]
   → Encuestador responde: "Entendido, no hay problema. Te volveremos a contactar más adelante."
   → La encuesta se reprograma para 7 días después
   → Máximo 3 reintentos. Al 4to NO, se cancela definitivamente.
```

---

## Autenticación

### Dispatcher → Encuestador
El Dispatcher manda en cada llamada al Encuestador:
- Header `X-Dispatcher: true` (siempre)
- Header `X-API-Key: <ENCUESTADOR_API_KEY>` (solo si la env var está seteada en el dispatcher)

Si el Encuestador protege sus endpoints con API key, basta con setear `ENCUESTADOR_API_KEY` en el `.env` del Dispatcher.

### Encuestador → Dispatcher
El Encuestador debe mandar header `X-API-Key: <API_KEY>` (o `Authorization: Bearer <API_KEY>`) en todas las llamadas a:
- `POST /encuesta/iniciar/:numero`
- `POST /encuesta/finalizar/:numero`
- `POST /enviar-template`, `POST /enviar`, `POST /enviar-media`, `POST /transferir` (si los usa)

El valor es el `API_KEY` del Dispatcher, configurado en su `.env`.

---

## Notas importantes

- **El Encuestador puede enviar mensajes** directo a la API de Meta o usar los endpoints del Dispatcher (`POST /enviar-template`, `POST /enviar`, `POST /enviar-media`). Este último camino centraliza el envío y permite que el Dispatcher gestione la ventana de 24hs y re-engagement automático.
- **Sí o sí debe llamar `POST /encuesta/iniciar/:numero`** al arrancar una encuesta, para que las respuestas del usuario se enruten correctamente. Sin esa llamada, el dispatcher depende solo de la Opción B (status endpoint) que es más lenta y menos resiliente.
- **Sí o sí debe llamar `POST /encuesta/finalizar/:numero`** al terminar (o abandonar) la encuesta, para que el usuario vuelva al bot/asesor.
- **Puerto del Encuestador:** Configurado en `.env` como `PORT` (default: `5060`).
- **El Encuestador necesita acceso** a la API de WhatsApp Business (token y phone number ID) si decide enviar mensajes directo a Meta sin pasar por el Dispatcher.

---

## Diagnóstico — qué buscar en los logs del Dispatcher

| Log | Significado |
|---|---|
| `🔧 Aplicaciones registradas: 3 ... ENCUESTADOR (encuestador) → ...` | App correctamente cargada al arranque ✅ |
| `⚠️ ENCUESTADOR_APP está configurado pero falta ENCUESTADOR_STATUS_URL` | Falta config — Opción B no funciona |
| `📊 [encuestador] Consultando status: ...` | Opción B activada (Redis no tenía routing) |
| `Encuestador Status - Respuesta { has_active_survey: true }` | Status endpoint detectó encuesta activa ✅ |
| `Encuestador Status - Error` | Status endpoint inalcanzable o timeout |
| `Encuesta Iniciada` (con TTL y survey_instance_id) | `POST /encuesta/iniciar` exitoso ✅ |
| `Encuesta Finalizada` (con motivo) | `POST /encuesta/finalizar` exitoso ✅ |
| `📊 [enrutarMensaje] Número X ya asignado a encuestador, renovando TTL` | Camino feliz Opción A — routing en Redis hit ✅ |
| `Encuesta NO activa - Continuando routing normal` | Status devolvió `false`, mensaje va a bot/asesor |
