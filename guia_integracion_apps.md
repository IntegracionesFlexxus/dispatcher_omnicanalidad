# 📘 Guía de Integración: Apps Satélites con Dispatcher

## 🎯 Objetivo

Esta guía explica cómo integrar cualquier aplicación (Bot, Software de Gestión, CRM, etc.) con el Dispatcher de WhatsApp para enviar y recibir mensajes.

---

## 📋 Índice

1. [Conceptos Clave](#conceptos)
2. [Requisitos Mínimos](#requisitos)
3. [Flujo de Integración](#flujo)
4. [Implementación Paso a Paso](#implementacion)
5. [APIs del Dispatcher](#apis)
6. [Ejemplos por Lenguaje](#ejemplos)
7. [Casos de Uso Comunes](#casos-uso)
8. [Testing](#testing)
9. [Mejores Prácticas](#mejores-practicas)
10. [FAQ](#faq)

---

## 🧠 Conceptos Clave {#conceptos}

### ¿Qué es una App Satélite?

Una **app satélite** es cualquier aplicación que se conecta al Dispatcher para:
- ✅ Recibir mensajes de clientes de WhatsApp
- ✅ Enviar respuestas a WhatsApp
- ✅ Transferir conversaciones a otras apps
- ✅ Finalizar conversaciones

**Ejemplos de apps satélites:**
- Bot con IA (GPT, Claude, etc.)
- Software de gestión de asesores
- CRM para ventas
- Sistema de soporte técnico
- Panel de supervisores

### Arquitectura de Comunicación

```
┌─────────────────────────────────────────────────┐
│                  WhatsApp                        │
└────────────────────┬────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────┐
│               DISPATCHER (API)                   │
│  • Maneja routing                                │
│  • Persiste estado en Redis                      │
│  • Centraliza comunicación con WhatsApp          │
└──────┬────────────────────────────────┬─────────┘
       │                                 │
       ↓ PULL (recibe)                   ↓ PULL (recibe)
┌──────────────┐                  ┌─────────────────┐
│   TU BOT     │                  │  TU SOFTWARE    │
│              │                  │                 │
│ POST /webhook│                  │ POST /webhook   │
│              │                  │                 │
│      ↓ PUSH (envía)             │      ↓ PUSH (envía)
│ POST /enviar │                  │ POST /enviar    │
└──────────────┘                  └─────────────────┘
```

**Flujo:**
1. **PULL (Dispatcher → App)**: Dispatcher llama a tu `/webhook`
2. **PUSH (App → Dispatcher)**: Tu app llama a `/enviar` del Dispatcher

---

## ✅ Requisitos Mínimos {#requisitos}

### Para integrar tu app necesitas:

1. **Un endpoint HTTP POST** en tu app para recibir mensajes:
   ```
   POST http://tu-app.com/webhook
   ```

2. **Cliente HTTP** para enviar requests al Dispatcher:
   - Node.js: `axios`, `fetch`
   - Python: `requests`
   - PHP: `curl`, `guzzle`
   - Java: `HttpClient`
   - Cualquier lenguaje que haga HTTP

3. **Saber la URL del Dispatcher**:
   ```
   http://dispatcher:8080
   ```

4. **API Key** (si está configurada):
   ```
   X-API-Key: tu_api_key_aqui
   ```

**¡Eso es todo!** No necesitas SDK especial ni librerías complejas.

---

## 🔄 Flujo de Integración {#flujo}

### Flujo Completo de una Conversación

```
1. CLIENTE ENVÍA MENSAJE
   WhatsApp → Dispatcher

2. DISPATCHER ENRUTA
   Dispatcher verifica en Redis: ¿A qué app va este número?
   
3. DISPATCHER LLAMA A TU APP
   POST http://tu-app/webhook
   Body: { mensaje de WhatsApp }

4. TU APP PROCESA
   - Parsea el mensaje
   - Aplica lógica de negocio (IA, reglas, DB, etc.)
   - Decide qué responder

5. TU APP RESPONDE (ASYNC)
   POST http://dispatcher/enviar
   Body: { "numero": "...", "mensaje": "..." }

6. DISPATCHER ENVÍA A WHATSAPP
   Dispatcher → WhatsApp API

7. CLIENTE RECIBE RESPUESTA
   WhatsApp → Cliente
```

### Caso: Transferir a Otra App

```
1. Cliente pide asesor
   WhatsApp → Dispatcher → Bot

2. Bot decide transferir
   Bot → POST http://dispatcher/transferir
   Body: { "numero": "...", "app_destino": "asesor" }

3. Dispatcher cambia routing en Redis
   routing:5493512345678 = "asesor"

4. Dispatcher notifica al software
   POST http://software/webhook
   Body: { "tipo": "nueva_conversacion", "numero": "..." }

5. Próximos mensajes van al software
   WhatsApp → Dispatcher → Software (no Bot)
```

---

## 🛠️ Implementación Paso a Paso {#implementacion}

### Paso 1: Crear Endpoint `/webhook`

Tu app DEBE tener un endpoint que reciba POST requests del Dispatcher.

**Estructura del request que recibirás:**

```json
{
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "id": "wamid.xxx",
          "from": "5493512345678",
          "timestamp": "1234567890",
          "type": "text",
          "text": {
            "body": "Hola, necesito ayuda"
          }
        }]
      }
    }]
  }]
}
```

**Caso especial - Nueva conversación transferida:**

```json
{
  "tipo": "nueva_conversacion",
  "numero": "5493512345678",
  "contexto": {
    "razon": "Cliente pidió asesor",
    "data": "..."
  },
  "desde_app": "bot"
}
```

### Paso 2: Procesar el Mensaje

**Pseudocódigo:**

```
función webhook(request):
    body = request.body
    
    // ¿Es una nueva conversación transferida?
    si body.tipo == "nueva_conversacion":
        numero = body.numero
        contexto = body.contexto
        
        // Mostrar notificación, crear ticket, etc.
        mostrarNuevaConversacion(numero, contexto)
        
        return 200
    
    // Es un mensaje normal del cliente
    mensaje = extraerMensaje(body)
    numero = mensaje.from
    texto = mensaje.text.body
    
    // Loggear
    log("Mensaje de " + numero + ": " + texto)
    
    // Procesar de forma asíncrona
    procesarEnBackground(numero, texto)
    
    return 200  // Acknowledge inmediato
```

### Paso 3: Enviar Respuesta al Dispatcher

**Pseudocódigo:**

```
función enviarRespuesta(numero, mensaje):
    url = "http://dispatcher:8080/enviar"
    
    body = {
        "numero": numero,
        "mensaje": mensaje
    }
    
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": "tu_api_key"
    }
    
    response = HTTP.post(url, body, headers)
    
    si response.status != 200:
        log("Error enviando mensaje")
```

### Paso 4: Transferir (Opcional)

```
función transferirAsesor(numero, contexto):
    url = "http://dispatcher:8080/transferir"
    
    body = {
        "numero": numero,
        "app_destino": "asesor",
        "contexto": contexto
    }
    
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": "tu_api_key"
    }
    
    HTTP.post(url, body, headers)
```

### Paso 5: Finalizar (Opcional)

```
función finalizarConversacion(numero):
    url = "http://dispatcher:8080/finalizar/" + numero
    
    headers = {
        "X-API-Key": "tu_api_key"
    }
    
    HTTP.post(url, null, headers)
```

---

## 📡 APIs del Dispatcher {#apis}

### 1. POST /enviar - Enviar mensaje a WhatsApp

**Request:**
```bash
POST http://dispatcher:8080/enviar
Content-Type: application/json
X-API-Key: tu_api_key

{
  "numero": "5493512345678",
  "mensaje": "Hola, ¿en qué puedo ayudarte?"
}
```

**Response Success (200):**
```json
{
  "ok": true,
  "mensaje": "Mensaje enviado"
}
```

**Response Error (400/500):**
```json
{
  "error": "Error enviando mensaje",
  "detalle": "..."
}
```

---

### 2. POST /transferir - Transferir conversación

**Request:**
```bash
POST http://dispatcher:8080/transferir
Content-Type: application/json
X-API-Key: tu_api_key

{
  "numero": "5493512345678",
  "app_destino": "asesor",
  "contexto": {
    "razon": "Cliente pidió hablar con humano",
    "historial": ["msg1", "msg2"],
    "custom_data": "..."
  }
}
```

**Response Success (200):**
```json
{
  "ok": true,
  "anterior": "bot",
  "nueva": "asesor"
}
```

---

### 3. POST /finalizar/:numero - Finalizar conversación

**Request:**
```bash
POST http://dispatcher:8080/finalizar/5493512345678
X-API-Key: tu_api_key

# Body opcional:
{
  "mensaje_despedida": true
}
```

**Response Success (200):**
```json
{
  "ok": true,
  "app_anterior": "asesor"
}
```

---

### 4. GET /estado - Ver estado del sistema

**Request:**
```bash
GET http://dispatcher:8080/estado
X-API-Key: tu_api_key
```

**Response:**
```json
{
  "total_conversaciones": 5,
  "conversaciones": [
    {
      "numero": "5493512345678",
      "app": "asesor",
      "expira_en": 85000
    }
  ],
  "estadisticas": {
    "mensajes_total": 250,
    "mensajes_bot": 180,
    "mensajes_asesor": 70,
    "transferencias": 10
  }
}
```

---

## 💻 Ejemplos por Lenguaje {#ejemplos}

### Node.js (Express)

```javascript
const express = require('express');
const axios = require('axios');
const app = express();

const DISPATCHER_URL = 'http://dispatcher:8080';
const API_KEY = 'tu_api_key';

app.use(express.json());

// Recibir mensajes del dispatcher
app.post('/webhook', async (req, res) => {
    // Acknowledge inmediato
    res.sendStatus(200);
    
    try {
        const body = req.body;
        
        // Nueva conversación transferida
        if (body.tipo === 'nueva_conversacion') {
            console.log('📥 Nueva conversación:', body.numero);
            mostrarNotificacion(body.numero, body.contexto);
            return;
        }
        
        // Extraer mensaje
        const mensaje = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (!mensaje) return;
        
        const numero = mensaje.from;
        const texto = mensaje.text?.body || '';
        
        console.log(`💬 ${numero}: ${texto}`);
        
        // Procesar asíncronamente
        procesarMensaje(numero, texto);
        
    } catch (error) {
        console.error('Error:', error);
    }
});

async function procesarMensaje(numero, texto) {
    // Tu lógica aquí
    const respuesta = await tuLogicaDeNegocio(texto);
    
    // Enviar respuesta
    await enviarMensaje(numero, respuesta);
}

async function enviarMensaje(numero, mensaje) {
    try {
        await axios.post(`${DISPATCHER_URL}/enviar`, {
            numero: numero,
            mensaje: mensaje
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_KEY
            }
        });
        
        console.log('✅ Mensaje enviado');
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

async function transferirAsesor(numero, contexto) {
    try {
        await axios.post(`${DISPATCHER_URL}/transferir`, {
            numero: numero,
            app_destino: 'asesor',
            contexto: contexto
        }, {
            headers: {
                'X-API-Key': API_KEY
            }
        });
        
        console.log('🔀 Transferido a asesor');
    } catch (error) {
        console.error('Error:', error);
    }
}

app.listen(3000, () => {
    console.log('App en puerto 3000');
});
```

---

### Python (Flask)

```python
from flask import Flask, request, jsonify
import requests
import threading

app = Flask(__name__)

DISPATCHER_URL = 'http://dispatcher:8080'
API_KEY = 'tu_api_key'

@app.route('/webhook', methods=['POST'])
def webhook():
    # Acknowledge inmediato
    data = request.json
    
    # Nueva conversación
    if data.get('tipo') == 'nueva_conversacion':
        print(f"📥 Nueva conversación: {data['numero']}")
        mostrar_notificacion(data['numero'], data['contexto'])
        return '', 200
    
    # Extraer mensaje
    try:
        mensaje = data['entry'][0]['changes'][0]['value']['messages'][0]
        numero = mensaje['from']
        texto = mensaje.get('text', {}).get('body', '')
        
        print(f"💬 {numero}: {texto}")
        
        # Procesar en background
        thread = threading.Thread(
            target=procesar_mensaje,
            args=(numero, texto)
        )
        thread.start()
        
    except (KeyError, IndexError) as e:
        print(f"Error parseando: {e}")
    
    return '', 200

def procesar_mensaje(numero, texto):
    # Tu lógica aquí
    respuesta = tu_logica_de_negocio(texto)
    
    # Enviar respuesta
    enviar_mensaje(numero, respuesta)

def enviar_mensaje(numero, mensaje):
    try:
        response = requests.post(
            f'{DISPATCHER_URL}/enviar',
            json={
                'numero': numero,
                'mensaje': mensaje
            },
            headers={
                'Content-Type': 'application/json',
                'X-API-Key': API_KEY
            },
            timeout=5
        )
        
        if response.status_code == 200:
            print('✅ Mensaje enviado')
        else:
            print(f'❌ Error: {response.status_code}')
            
    except Exception as e:
        print(f'❌ Error: {e}')

def transferir_asesor(numero, contexto):
    try:
        requests.post(
            f'{DISPATCHER_URL}/transferir',
            json={
                'numero': numero,
                'app_destino': 'asesor',
                'contexto': contexto
            },
            headers={'X-API-Key': API_KEY}
        )
        print('🔀 Transferido a asesor')
    except Exception as e:
        print(f'Error: {e}')

if __name__ == '__main__':
    app.run(port=3000)
```

---

### PHP

```php
<?php
// webhook.php

$DISPATCHER_URL = 'http://dispatcher:8080';
$API_KEY = 'tu_api_key';

// Recibir webhook
$body = json_decode(file_get_contents('php://input'), true);

// Acknowledge inmediato
http_response_code(200);

// Nueva conversación
if (isset($body['tipo']) && $body['tipo'] === 'nueva_conversacion') {
    error_log("📥 Nueva conversación: " . $body['numero']);
    mostrarNotificacion($body['numero'], $body['contexto']);
    exit;
}

// Extraer mensaje
try {
    $mensaje = $body['entry'][0]['changes'][0]['value']['messages'][0];
    $numero = $mensaje['from'];
    $texto = $mensaje['text']['body'] ?? '';
    
    error_log("💬 $numero: $texto");
    
    // Procesar mensaje (en background idealmente)
    procesarMensaje($numero, $texto);
    
} catch (Exception $e) {
    error_log("Error: " . $e->getMessage());
}

function procesarMensaje($numero, $texto) {
    global $DISPATCHER_URL, $API_KEY;
    
    // Tu lógica aquí
    $respuesta = tuLogicaDeNegocio($texto);
    
    // Enviar respuesta
    enviarMensaje($numero, $respuesta);
}

function enviarMensaje($numero, $mensaje) {
    global $DISPATCHER_URL, $API_KEY;
    
    $data = [
        'numero' => $numero,
        'mensaje' => $mensaje
    ];
    
    $ch = curl_init("$DISPATCHER_URL/enviar");
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        "X-API-Key: $API_KEY"
    ]);
    
    $response = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($status === 200) {
        error_log("✅ Mensaje enviado");
    } else {
        error_log("❌ Error: $status");
    }
}

function transferirAsesor($numero, $contexto) {
    global $DISPATCHER_URL, $API_KEY;
    
    $data = [
        'numero' => $numero,
        'app_destino' => 'asesor',
        'contexto' => $contexto
    ];
    
    $ch = curl_init("$DISPATCHER_URL/transferir");
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        "X-API-Key: $API_KEY"
    ]);
    
    curl_exec($ch);
    curl_close($ch);
}
```

---

### Java (Spring Boot)

```java
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;
import org.springframework.http.*;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashMap;
import java.util.Map;

@SpringBootApplication
@RestController
public class Application {

    private static final String DISPATCHER_URL = "http://dispatcher:8080";
    private static final String API_KEY = "tu_api_key";
    
    private RestTemplate restTemplate = new RestTemplate();

    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }

    @PostMapping("/webhook")
    public ResponseEntity<String> webhook(@RequestBody JsonNode body) {
        // Acknowledge inmediato
        
        // Nueva conversación
        if (body.has("tipo") && "nueva_conversacion".equals(body.get("tipo").asText())) {
            String numero = body.get("numero").asText();
            System.out.println("📥 Nueva conversación: " + numero);
            return ResponseEntity.ok("");
        }
        
        // Extraer mensaje
        try {
            JsonNode mensaje = body.get("entry").get(0)
                .get("changes").get(0)
                .get("value").get("messages").get(0);
            
            String numero = mensaje.get("from").asText();
            String texto = mensaje.get("text").get("body").asText();
            
            System.out.println("💬 " + numero + ": " + texto);
            
            // Procesar en thread separado
            new Thread(() -> procesarMensaje(numero, texto)).start();
            
        } catch (Exception e) {
            System.err.println("Error: " + e.getMessage());
        }
        
        return ResponseEntity.ok("");
    }
    
    private void procesarMensaje(String numero, String texto) {
        // Tu lógica aquí
        String respuesta = tuLogicaDeNegocio(texto);
        
        // Enviar respuesta
        enviarMensaje(numero, respuesta);
    }
    
    private void enviarMensaje(String numero, String mensaje) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("X-API-Key", API_KEY);
        
        Map<String, String> body = new HashMap<>();
        body.put("numero", numero);
        body.put("mensaje", mensaje);
        
        HttpEntity<Map<String, String>> request = new HttpEntity<>(body, headers);
        
        try {
            restTemplate.postForEntity(
                DISPATCHER_URL + "/enviar",
                request,
                String.class
            );
            System.out.println("✅ Mensaje enviado");
        } catch (Exception e) {
            System.err.println("❌ Error: " + e.getMessage());
        }
    }
    
    private void transferirAsesor(String numero, Map<String, Object> contexto) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-API-Key", API_KEY);
        
        Map<String, Object> body = new HashMap<>();
        body.put("numero", numero);
        body.put("app_destino", "asesor");
        body.put("contexto", contexto);
        
        HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);
        
        try {
            restTemplate.postForEntity(
                DISPATCHER_URL + "/transferir",
                request,
                String.class
            );
            System.out.println("🔀 Transferido");
        } catch (Exception e) {
            System.err.println("Error: " + e.getMessage());
        }
    }
}
```

---

## 🎯 Casos de Uso Comunes {#casos-uso}

### Caso 1: Bot Simple que Responde

```javascript
app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    
    const mensaje = extraerMensaje(req.body);
    const respuesta = `Recibí tu mensaje: "${mensaje.texto}"`;
    
    await enviarMensaje(mensaje.numero, respuesta);
});
```

### Caso 2: Bot que Transfiere si No Entiende

```javascript
app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    
    const mensaje = extraerMensaje(req.body);
    const confianza = analizarConIA(mensaje.texto);
    
    if (confianza < 0.7) {
        // No entendió bien, transferir a humano
        await transferirAsesor(mensaje.numero, {
            razon: 'Bot no pudo entender',
            mensaje_original: mensaje.texto,
            confianza: confianza
        });
        
        await enviarMensaje(
            mensaje.numero,
            '👤 Te conecto con un asesor que te ayudará mejor...'
        );
    } else {
        // Responder con confianza
        const respuesta = generarRespuesta(mensaje.texto);
        await enviarMensaje(mensaje.numero, respuesta);
    }
});
```

### Caso 3: Software de Asesor que Notifica

```javascript
app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    
    const body = req.body;
    
    // Nueva conversación asignada
    if (body.tipo === 'nueva_conversacion') {
        const { numero, contexto } = body;
        
        // Notificar al asesor disponible
        notificarAsesor({
            titulo: 'Nueva conversación',
            numero: numero,
            contexto: contexto.razon,
            mensaje: contexto.mensaje_original
        });
        
        // Abrir ventana de chat
        abrirChat(numero);
        
        return;
    }
    
    // Mensaje del cliente
    const mensaje = extraerMensaje(body);
    
    // Mostrar en interfaz del asesor
    agregarMensajeAlChat(mensaje.numero, mensaje.texto);
    
    // Reproducir sonido
    reproducirNotificacion();
});

// Cuando el asesor escribe una respuesta
app.post('/asesor-responde', async (req, res) => {
    const { numero, mensaje, nombreAsesor } = req.body;
    
    await enviarMensaje(
        numero,
        `👤 ${nombreAsesor}: ${mensaje}`
    );
    
    res.json({ ok: true });
});
```

### Caso 4: Sistema Multi-departamento

```javascript
app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    
    const mensaje = extraerMensaje(req.body);
    const texto = mensaje.texto.toLowerCase();
    
    // Clasificar por departamento
    if (texto.includes('comprar') || texto.includes('precio')) {
        await transferir(mensaje.numero, 'ventas', {
            tipo: 'venta',
            interes: extraerProducto(texto)
        });
        await enviarMensaje(mensaje.numero, '🛒 Te conecto con ventas...');
    }
    else if (texto.includes('problema') || texto.includes('no funciona')) {
        await transferir(mensaje.numero, 'soporte', {
            tipo: 'soporte_tecnico',
            descripcion: texto
        });
        await enviarMensaje(mensaje.numero, '🔧 Te conecto con soporte...');
    }
    else if (texto.includes('queja') || texto.includes('reclamo')) {
        await transferir(mensaje.numero, 'gerencia', {
            tipo: 'queja',
            urgente: true
        });
        await enviarMensaje(mensaje.numero, '⚠️ Un supervisor te atenderá...');
    }
    else {
        // Respuesta del bot
        const respuesta = procesarConBot(texto);
        await enviarMensaje(mensaje.numero, respuesta);
    }
});
```

---

## 🧪 Testing {#testing}

### Test Manual con cURL

**1. Simular mensaje del dispatcher a tu app:**

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{
            "from": "5493512345678",
            "text": {
              "body": "Hola"
            }
          }]
        }
      }]
    }]
  }'
```

**2. Enviar mensaje al dispatcher:**

```bash
curl -X POST http://dispatcher:8080/enviar \
  -H "Content-Type: application/json" \
  -H "X-API-Key: tu_api_key" \
  -d '{
    "numero": "5493512345678",
    "mensaje": "Test desde mi app"
  }'
```

**3. Transferir conversación:**

```bash
curl -X POST http://dispatcher:8080/transferir \
  -H "Content-Type: application/json" \
  -H "X-API-Key: tu_api_key" \
  -d '{
    "numero": "5493512345678",
    "app_destino": "asesor",
    "contexto": {"test": true}
  }'
```

### Test Automatizado (Jest - Node.js)

```javascript
const request = require('supertest');
const app = require('./app');

describe('Webhook', () => {
    test('Debe recibir mensaje y responder 200', async () => {
        const mensaje = {
            entry: [{
                changes: [{
                    value: {
                        messages: [{
                            from: '5493512345678',
                            text: { body: 'test' }
                        }]
                    }
                }]
            }]
        };
        
        const response = await request(app)
            .post('/webhook')
            .send(mensaje);
        
        expect(response.status).toBe(200);
    });
    
    test('Debe manejar nueva conversación', async () => {
        const nuevaConv = {
            tipo: 'nueva_conversacion',
            numero: '5493512345678',
            contexto: { razon: 'test' }
        };
        
        const response = await request(app)
            .post('/webhook')
            .send(nuevaConv);
        
        expect(response.status).toBe(200);
    });
});
```

---

## ✨ Mejores Prácticas {#mejores-practicas}

### 1. ✅ Acknowledge Rápido

**MAL:**
```javascript
app.post('/webhook', async (req, res) => {
    const mensaje = extraerMensaje(req.body);
    const respuesta = await procesarConIA(mensaje); // ⚠️ Puede tardar 5-10 seg
    await enviarMensaje(mensaje.numero, respuesta);
    res.sendStatus(200); // ❌ Timeout!
});
```

**BIEN:**
```javascript
app.post('/webhook', async (req, res) => {
    res.sendStatus(200); // ✅ Acknowledge inmediato
    
    // Procesar en background
    const mensaje = extraerMensaje(req.body);
    procesarEnBackground(mensaje);
});
```

### 2. ✅ Manejo de Errores Robusto

```javascript
async function enviarMensaje(numero, texto) {
    const MAX_REINTENTOS = 3;
    
    for (let i = 0; i < MAX_REINTENTOS; i++) {
        try {
            await axios.post(`${DISPATCHER_URL}/enviar`, {
                numero, mensaje: texto
            }, {
                headers: { 'X-API-Key': API_KEY },
                timeout: 5000
            });
            
            return; // ✅ Éxito
            
        } catch (error) {
            console.error(`Intento ${i+1} falló:`, error.message);
            
            if (i === MAX_REINTENTOS - 1) {
                // Último intento, loggear error crítico
                logErrorCritico('No se pudo enviar mensaje', {
                    numero, texto, error
                });
            } else {
                // Esperar antes de reintentar
                await sleep(1000 * (i + 1));
            }
        }
    }
}
```

### 3. ✅ Logs Estructurados

```javascript
const winston = require('winston');

const logger = winston.createLogger({
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'app.log' })
    ]
});

