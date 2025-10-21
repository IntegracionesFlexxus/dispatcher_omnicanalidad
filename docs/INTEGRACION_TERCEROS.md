# 📡 Guía de Integración - Aplicaciones Terceras con Dispatcher

Esta guía explica **exactamente** cómo debe interactuar tu aplicación (BOT, ASESOR, etc.) con el Dispatcher de WhatsApp.

---

## 🎯 Resumen Rápido

El Dispatcher es un **enrutador centralizado** que:
- ✅ Recibe todos los mensajes de WhatsApp
- ✅ Los enruta a la aplicación correcta según el estado de la conversación
- ✅ Maneja transferencias entre aplicaciones
- ✅ Proporciona APIs para enviar mensajes

**Tu aplicación solo necesita:**
1. Exponer un endpoint POST para recibir mensajes
2. Responder con status 200
3. Opcionalmente, llamar APIs del dispatcher para transferir/enviar

---

## 1️⃣ Recibir Mensajes de WhatsApp

### 📥 Endpoint que debe exponer tu aplicación

Tu aplicación debe tener un endpoint POST configurado en el `.env` del dispatcher:

```bash
# Ejemplo en .env del dispatcher
BOT_APP=BOT|http://localhost:4800/webhook|1
ASESOR_APP=SOFTWARE_ASESORES|http://localhost:3001/api/external/conversations/create|2
```

### 🔵 Request que RECIBIRÁS del Dispatcher

**Método:** `POST`

**Headers:**
```http
Content-Type: application/json
X-Dispatcher: true
X-Dispatcher-Version: 1.0.0
```

**Body (Formato completo de WhatsApp Cloud API):**
```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "280840865102340",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "5493518078878",
              "phone_number_id": "244963808706327"
            },
            "contacts": [
              {
                "profile": {
                  "name": "Christian"
                },
                "wa_id": "5493534193971"
              }
            ],
            "messages": [
              {
                "from": "5493534193971",
                "id": "wamid.HBgNNTQ5MzUzNDE5Mzk3MRU...",
                "timestamp": "1761058772",
                "text": {
                  "body": "hola"
                },
                "type": "text"
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### ✅ Response que DEBE ENVIAR tu aplicación

**Status Code:** `200` - `299` (cualquier código 2xx)

**Body (opcional - puede ser cualquier cosa):**
```json
{
  "ok": true,
  "mensaje": "Mensaje procesado"
}
```

**⚠️ IMPORTANTE:**
- ✅ Responder **rápido** (< 10 segundos por defecto, configurable con `APP_TIMEOUT_MS`)
- ✅ Si el procesamiento toma tiempo, **responde 200 inmediatamente** y procesa en background
- ✅ El dispatcher considera **exitoso** cualquier status 2xx (200, 201, 204, etc.)
- ❌ **NO responder 4xx o 5xx** a menos que realmente haya un error de validación

### 📝 Ejemplo de implementación (Node.js/Express)

```javascript
const express = require('express');
const app = express();

app.use(express.json());

app.post('/webhook', async (req, res) => {
  // IMPORTANTE: Responder 200 inmediatamente
  res.status(200).json({ ok: true });

  // Procesar el mensaje en background
  try {
    const body = req.body;

    // Extraer el mensaje
    const mensaje = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!mensaje) return;

    const numero = mensaje.from;
    const texto = mensaje.text?.body;
    const nombreUsuario = body.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name;

    console.log(`Mensaje de ${nombreUsuario} (${numero}): ${texto}`);

    // Aquí va tu lógica de negocio...
    await procesarMensaje(numero, texto);

  } catch (error) {
    console.error('Error procesando mensaje:', error);
  }
});

