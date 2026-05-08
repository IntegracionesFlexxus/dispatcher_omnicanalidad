# Integración con `X-API-Key` al Dispatcher — Equipo Bot

## Contexto

El Dispatcher Omnicanal va a exigir autenticación por API Key. Hoy está en *fail-open* (acepta sin key); pronto va a devolver 401 a cualquier request sin `X-API-Key`. El bot tiene que sumar el header **antes** del corte.

## Variables de entorno a agregar

```env
DISPATCHER_URL=http://<host-o-ip-interna>:8082
DISPATCHER_API_KEY=<entregada-por-canal-seguro>
```

> URL interna (LAN), no el subdominio público. Key por canal seguro, no commitear.

## Endpoints del Dispatcher que el Bot consume

Todos requieren `X-API-Key`:

| Método | Path | Uso |
|---|---|---|
| `POST` | `/enviar` | Responder al usuario (texto / botones / lista) |
| `POST` | `/enviar-template` | Enviar template (re-engagement, etc.) |
| `POST` | `/enviar-media` | Enviar archivo |
| `POST` | `/transferir` | Escalar conversación al asesor |
| `POST` | `/finalizar/:numero` | Cerrar conversación si corresponde |

> Si el Bot **solo** recibe webhooks del Dispatcher y no le devuelve llamadas HTTP, no hace falta este cambio. Confirmar internamente qué llamadas salientes existen hoy.

## Cómo agregar el header

### Node.js (axios)

```js
const dispatcher = axios.create({
  baseURL: process.env.DISPATCHER_URL,
  timeout: 10000,
  headers: { 'X-API-Key': process.env.DISPATCHER_API_KEY },
});

// responder al usuario
await dispatcher.post('/enviar', { numero, mensaje: 'Hola, ¿en qué te ayudo?' });

// botones
await dispatcher.post('/enviar', {
  numero,
  body_text: '¿Qué querés hacer?',
  buttons: [
    { type: 'reply', reply: { id: 'opt1', title: 'Opción 1' } },
    { type: 'reply', reply: { id: 'opt2', title: 'Opción 2' } },
  ],
});

// escalar al asesor
await dispatcher.post('/transferir', {
  numero,
  app_destino: 'asesor',
  contexto: { customer_name: 'Juan', initial_message: 'Pidió hablar con humano' },
});
```

### Python (requests)

```python
HEADERS = {"X-API-Key": os.environ["DISPATCHER_API_KEY"]}
requests.post(f"{DISPATCHER_URL}/enviar", json={"numero": numero, "mensaje": "..."},
              headers=HEADERS, timeout=10)
```

## Cómo probar antes del corte

```bash
curl -i -X POST $DISPATCHER_URL/enviar \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $DISPATCHER_API_KEY" \
  -d '{"numero":"5491112345678","mensaje":"ping desde bot"}'
```

Tras el corte, sin header → 401.

## ⚠️ Importante

- El Dispatcher hoy **no manda** API Key al Bot (en `BOT_APP` no hay key configurada). Ese sentido (Dispatcher → Bot) no se toca en este cambio.
- La key nueva (`DISPATCHER_API_KEY`) se usa **solo** para el header de Bot → Dispatcher.
- Hay un endpoint del Bot que el Dispatcher invoca (`/api/desactivar-modo-asesor`, ver `router.service.js`). Ese flujo es Dispatcher → Bot, separado de lo que estamos integrando acá.

## Checklist

- [ ] Confirmar qué llamadas Bot → Dispatcher existen hoy (puede ser que sean cero)
- [ ] Si hay alguna: variables `DISPATCHER_URL` y `DISPATCHER_API_KEY` en el entorno
- [ ] Cliente HTTP centralizado mandando `X-API-Key`
- [ ] Probado contra dispatcher en fail-open
- [ ] Confirmar OK al equipo de Dispatcher
- [ ] Monitoreo de 401 en el día del corte
