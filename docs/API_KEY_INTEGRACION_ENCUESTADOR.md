# Integración con `X-API-Key` al Dispatcher — Equipo Encuestador

## Contexto

El Dispatcher Omnicanal va a exigir autenticación por API Key en todos sus endpoints. Hoy acepta requests sin key (*fail-open*); en una ventana próxima va a rechazar con 401 todo request que no traiga el header `X-API-Key`. El Encuestador tiene que sumar el header **antes** del corte.

## Variables de entorno a agregar

```env
DISPATCHER_URL=http://<host-o-ip-interna>:8082
DISPATCHER_API_KEY=<entregada-por-canal-seguro>
```

> URL interna (LAN). La key llega por Bitwarden/Vault, no se commitea.

## Endpoints del Dispatcher que el Encuestador consume

Todos requieren `X-API-Key`:

| Método | Path | Uso |
|---|---|---|
| `POST` | `/encuesta/iniciar/:numero` | Marcar inicio de encuesta (side-track con TTL) |
| `POST` | `/encuesta/finalizar/:numero` | Cerrar encuesta + activar cooldown |
| `POST` | `/enviar` | Si el encuestador manda WhatsApp directo |
| `POST` | `/enviar-template` | Si dispara templates desde el encuestador |

## Cómo agregar el header

### Node.js (axios)

```js
const dispatcher = axios.create({
  baseURL: process.env.DISPATCHER_URL,
  timeout: 10000,
  headers: { 'X-API-Key': process.env.DISPATCHER_API_KEY },
});

// iniciar encuesta
await dispatcher.post(`/encuesta/iniciar/${numero}`, {
  survey_instance_id: 123,
  phase: 'opening',
  ttl_seconds: 600,
});

// finalizar encuesta
await dispatcher.post(`/encuesta/finalizar/${numero}`, {
  motivo: 'completada',
  survey_instance_id: 123,
  mensaje_despedida: true,
});
```

### Python (requests)

```python
HEADERS = {"X-API-Key": os.environ["DISPATCHER_API_KEY"]}
requests.post(
  f"{DISPATCHER_URL}/encuesta/iniciar/{numero}",
  json={"survey_instance_id": 123, "phase": "opening"},
  headers=HEADERS, timeout=10,
)
```

## Cómo probar antes del corte

```bash
# Con header — debe seguir funcionando igual que sin header (fail-open)
curl -i -X POST $DISPATCHER_URL/encuesta/iniciar/5491112345678 \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $DISPATCHER_API_KEY" \
  -d '{"survey_instance_id":123,"phase":"opening"}'
```

Tras el corte, sin header → 401.

## ⚠️ Importante

- `ENCUESTADOR_API_KEY` (la que el **Dispatcher** envía al encuestador cuando enruta mensajes y consulta `/status`) **no se toca**. Sigue igual.
- La key nueva (`DISPATCHER_API_KEY`) se usa **solo** para el header en llamadas Encuestador → Dispatcher.
- Hay dos endpoints distintos por dirección:
  - El Encuestador expone `/api/dispatcher/incoming` y `/api/dispatcher/status` (eso lo consume el Dispatcher con `ENCUESTADOR_API_KEY`).
  - El Encuestador a su vez consume `/encuesta/iniciar` y `/encuesta/finalizar` del Dispatcher (eso es lo que requiere `DISPATCHER_API_KEY`).

## Checklist

- [ ] Variables `DISPATCHER_URL` y `DISPATCHER_API_KEY` en el entorno
- [ ] Cliente HTTP centralizado mandando `X-API-Key`
- [ ] Probado contra dispatcher en fail-open
- [ ] Confirmar OK al equipo de Dispatcher
- [ ] Monitoreo de 401 en el día del corte
