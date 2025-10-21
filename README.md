# WhatsApp Dispatcher - Sistema de Enrutamiento Omnicanal

Sistema robusto y escalable para enrutar mensajes de WhatsApp entre múltiples aplicaciones (bot, software de asesores, etc.) usando Redis como estado compartido.

## Características

- ✅ **Robusto**: Circuit breakers, retry logic, validaciones
- ✅ **Escalable**: Stateless design, listo para múltiples instancias
- ✅ **Observable**: Logs estructurados, métricas Prometheus, health checks
- ✅ **Seguro**: Helmet, CORS, rate limiting, validación de entrada
- ✅ **Dockerizado**: Listo para producción con Docker/Docker Compose
- ✅ **Clean Code**: Arquitectura modular y mantenible

## Arquitectura

```
┌─────────────────────────────────────────────────┐
│              WhatsApp Cloud API                 │
└────────────────────┬────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────┐
│           DISPATCHER (Node.js + Redis)          │
│  • Circuit Breakers                             │
│  • Retry Logic                                  │
│  • Rate Limiting                                │
│  • Métricas Prometheus                          │
└──────────┬──────────────────────────┬───────────┘
           │                          │
           ↓                          ↓
    ┌─────────────┐          ┌──────────────────┐
    │  BOT (3000) │          │ SOFTWARE (4000)  │
    └─────────────┘          └──────────────────┘
```

## Inicio Rápido

### Prerequisitos

- Node.js 18+
- Docker y Docker Compose
- Token de WhatsApp Business API

### Instalación

1. **Clonar o crear el proyecto**

```bash
cd dispatcher_omnicanalidad
```

2. **Instalar dependencias**

```bash
npm install
```

3. **Configurar variables de entorno**

```bash
cp .env.example .env
# Editar .env con tus credenciales
```

4. **Levantar Redis**

```bash
npm run docker:up
```

5. **Iniciar en desarrollo**

```bash
npm run dev
```

## Configuración

### Variables de Entorno (.env)

```bash
# Servidor
NODE_ENV=production
PORT=8080

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# WhatsApp
WHATSAPP_TOKEN=tu_token_aqui
PHONE_NUMBER_ID=tu_phone_id
VERIFY_TOKEN=token_verificacion

# Aplicaciones (formato: nombre|url|prioridad)
BOT_APP=BOT|http://localhost:3000|1
ASESOR_APP=SOFTWARE_ASESORES|http://localhost:4000|2

# Seguridad
API_KEY=tu_api_key_secreta
```

## Estructura del Proyecto

```
dispatcher/
├── src/
│   ├── config/          # Configuración
│   ├── middlewares/     # Middlewares Express
│   ├── services/        # Lógica de negocio
│   ├── routes/          # Rutas HTTP
│   ├── validators/      # Schemas Joi
│   ├── utils/           # Utilidades (logger, circuit breaker, retry, metrics)
│   └── index.js         # Entry point
├── tests/               # Tests
├── logs/                # Logs
├── .env.example         # Ejemplo de configuración
├── Dockerfile           # Docker image
├── docker-compose.yml   # Docker Compose
└── package.json         # Dependencias
```

## API Endpoints

### Públicos

- `GET /health` - Health check
- `GET /webhook` - Verificación de WhatsApp
- `POST /webhook` - Recibir mensajes de WhatsApp

### Protegidos (requieren API Key en header `X-API-Key`)

- `POST /enviar` - Enviar mensaje a WhatsApp
- `POST /transferir` - Transferir conversación a otra app
- `POST /finalizar/:numero` - Finalizar conversación
- `GET /estado` - Ver estado del sistema
- `GET /metrics` - Métricas Prometheus

### Ejemplos

**Enviar mensaje:**

```bash
curl -X POST http://localhost:8080/enviar \
  -H "Content-Type: application/json" \
  -H "X-API-Key: tu_api_key" \
  -d '{
    "numero": "5493512345678",
    "mensaje": "Hola desde el dispatcher"
  }'
```

**Transferir conversación:**

```bash
curl -X POST http://localhost:8080/transferir \
  -H "Content-Type: application/json" \
  -H "X-API-Key: tu_api_key" \
  -d '{
    "numero": "5493512345678",
    "app_destino": "asesor",
    "contexto": {
      "razon": "Cliente solicitó hablar con un asesor"
    }
  }'
```

**Ver estado:**

```bash
curl http://localhost:8080/estado \
  -H "X-API-Key: tu_api_key"
```

## Docker

### Desarrollo

```bash
# Levantar servicios
docker-compose up -d

# Ver logs
docker-compose logs -f dispatcher

# Bajar servicios
docker-compose down
```

### Producción

```bash
# Build
docker-compose -f docker-compose.prod.yml build

# Deploy
docker-compose -f docker-compose.prod.yml up -d

# Escalar
docker-compose -f docker-compose.prod.yml up -d --scale dispatcher=3
```

## Testing

```bash
# Todos los tests
npm test

# Solo unitarios
npm run test:unit

# Con coverage
npm test -- --coverage

# Watch mode
npm run test:watch
```

## Monitoreo

### Logs

```bash
# Logs en tiempo real
tail -f logs/dispatcher.log

# Errores
tail -f logs/error.log

# Con Docker
docker-compose logs -f dispatcher
```

### Métricas

Acceder a `http://localhost:8080/metrics` para ver métricas de Prometheus.

Métricas disponibles:
- `dispatcher_mensajes_recibidos_total` - Mensajes recibidos por app
- `dispatcher_mensajes_enviados_total` - Mensajes enviados
- `dispatcher_transferencias_total` - Transferencias entre apps
- `dispatcher_http_request_duration_seconds` - Latencia de requests
- Y más...

### Health Checks

```bash
# Health general
curl http://localhost:8080/health

# Liveness (Kubernetes)
curl http://localhost:8080/health/live

# Readiness (Kubernetes)
curl http://localhost:8080/health/ready
```

## Scripts Disponibles

```bash
npm start          # Producción
npm run dev        # Desarrollo con nodemon
npm test           # Tests
npm run lint       # Linter
npm run format     # Formatear código
npm run docker:up  # Levantar Docker
```

## Troubleshooting

### Dispatcher no arranca

```bash
# Verificar Redis
docker ps | grep redis

# Ver logs
npm run dev

# Verificar .env
cat .env | grep REDIS
```

### Apps no reciben mensajes

```bash
# Verificar que la app esté corriendo
curl http://localhost:3000

# Ver routing en Redis
docker exec -it dispatcher-redis redis-cli
> KEYS routing:*
> GET routing:5493512345678
```

### Mensajes no llegan a WhatsApp

```bash
# Verificar configuración
curl http://localhost:8080/health

# Ver logs de error
tail -f logs/error.log

# Test manual
curl -X POST http://localhost:8080/enviar \
  -H "Content-Type: application/json" \
  -H "X-API-Key: tu_api_key" \
  -d '{"numero":"tu_numero","mensaje":"test"}'
```

## Contribuir

1. Fork el proyecto
2. Crear branch de feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit cambios (`git commit -am 'Agregar nueva funcionalidad'`)
4. Push al branch (`git push origin feature/nueva-funcionalidad`)
5. Crear Pull Request

## Licencia

ISC

## Soporte

Para issues y preguntas, abrir un issue en el repositorio.