app.post('/webhook', (req, res) => {
    const mensaje = extraerMensaje(req.body);
    
    logger.info('Mensaje recibido', {
        numero: mensaje.numero,
        largo: mensaje.texto.length,
        timestamp: new Date()
    });
    
    // ...
});
```

### 4. ✅ Variables de Entorno

```javascript
// config.js
require('dotenv').config();

module.exports = {
    DISPATCHER_URL: process.env.DISPATCHER_URL || 'http://localhost:8080',
    API_KEY: process.env.DISPATCHER_API_KEY,
    PORT: parseInt(process.env.PORT) || 3000,
    NODE_ENV: process.env.NODE_ENV || 'development'
};
```

### 5. ✅ Rate Limiting

```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 100, // máximo 100 requests
    message: 'Demasiadas solicitudes'
});

app.use('/webhook', limiter);
```

### 6. ✅ Timeouts Apropiados

```javascript
const axios = require('axios');

const dispatcherClient = axios.create({
    baseURL: DISPATCHER_URL,
    timeout: 5000, // 5 segundos
    headers: {
        'X-API-Key': API_KEY
    }
});

// Uso
await dispatcherClient.post('/enviar', { numero, mensaje });
```

### 7. ✅ Validación de Datos

```javascript
function validarMensaje(body) {
    if (!body.entry || !Array.isArray(body.entry)) {
        throw new Error('Formato inválido: falta entry');
    }
    
    const mensaje = body.entry[0]?.changes?.[0]?.value?.messages?.[0];
    
    if (!mensaje || !mensaje.from) {
        throw new Error('Formato inválido: falta mensaje o from');
    }
    
    return mensaje;
}

