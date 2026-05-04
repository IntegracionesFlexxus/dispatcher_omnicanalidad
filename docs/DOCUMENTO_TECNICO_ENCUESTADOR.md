# Documento Tecnico: Integracion Dispatcher - Encuestador

## 1. Resumen

El **Encuestador** es un bot independiente que gestiona encuestas automatizadas por WhatsApp. Se integra con el **Dispatcher** como un tercer servicio de enrutamiento, junto a BOT y ASESOR, pero opera de forma independiente a ambos.

**Diferencia clave con BOT y ASESOR:** El Encuestador siempre inicia la conversacion (envia la plantilla primero). El cliente nunca escribe al Encuestador de forma espontanea.

---

## 2. Arquitectura

```
                                   Encuestador (bot de encuestas)
                                        │
                          ┌─────────────┤
                          │             │
                   (1) Envia plantilla  (4) Recibe respuestas
                   via /enviar-template  via POST /incoming
                          │             │
                          ▼             │
WhatsApp ◄──── Meta ◄──── DISPATCHER ──┘
    │                        │
    │                        ├── Bot (default)
    │                        └── Asesor (CRM)
    │
    └──── (2) Cliente responde ────► Meta ────► DISPATCHER
                                                    │
                                          (3) Consulta GET /status/{phone}
                                          al Encuestador para saber si
                                          tiene encuesta activa
```

---

## 3. Flujo Completo

### 3.1 Flujo Normal (cliente responde SI)

```
Paso 1: El Scheduler del Encuestador detecta que debe enviar encuesta
        → Encuestador llama POST /enviar-template al Dispatcher
        → Dispatcher envia plantilla "abrir_encuesta" al cliente via WhatsApp
        → En Redis: NO se marca nada. El cliente sigue asignado al BOT.

Paso 2: El cliente responde "SI"
        → WhatsApp envia webhook al Dispatcher
        → Dispatcher consulta GET /api/dispatcher/status/{phone} al Encuestador
        → Encuestador responde: { has_active_survey: true, phase: "AWAITING_OPTIN" }
        → Dispatcher MARCA en Redis: routing:{numero} = 'encuestador'
        → Dispatcher transforma payload y reenvia a POST /api/dispatcher/incoming
        → Encuestador recibe el "SI" y procesa

Paso 3: Encuestador envia siguiente pregunta
        → Encuestador llama POST /enviar al Dispatcher
        → Dispatcher envia mensaje al cliente via WhatsApp

Paso 4: Cliente responde con puntaje/texto
        → WhatsApp → Dispatcher
        → Redis ya tiene routing = 'encuestador'
        → Dispatcher transforma y reenvia al Encuestador
        → Repite hasta completar

Paso 5: Encuesta completada
        → Encuestador llama POST /encuesta/finalizar/{numero} al Dispatcher
        → Dispatcher limpia Redis (routing vuelve a 'bot')
        → Cliente vuelve al flujo normal del BOT
```

### 3.2 Flujo cuando el cliente NO responde

```
Paso 1: Encuestador envia plantilla via Dispatcher
Paso 2: Cliente no responde
        → Redis NUNCA se marca como 'encuestador'
        → Si el cliente escribe despues, va al BOT normalmente
        → El Encuestador maneja el timeout internamente (reprogramar, cancelar, etc.)
```

### 3.3 Flujo cuando el cliente responde "NO"

```
Paso 1: Encuestador envia plantilla via Dispatcher
Paso 2: Cliente responde "NO"
        → Dispatcher consulta GET /status → has_active_survey: true
        → Marca Redis y reenvia al Encuestador
        → Encuestador procesa el "NO" y responde "Entendido..."
        → Encuestador llama POST /encuesta/finalizar/{numero}
        → Cliente vuelve al BOT
```

### 3.4 Timeout (10 minutos sin respuesta durante encuesta activa)

```
Si el cliente fue marcado como 'encuestador' en Redis pero no responde:
        → El Encuestador detecta timeout internamente
        → Encuestador llama POST /encuesta/finalizar/{numero}
        → Dispatcher limpia Redis
        → Cliente vuelve al BOT
```

---

## 4. Configuracion del Dispatcher

### 4.1 Variables de entorno

Agregar en `.env`:

```bash
# ========== ENCUESTADOR ==========
ENCUESTADOR_APP=ENCUESTADOR|http://{IP}:{PUERTO}/api/dispatcher/incoming|3
ENCUESTADOR_STATUS_URL=http://{IP}:{PUERTO}/api/dispatcher/status
ENCUESTADOR_API_KEY=clave-api-encuestador
```

| Variable | Descripcion | Ejemplo |
|---|---|---|
| `ENCUESTADOR_APP` | Configuracion de app (nombre\|url\|prioridad) | `ENCUESTADOR\|http://10.250.0.68:5060/api/dispatcher/incoming\|3` |
| `ENCUESTADOR_STATUS_URL` | URL base para consultar estado de encuesta | `http://10.250.0.68:5060/api/dispatcher/status` |
| `ENCUESTADOR_API_KEY` | API key para autenticar requests al Encuestador | (a definir) |

### 4.2 Ejemplo de configuracion de produccion

```bash
ENCUESTADOR_APP=ENCUESTADOR|http://10.250.0.68:5060/api/dispatcher/incoming|3
ENCUESTADOR_STATUS_URL=http://10.250.0.68:5060/api/dispatcher/status
ENCUESTADOR_API_KEY=produccion-key-encuestador
```

---

## 5. Endpoints que usa el Encuestador (ya existentes)

El Encuestador consume estos endpoints del Dispatcher con su propia API key (`X-API-Key` header):

### 5.1 Enviar plantilla - `POST /enviar-template`

Para iniciar la encuesta enviando la plantilla al cliente.

**Request:**
```json
{
  "numero": "5493515524761",
  "template_name": "abrir_encuesta",
  "language_code": "es_AR",
  "components": [
    {
      "type": "body",
      "parameters": [
        { "type": "text", "text": "Lucas" }
      ]
    }
  ]
}
```

**Headers:**
```
Content-Type: application/json
X-API-Key: {ENCUESTADOR_API_KEY_DEL_DISPATCHER}
```

**Response (200):**
```json
{
  "ok": true,
  "mensaje": "Template enviado correctamente"
}
```

> **Nota sobre ventana de 24hs:** Las plantillas (templates) aprobadas por Meta se pueden enviar en cualquier momento, no requieren ventana de 24hs abierta. La ventana se abre cuando el cliente responde.

### 5.2 Enviar mensaje - `POST /enviar`

Para enviar las preguntas de seguimiento durante la encuesta.

**Request (texto simple):**
```json
{
  "numero": "5493515524761",
  "mensaje": "Del 1 al 10, como calificaria la atencion recibida?"
}
```

**Request (con botones):**
```json
{
  "numero": "5493515524761",
  "body_text": "Muchas gracias! Desea agregar algun comentario?",
  "buttons": [
    { "type": "reply", "reply": { "id": "btn_si", "title": "Si" } },
    { "type": "reply", "reply": { "id": "btn_no", "title": "No, gracias" } }
  ]
}
```

**Headers:**
```
Content-Type: application/json
X-API-Key: {ENCUESTADOR_API_KEY_DEL_DISPATCHER}
```

**Response (200):**
```json
{
  "ok": true,
  "tipo": "texto",
  "mensaje": "Mensaje enviado correctamente"
}
```

**Response cuando la ventana de 24hs esta cerrada:**
```json
{
  "ok": true,
  "tipo": "template_reengagement",
  "mensaje": "Ventana de 24hs cerrada. Se envio template de re-engagement.",
  "ventana_reabierta": false,
  "mensaje_pendiente": true
}
```

> **Importante:** Si la ventana de 24hs se cerro (el cliente no escribio en las ultimas 24hs), no se puede enviar mensajes libres. Solo plantillas. El Encuestador debe usar `/enviar-template` en ese caso.

### 5.3 Enviar plantilla - `POST /enviar-template`

Tambien disponible para reenviar plantillas durante la encuesta si la ventana esta cerrada.

---

## 6. Endpoint NUEVO del Dispatcher para el Encuestador

### 6.1 Finalizar encuesta - `POST /encuesta/finalizar/:numero`

El Encuestador llama a este endpoint cuando la encuesta termina (completada, cancelada, o timeout).

**URL:** `POST /encuesta/finalizar/{numero}`

**Headers:**
```
Content-Type: application/json
X-API-Key: {API_KEY}
```