app.listen(4800, () => {
  console.log('Bot escuchando en puerto 4800');
});
```

---

## 2️⃣ Recibir Notificación de Transferencia

Cuando otra aplicación transfiere una conversación hacia tu app, recibirás una notificación especial.

### 🔵 Request que RECIBIRÁS del Dispatcher

**Endpoint:** El mismo endpoint configurado (ej: `/webhook`)

**Headers:** Los mismos que mensajes normales

**Body:**
```json
{
  "tipo": "nueva_conversacion",
  "numero": "5493534193971",
  "contexto": {
    "motivo": "Cliente pidió hablar con asesor",
    "nombre": "Christian",
    "historial": "Usuario preguntó por planes premium",
    "cualquier_data": "Puedes agregar lo que necesites aquí"
  },
  "desde_app": "bot",
  "timestamp": "2025-10-21T14:59:35.123Z"
}
```

### ✅ Response que DEBE ENVIAR tu aplicación

**Status Code:** `200` - `299`

**Body (opcional):**
```json
{
  "ok": true,
  "asesor_asignado": "Juan Pérez",
  "mensaje": "Conversación recibida correctamente"
}
```

### 📝 Ejemplo de implementación

```javascript
app.post('/webhook', async (req, res) => {
  res.status(200).json({ ok: true });

  const body = req.body;

  // Detectar si es una transferencia
  if (body.tipo === 'nueva_conversacion') {
    const { numero, contexto, desde_app } = body;

    console.log(`🔀 Nueva conversación transferida desde ${desde_app}`);
    console.log(`📞 Cliente: ${numero}`);
    console.log(`📋 Contexto:`, contexto);

    // Asignar a un asesor humano
    await asignarAsesor(numero, contexto);
    await enviarMensajeBienvenida(numero);

    return;
  }

  // Si no es transferencia, es un mensaje normal
  const mensaje = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (mensaje) {
    await procesarMensaje(mensaje.from, mensaje.text?.body);
  }
});
```

---

## 3️⃣ Transferir una Conversación (desde tu app al dispatcher)

Cuando tu aplicación quiere transferir una conversación a otra app (ej: BOT → ASESOR).

### 🔵 Request que hace TU APP al Dispatcher

**Endpoint:**
```
POST http://localhost:8081/transferir
```

**Headers:**
```http
Content-Type: application/json
X-API-Key: LO_QUE_QUIERAS
```
*(El API Key debe coincidir con `API_KEY` en el `.env` del dispatcher)*

**Body:**
```json
{
  "numero": "5493534193971",
  "app_destino": "asesor",
  "contexto": {
    "motivo": "Cliente quiere hablar con humano",
    "nombre": "Christian",
    "ultima_consulta": "Problemas con el pago",
    "historial": "...",
    "cualquier_dato_relevante": "..."
  }
}
```

**Parámetros:**
- `numero` (requerido): Número de teléfono del cliente (con código de país)
- `app_destino` (requerido): Key de la app destino (ej: `"bot"`, `"asesor"`)
- `contexto` (opcional): Objeto con cualquier información relevante para la nueva app

### ✅ Response del Dispatcher

**Status 200:**
```json
{
  "ok": true,
  "anterior": "bot",
  "nueva": "asesor",
  "notificacion_enviada": true
}
```

**Status 400 (app no existe):**
```json
{
  "error": "Aplicación \"xyz\" no existe"
}
```

### 📝 Ejemplo de implementación

```javascript
const axios = require('axios');

async function transferirAsesor(numero, contexto = {}) {
  try {
    const response = await axios.post('http://localhost:8081/transferir', {
      numero: numero,
      app_destino: 'asesor',
      contexto: contexto
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'LO_QUE_QUIERAS'
      }
    });

    console.log('✅ Conversación transferida:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ Error al transferir:', error.message);
    throw error;
  }
}

// Uso
await transferirAsesor('5493534193971', {
  motivo: 'Cliente pidió hablar con humano',
  nombre: 'Christian',
  ultima_consulta: 'Problemas técnicos'
});
```

---

## 4️⃣ Finalizar una Conversación (volver al BOT)

Cuando tu aplicación termina de atender al cliente y quiere que vuelva al BOT.

### 🔵 Request que hace TU APP al Dispatcher

**Endpoint:**
```
POST http://localhost:8081/finalizar/{numero}
```

**Headers:**
```http
Content-Type: application/json
X-API-Key: LO_QUE_QUIERAS
```

**Body (opcional):**
```json
{
  "mensaje_despedida": true
}
```

**Parámetros:**
- `{numero}` (URL param): Número de teléfono del cliente
- `mensaje_despedida` (opcional): Si es `true`, el dispatcher enviará un mensaje de despedida automático

### ✅ Response del Dispatcher

```json
{
  "ok": true,
  "app_anterior": "asesor",
  "app_actual": "bot"
}
```

### 📝 Ejemplo de implementación

```javascript
async function finalizarConversacion(numero, enviarDespedida = true) {
  try {
    const response = await axios.post(
      `http://localhost:8081/finalizar/${numero}`,
      { mensaje_despedida: enviarDespedida },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'LO_QUE_QUIERAS'
        }
      }
    );

    console.log('✅ Conversación finalizada:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ Error al finalizar:', error.message);
    throw error;
  }
}