app.post('/webhook', (req, res) => {
    res.sendStatus(200);
    
    try {
        const mensaje = validarMensaje(req.body);
        procesarMensaje(mensaje);
    } catch (error) {
        logger.error('Mensaje inválido:', error);
    }
});
```

---

## ❓ FAQ {#faq}

### ¿Puedo usar HTTPS entre mi app y el dispatcher?

**Sí**, simplemente usa `https://` en la URL:
```javascript
const DISPATCHER_URL = 'https://dispatcher.miempresa.com';
```

### ¿Qué pasa si mi app está offline cuando llega un mensaje?

El dispatcher intentará llamar a tu `/webhook`. Si falla:
- Se loggea el error
- El mensaje se pierde (no hay cola de reintentos por defecto)

**Solución:** Implementa un sistema de cola en tu app o agrega lógica de reintentos en el dispatcher.

### ¿Puedo tener múltiples instancias de mi app?

**Sí**, pero todas recibirán el webhook. Usa un load balancer o implementa lógica de "lock" para que solo una procese:

```javascript
const redis = require('redis');

async function procesarSiNoEstaBloqueado(numero, mensaje) {
    const lock = await redis.set(`lock:${numero}`, '1', 'NX', 'EX', 10);
    
    if (!lock) {
        console.log('Otra instancia está procesando');
        return;
    }
    
    // Procesar...
    
    await redis.del(`lock:${numero}`);
}
```