**Request Body:**
```json
{
  "motivo": "completada",
  "survey_instance_id": 15,
  "mensaje_despedida": true
}
```

| Campo | Tipo | Requerido | Descripcion |
|---|---|---|---|
| `motivo` | string | No | Razon de finalizacion: `completada`, `cancelada`, `timeout`, `rechazada` |
| `survey_instance_id` | number | No | ID de la instancia de encuesta (para trazabilidad) |
| `mensaje_despedida` | boolean | No | Si el dispatcher debe enviar mensaje de despedida al cliente. Default: `false` |

**Response (200):**
```json
{
  "ok": true,
  "app_anterior": "encuestador",
  "app_actual": "bot",
  "motivo": "completada"
}
```

**Response (404) - No habia encuesta activa:**
```json
{
  "ok": false,
  "error": "El numero no tiene encuesta activa en el dispatcher"
}
```

---

## 7. Endpoints que el Encuestador debe implementar

### 7.1 Recibir mensaje - `POST /api/dispatcher/incoming`

El Dispatcher llama a este endpoint cuando un mensaje del cliente corresponde a una encuesta activa.

**Request Body que envia el Dispatcher:**
```json
{
  "customer_phone": "5493515524761",
  "customer_name": "Lucas Manavella",
  "message": "SI",
  "message_type": "text",
  "raw_webhook": { }
}
```

| Campo | Tipo | Siempre presente | Descripcion |
|---|---|---|---|
| `customer_phone` | string | Si | Telefono del cliente con codigo de pais |
| `customer_name` | string | Si | Nombre del contacto (de WhatsApp) |
| `message` | string | Si | Texto del mensaje o texto del boton presionado |
| `message_type` | string | Si | `text`, `button`, `image`, `video`, `document` |
| `media_id` | string | No | ID de media de Meta (si el mensaje tiene archivo adjunto) |
| `mime_type` | string | No | Tipo MIME del archivo adjunto |
| `filename` | string | No | Nombre del archivo adjunto |
| `raw_webhook` | object | Si | Webhook original completo de Meta (para debug) |

**Response esperada (200):**
```json
{
  "ok": true,
  "message": "Mensaje recibido y procesado"
}
```

### 7.2 Consultar estado - `GET /api/dispatcher/status/:phone`

El Dispatcher consulta este endpoint para saber si un numero tiene encuesta activa. **Se consulta ANTES de hacer el routing normal.**

**Response con encuesta activa:**
```json
{
  "ok": true,
  "has_active_survey": true,
  "phase": "AWAITING_SCORE",
  "survey_instance_id": 15
}
```

**Response sin encuesta activa:**
```json
{
  "ok": true,
  "has_active_survey": false,
  "phase": null,
  "survey_instance_id": null
}
```

**Fases posibles:**

| Phase | Descripcion |
|---|---|
| `AWAITING_OPTIN` | Esperando que el usuario acepte (SI/NO) |
| `AWAITING_SCORE` | Esperando puntaje (1-10) |
| `AWAITING_FOLLOWUP` | Esperando respuesta de seguimiento |
| `COMPLETED` | Encuesta completada |
| `CANCELLED` | Encuesta cancelada |

### 7.3 Health check - `GET /api/dispatcher/health`

```json
{
  "ok": true,
  "service": "encuestador",
  "version": "1.0.0",
  "timestamp": "2026-04-28T13:00:00.000Z"
}
```

---

## 8. Logica de Enrutamiento Modificada en el Dispatcher

### 8.1 Orden de decision

```
Mensaje entrante de WhatsApp (POST /webhook)
    │
    ▼
(1) ¿El numero ya esta asignado a 'encuestador' en Redis?
    ├── SI → Transformar payload → Enviar a Encuestador (POST /incoming)
    │
    └── NO → (2) ¿El Encuestador tiene encuesta activa para este numero?
                  Consultar GET /api/dispatcher/status/{phone}
                  │
                  ├── has_active_survey = true
                  │   → Marcar Redis: routing = 'encuestador' (TTL: 600s = 10 min)
                  │   → Transformar payload → Enviar a Encuestador
                  │
                  └── has_active_survey = false (o error/timeout en consulta)
                      → (3) Seguir flujo normal existente:
                           ├── ¿Bot desactivado? → Asesor
                           ├── ¿Routing = asesor? → Asesor
                           └── Default → Bot
```

