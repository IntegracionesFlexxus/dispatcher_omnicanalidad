# Integración con `X-API-Key` al Dispatcher — Equipo Asesor (CRM)

## Contexto

El Dispatcher Omnicanal va a empezar a exigir autenticación por API Key en todos los endpoints administrativos. Hoy está en modo *fail-open* (acepta requests sin key); en una próxima ventana de despliegue va a pasar a rechazar (401) cualquier request sin el header `X-API-Key`. Necesitamos que el CRM sume el header **antes** del corte.

## Variables de entorno a agregar

```env
DISPATCHER_URL=http://<host-o-ip-interna>:8082
DISPATCHER_API_KEY=<entregada-por-canal-seguro>
```

> La URL es interna (LAN), no el subdominio público. El equipo de Dispatcher confirma la URL exacta según dónde corra el servicio. La key se entrega por Bitwarden/Vault — no commitearla.

## Endpoints del Dispatcher que el CRM consume

Todos requieren `X-API-Key`:

| Método | Path | Uso |
|---|---|---|
| `POST` | `/enviar` | Mensaje de texto / botones / lista |
| `POST` | `/enviar-template` | Template de WhatsApp |
| `POST` | `/enviar-media` | Archivo (multipart/form-data) |
| `POST` | `/transferir` | Transferir conversación a otra app |
| `POST` | `/finalizar/:numero` | Finalizar conversación |
| `POST` | `/bot/desactivar/:numero` | Desactivar bot para un número |
| `POST` | `/bot/activar/:numero` | Reactivar bot |
| `GET` | `/bot/estado/:numero` | Estado del bot por número |
| `GET` | `/bot/desactivados` | Listado de bots apagados |
| `GET` | `/media/:mediaId` | Descargar media de Meta (proxy) |
| `GET` | `/estado` | Estado del sistema |

## Cómo agregar el header

### Node.js (axios) — recomendado: cliente centralizado

```js
// dispatcherClient.js
const axios = require('axios');
module.exports = axios.create({
  baseURL: process.env.DISPATCHER_URL,
  timeout: 10000,
  headers: { 'X-API-Key': process.env.DISPATCHER_API_KEY },
});

// uso
const dispatcher = require('./dispatcherClient');
await dispatcher.post('/enviar', { numero, mensaje });
```

### multipart/form-data (`/enviar-media`)

El header va en el cliente, no dentro del form:

```js
await dispatcher.post('/enviar-media', form, { headers: form.getHeaders() });
```

### PHP / Laravel

```php
Http::withHeaders(['X-API-Key' => env('DISPATCHER_API_KEY')])
    ->post(env('DISPATCHER_URL') . '/enviar', $payload);
```

### Python (requests)

```python
HEADERS = {"X-API-Key": os.environ["DISPATCHER_API_KEY"]}
requests.post(f"{DISPATCHER_URL}/enviar", json=payload, headers=HEADERS, timeout=10)
```

## Cómo probar antes del corte

Mientras el dispatcher sigue en fail-open, ambas variantes deben devolver 200:

```bash
# Sin header (fail-open actual)
curl -i -X POST $DISPATCHER_URL/enviar -H "Content-Type: application/json" \
  -d '{"numero":"5491112345678","mensaje":"test"}'

# Con header (lo que tenemos que dejar funcionando)
curl -i -X POST $DISPATCHER_URL/enviar \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $DISPATCHER_API_KEY" \
  -d '{"numero":"5491112345678","mensaje":"test"}'
```

Después del corte, la primera devuelve **401**.

## ⚠️ Importante

- `ASESOR_API_KEY` (la que **el Dispatcher** envía hacia el CRM cuando enruta mensajes) **no se toca**. Es la dirección opuesta y no entra en este cambio.
- La key nueva (`DISPATCHER_API_KEY`) es **solo** para el header de las llamadas Asesor → Dispatcher.

## Checklist

- [ ] Variables `DISPATCHER_URL` y `DISPATCHER_API_KEY` en el entorno
- [ ] Cliente HTTP centralizado mandando `X-API-Key`
- [ ] Probado en staging contra dispatcher en fail-open
- [ ] Confirmar OK al equipo de Dispatcher
- [ ] Monitoreo de 401 en el día del corte