### ¿Cómo sé si un mensaje es duplicado?

Usa el `id` del mensaje:

```javascript
const mensajesProcesados = new Set();

app.post('/webhook', (req, res) => {
    const mensaje = extraerMensaje(req.body);
    
    if (mensajesProcesados.has(mensaje.id)) {
        console.log('Mensaje duplicado, ignorando');
        return res.sendStatus(200);
    }
    
    mensajesProcesados.add(mensaje.id);
    
    // Procesar...
});
```

### ¿Puedo enviar imágenes/archivos?

El dispatcher actual solo maneja texto. Para multimedia:

1. Modifica el dispatcher para soportar otros tipos
2. O maneja multimedia directamente con la API de WhatsApp desde tu app

### ¿Cómo testeo sin WhatsApp real?

Usa cURL para simular webhooks:

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{"entry":[{"changes":[{"value":{"messages":[{"from":"123","text":{"body":"test"}}]}}]}]}'
```

---

## 📚 Recursos Adicionales

- **Documentación del Dispatcher**: Ver `README.md` del dispatcher
- **WhatsApp API Docs**: https://developers.facebook.com/docs/whatsapp
- **Postman Collection**: (crear una para facilitar testing)

---

## ✅ Checklist de Integración

- [ ] Endpoint `POST /webhook` implementado
- [ ] Parseo de mensajes funcionando
- [ ] Envío de mensajes al dispatcher funciona
- [ ] Manejo de errores implementado
- [ ] Logs configurados
- [ ] Variables de entorno configuradas
- [ ] Tested con cURL
- [ ] Tested con mensajes reales
- [ ] Documentado internamente
- [ ] Monitoreo configurado

---

¡Tu app está lista para integrarse! 🎉