### 8.2 Detalle del TTL de 10 minutos

Cuando se marca `routing:{numero} = 'encuestador'` en Redis, se usa un TTL de **600 segundos (10 minutos)**. Esto significa:

- Cada vez que el cliente responde un mensaje de la encuesta, el TTL se renueva a 10 minutos
- Si el cliente no responde en 10 minutos, Redis expira automaticamente el routing y el cliente vuelve al bot
- El Encuestador tambien debe llamar a `POST /encuesta/finalizar/{numero}` para limpiar explicitamente (no depender solo del TTL)

### 8.3 Optimizacion: evitar consulta innecesaria al Encuestador

La consulta `GET /status` al Encuestador solo se hace cuando:
- El numero NO esta asignado a ninguna app en Redis (routing = 'bot' por defecto)
- El Encuestador esta configurado y disponible

**NO se consulta cuando:**
- El numero ya esta asignado a 'encuestador' (ya lo sabemos)
- El numero esta asignado a 'asesor' (el asesor tiene prioridad sobre nueva encuesta)
- El bot esta desactivado para ese numero (hay conversacion con asesor en curso)
- El servicio del Encuestador no esta configurado

---

## 9. Estado en Redis

### 9.1 Keys nuevas

| Key | Valor | TTL | Descripcion |
|---|---|---|---|
| `routing:{numero}` | `'encuestador'` | 600s (10 min) | Routing activo al encuestador. Se renueva con cada mensaje. |

### 9.2 Keys existentes que se reutilizan

| Key | Uso | Descripcion |
|---|---|---|
| `routing:{numero}` | Mismo key que bot/asesor | El valor cambia a 'encuestador' |
| `ultimo_mensaje:{numero}` | Ventana 24hs | Se actualiza cuando el cliente responde |

### 9.3 Limpieza al finalizar encuesta

Cuando se llama `POST /encuesta/finalizar/{numero}`:
1. Se elimina `routing:{numero}` (vuelve a 'bot' por defecto)
2. NO se toca `bot:desactivado:{numero}` (no aplica al encuestador)
3. NO se toca `conversation:{numero}` (es del asesor)

---

## 10. Manejo de Errores y Casos Borde

### 10.1 Encuestador no disponible

Si el servicio del Encuestador no responde al `GET /status`:
- **Timeout: 3 segundos** (no bloquear el flujo principal)
- Se asume `has_active_survey: false`
- El mensaje sigue al flujo normal (bot/asesor)
- Se loguea el error para monitoreo

### 10.2 Cliente escribe durante encuesta pero el Encuestador falla

Si el Encuestador no responde al `POST /incoming`:
- Se usa el circuit breaker existente
- El mensaje se pierde para el encuestador (no hay cola)
- Se loguea el error
- El routing en Redis sigue activo (se reintenta en el siguiente mensaje)

### 10.3 Encuestador envia plantilla pero el cliente ya esta con el Asesor

Si el cliente tiene `routing = 'asesor'` y el Encuestador envia plantilla:
- La plantilla se envia normalmente (es solo un envio de mensaje)
- Cuando el cliente responde, el routing al Asesor tiene prioridad
- La respuesta va al Asesor, NO al Encuestador
- El Encuestador deberia validar esto internamente antes de iniciar encuesta

### 10.4 Ventana de 24hs

- **Plantillas (templates):** Se pueden enviar siempre, no requieren ventana abierta
- **Mensajes libres (`/enviar`):** Requieren ventana abierta (cliente escribio en ultimas 24hs)
- Si el Encuestador intenta enviar un mensaje libre fuera de ventana, el Dispatcher responde con `tipo: 'template_reengagement'`
- **Recomendacion:** El Encuestador deberia usar `/enviar-template` para la primera interaccion y `/enviar` solo despues de que el cliente haya respondido (ventana abierta)

---

## 11. Autenticacion

El Encuestador debe enviar el header `X-API-Key` en todas las requests al Dispatcher:

```
X-API-Key: {valor de API_KEY configurado en el Dispatcher}
```

Este es el mismo mecanismo que usa el Asesor. La API key se configura en la variable `API_KEY` del Dispatcher.

---

## 12. Cambios Necesarios en el Dispatcher (resumen para desarrollo)