// Uso
await finalizarConversacion('5493534193971', true);
```

---

## 5️⃣ Enviar Mensajes a WhatsApp

Cuando tu aplicación quiere enviar un mensaje proactivo al cliente.

### 🔵 Request que hace TU APP al Dispatcher

**Endpoint:**
```
POST http://localhost:8081/enviar
```

**Headers:**
```http
Content-Type: application/json
X-API-Key: LO_QUE_QUIERAS
```

**Body:**
```json
{
  "numero": "5493534193971",
  "mensaje": "Hola! Un asesor estará contigo en breve."
}
```

### ✅ Response del Dispatcher

```json
{
  "ok": true,
  "mensaje": "Mensaje enviado correctamente"
}
```

### 📝 Ejemplo de implementación

```javascript
async function enviarMensaje(numero, texto) {
  try {
    const response = await axios.post('http://localhost:8081/enviar', {
      numero: numero,
      mensaje: texto
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'LO_QUE_QUIERAS'
      }
    });

    console.log('✅ Mensaje enviado:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ Error al enviar mensaje:', error.message);
    throw error;
  }
}

// Uso
await enviarMensaje('5493534193971', 'Hola! ¿En qué puedo ayudarte?');
```

---

## 6️⃣ Enviar Templates de WhatsApp

Para enviar templates pre-aprobados de WhatsApp (útil para mensajes fuera de la ventana de 24h).

### 🔵 Request que hace TU APP al Dispatcher

**Endpoint:**
```
POST http://localhost:8081/enviar-template
```

**Headers:**
```http
Content-Type: application/json
X-API-Key: LO_QUE_QUIERAS
```

**Body:**
```json
{
  "numero": "5493534193971",
  "template_name": "hello_world",
  "language_code": "es",
  "components": [
    {
      "type": "body",
      "parameters": [
        {
          "type": "text",
          "text": "Christian"
        }
      ]
    }
  ]
}
```

### ✅ Response del Dispatcher

```json
{
  "ok": true,
  "mensaje": "Template enviado correctamente"
}
```

---

## 7️⃣ Consultar Estado del Sistema

Ver todas las conversaciones activas y estadísticas.

### 🔵 Request que hace TU APP al Dispatcher

**Endpoint:**
```
GET http://localhost:8081/estado
```

**Headers:**
```http
X-API-Key: LO_QUE_QUIERAS
```

### ✅ Response del Dispatcher

```json
{
  "total_conversaciones": 5,
  "conversaciones": [
    {
      "numero": "5493534193971",
      "app": "asesor"
    },
    {
      "numero": "5493512345678",
      "app": "bot"
    }
  ],
  "estadisticas": {
    "mensajes_total": "1523",
    "mensajes_bot": "1200",
    "mensajes_asesor": "323",
    "transferencias": "45"
  },
  "circuit_breakers": [
    {
      "app": "bot",
      "state": "closed",
      "failures": 0,
      "successes": 1200
    }
  ],
  "aplicaciones": [
    {
      "key": "bot",
      "nombre": "BOT",
      "url": "http://localhost:4800/webhook",
      "prioridad": 1
    }
  ]
}
```

---

## 📋 Checklist de Implementación

### ✅ Lo que TU APLICACIÓN DEBE hacer:

- [ ] Exponer un endpoint POST (ej: `/webhook`)
- [ ] Responder con status **200-299** cuando procesa correctamente
- [ ] Responder en **< 10 segundos** (configurable en dispatcher)
- [ ] Aceptar el **body completo de WhatsApp Cloud API**
- [ ] Detectar y manejar **notificaciones de transferencia** (`tipo: "nueva_conversacion"`)
- [ ] Implementar lógica para **transferir** cuando sea necesario
- [ ] Implementar lógica para **finalizar** cuando la conversación termina

### ✅ Lo que tu aplicación PUEDE hacer (opcional):

- [ ] Llamar a `/transferir` para transferir conversaciones
- [ ] Llamar a `/finalizar/:numero` para finalizar conversaciones
- [ ] Llamar a `/enviar` para enviar mensajes
- [ ] Llamar a `/enviar-template` para templates
- [ ] Llamar a `/estado` para monitorear el sistema

### ❌ Lo que tu aplicación NO DEBE hacer:

- ❌ Conectarse directamente a **Redis** (el dispatcher lo maneja)
- ❌ Conectarse directamente a **WhatsApp Cloud API** (el dispatcher lo hace)
- ❌ Manejar el **routing** (el dispatcher decide qué app recibe cada mensaje)
- ❌ Almacenar estado de routing (lo hace el dispatcher en memoria)

---

## 🔧 Variables de Entorno

En el `.env` del **DISPATCHER**, configura tu app:

```bash
# Formato: NOMBRE_APP=Nombre|URL_completa|Prioridad
BOT_APP=BOT|http://localhost:4800/webhook|1
ASESOR_APP=SOFTWARE_ASESORES|http://localhost:3001/api/external/conversations/create|2