| Archivo | Cambio |
|---|---|
| `.env` | Agregar `ENCUESTADOR_APP`, `ENCUESTADOR_STATUS_URL`, `ENCUESTADOR_API_KEY` |
| `src/config/index.js` | Agregar seccion `encuestador` con `statusUrl` y `apiKey` |
| `src/services/router.service.js` | Modificar `enrutarMensaje()`: agregar consulta a Encuestador antes del routing normal. Agregar funcion `finalizarEncuesta()`. Agregar transformacion de payload para encuestador. |
| `src/routes/admin.routes.js` | Agregar endpoint `POST /encuesta/finalizar/:numero` |
| `src/validators/schemas.js` | Agregar schema `finalizarEncuestaSchema` |
| `.env.example` | Agregar variables del Encuestador como ejemplo |

---

## 13. Diagrama de Secuencia Completo

```
Encuestador          Dispatcher              WhatsApp            Cliente
    │                    │                      │                   │
    │ POST /enviar-template                     │                   │
    │ (abrir_encuesta)   │                      │                   │
    │───────────────────►│                      │                   │
    │                    │  Envia plantilla      │                   │
    │                    │─────────────────────►│                   │
    │                    │                      │  Muestra botones   │
    │                    │                      │──────────────────►│
    │   200 OK           │                      │                   │
    │◄───────────────────│                      │                   │
    │                    │                      │                   │
    │                    │                      │  Cliente toca "SI" │
    │                    │                      │◄──────────────────│
    │                    │  Webhook (mensaje)    │                   │
    │                    │◄─────────────────────│                   │
    │                    │                      │                   │
    │                    │ GET /status/{phone}   │                   │
    │◄───────────────────│                      │                   │
    │ {has_active: true} │                      │                   │
    │───────────────────►│                      │                   │
    │                    │                      │                   │
    │                    │ [Marca Redis:         │                   │
    │                    │  encuestador, 600s]   │                   │
    │                    │                      │                   │
    │ POST /incoming     │                      │                   │
    │◄───────────────────│                      │                   │
    │ {phone, msg:"SI"}  │                      │                   │
    │                    │                      │                   │
    │ POST /enviar       │                      │                   │
    │ (siguiente pregunta)                      │                   │
    │───────────────────►│                      │                   │
    │                    │  Envia mensaje        │                   │
    │                    │─────────────────────►│                   │
    │                    │                      │──────────────────►│
    │                    │                      │                   │
    │              ... (repite preguntas/respuestas) ...             │
    │                    │                      │                   │
    │ POST /encuesta/    │                      │                   │
    │ finalizar/{numero} │                      │                   │
    │───────────────────►│                      │                   │
    │                    │ [Limpia Redis]        │                   │
    │  200 OK            │                      │                   │
    │◄───────────────────│                      │                   │
    │                    │                      │                   │
    │         [Cliente vuelve al BOT]           │                   │
```

---

## 14. Checklist de Implementacion

### Equipo Dispatcher:
- [ ] Agregar variables de entorno (`ENCUESTADOR_APP`, `ENCUESTADOR_STATUS_URL`)
- [ ] Modificar `config/index.js` con seccion encuestador
- [ ] Modificar `router.service.js` - logica de consulta al encuestador en `enrutarMensaje()`
- [ ] Agregar transformacion de payload para encuestador
- [ ] Crear endpoint `POST /encuesta/finalizar/:numero`
- [ ] Agregar schema de validacion para finalizar encuesta
- [ ] Renovar TTL en Redis cada vez que el cliente responde durante encuesta
- [ ] Tests

### Equipo Encuestador:
- [ ] Implementar `POST /api/dispatcher/incoming` (recibir mensajes del dispatcher)
- [ ] Implementar `GET /api/dispatcher/status/:phone` (consultar si hay encuesta activa)
- [ ] Implementar `GET /api/dispatcher/health` (health check)
- [ ] Usar `POST /enviar-template` del Dispatcher para enviar plantillas
- [ ] Usar `POST /enviar` del Dispatcher para enviar mensajes de seguimiento
- [ ] Llamar `POST /encuesta/finalizar/:numero` del Dispatcher al terminar encuesta
- [ ] Manejar timeout de 10 minutos internamente
- [ ] Validar que el cliente no este con el Asesor antes de iniciar encuesta (opcional)