# API Key para autenticar llamadas desde tus apps
API_KEY=LO_QUE_QUIERAS
```

**Explicación:**
- `NOMBRE_APP`: Key única para identificar la app (usada en transferencias)
- `Nombre`: Nombre descriptivo (para logs)
- `URL_completa`: URL completa del endpoint de tu app (incluye el path)
- `Prioridad`: Número de prioridad (1 = más alta)

---

## 🐛 Troubleshooting

### 1. Mi app no recibe mensajes

**Verificar:**
- ✅ ¿El dispatcher está corriendo? → `curl http://localhost:8081/health`
- ✅ ¿Tu app está corriendo en el puerto correcto?
- ✅ ¿La URL en `.env` es correcta y alcanzable desde el dispatcher?
- ✅ ¿Tu app responde con status 200?

**Debug:**
```bash
# Ver logs del dispatcher
npm run dev

# Debería mostrar:
# ✅ BOT respondió OK (200)
```

### 2. Circuit breaker abierto

**Causa:** Tu app respondió con muchos errores (> 50% por defecto)

**Solución:**
- Verificar que tu app esté corriendo
- Verificar que responda en < 10 segundos
- Esperar 30 segundos (el circuit breaker se auto-resetea)
- Verificar logs de tu app para errores

### 3. Timeout en la conexión

**Causa:** Tu app tarda > 10 segundos en responder

**Solución:**
```javascript
// ✅ CORRECTO: Responder inmediatamente
app.post('/webhook', async (req, res) => {
  res.status(200).json({ ok: true }); // Responder YA

  // Procesar después
  await procesarMensajeLargo();
});

// ❌ INCORRECTO: Procesar antes de responder
app.post('/webhook', async (req, res) => {
  await procesarMensajeLargo(); // 15 segundos...
  res.status(200).json({ ok: true }); // TIMEOUT!
});
```

### 4. Transferencia no funciona

**Verificar:**
- ✅ ¿El `app_destino` existe en el `.env`? → `GET /aplicaciones`
- ✅ ¿El API Key es correcto?
- ✅ ¿El número incluye código de país?

---

## 📚 Recursos Adicionales

- **WhatsApp Cloud API Docs:** https://developers.facebook.com/docs/whatsapp/cloud-api
- **Formato de mensajes WhatsApp:** https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components

---

## 💡 Ejemplo Completo (BOT Simple)

```javascript
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const DISPATCHER_URL = 'http://localhost:8081';
const API_KEY = 'LO_QUE_QUIERAS';

// Endpoint para recibir mensajes
app.post('/webhook', async (req, res) => {
  // Responder 200 inmediatamente
  res.status(200).json({ ok: true });

  try {
    const body = req.body;

    // Manejar transferencias
    if (body.tipo === 'nueva_conversacion') {
      console.log(`🔀 Conversación transferida desde ${body.desde_app}`);
      await enviarMensaje(body.numero, 'Bienvenido de vuelta al bot!');
      return;
    }

    // Extraer mensaje
    const mensaje = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!mensaje) return;

    const numero = mensaje.from;
    const texto = mensaje.text?.body?.toLowerCase();

    // Lógica del bot
    if (texto.includes('asesor') || texto.includes('humano')) {
      // Transferir a asesor
      await transferir(numero, 'asesor', {
        motivo: 'Cliente pidió asesor',
        mensaje_original: texto
      });

      await enviarMensaje(numero, 'Te estoy conectando con un asesor...');
    } else {
      // Respuesta automática
      await enviarMensaje(numero, 'Hola! Soy un bot. ¿En qué puedo ayudarte?');
    }

  } catch (error) {
    console.error('Error:', error);
  }
});

// Función para enviar mensajes
async function enviarMensaje(numero, mensaje) {
  await axios.post(`${DISPATCHER_URL}/enviar`, {
    numero,
    mensaje
  }, {
    headers: { 'X-API-Key': API_KEY }
  });
}

// Función para transferir
async function transferir(numero, appDestino, contexto) {
  await axios.post(`${DISPATCHER_URL}/transferir`, {
    numero,
    app_destino: appDestino,
    contexto
  }, {
    headers: { 'X-API-Key': API_KEY }
  });
}

app.listen(4800, () => {
  console.log('Bot corriendo en puerto 4800');
});
```

---

¿Dudas? Revisa los logs del dispatcher con `npm run dev` y verás exactamente qué está pasando con cada mensaje.
