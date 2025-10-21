const promClient = require('prom-client');

/**
 * Métricas de Prometheus para observabilidad
 */

// Crear registro de métricas
const register = new promClient.Registry();

// Métricas por defecto (CPU, memoria, GC, etc.)
promClient.collectDefaultMetrics({
  register,
  prefix: 'dispatcher_',
});

// === Métricas Custom ===

// Duración de requests HTTP
const httpRequestDuration = new promClient.Histogram({
  name: 'dispatcher_http_request_duration_seconds',
  help: 'Duración de requests HTTP en segundos',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

// Mensajes recibidos
const mensajesRecibidos = new promClient.Counter({
  name: 'dispatcher_mensajes_recibidos_total',
  help: 'Total de mensajes recibidos de WhatsApp',
  labelNames: ['app'],
  registers: [register],
});

// Mensajes enviados
const mensajesEnviados = new promClient.Counter({
  name: 'dispatcher_mensajes_enviados_total',
  help: 'Total de mensajes enviados a WhatsApp',
  labelNames: ['status'],
  registers: [register],
});

// Transferencias entre apps
const transferencias = new promClient.Counter({
  name: 'dispatcher_transferencias_total',
  help: 'Total de transferencias entre aplicaciones',
  labelNames: ['origen', 'destino'],
  registers: [register],
});

// Finalizaciones
const finalizaciones = new promClient.Counter({
  name: 'dispatcher_finalizaciones_total',
  help: 'Total de conversaciones finalizadas',
  registers: [register],
});

// Errores de Redis
const erroresRedis = new promClient.Counter({
  name: 'dispatcher_redis_errores_total',
  help: 'Errores de conexión/operación con Redis',
  labelNames: ['operation'],
  registers: [register],
});

// Errores de WhatsApp API
const erroresWhatsApp = new promClient.Counter({
  name: 'dispatcher_whatsapp_errores_total',
  help: 'Errores de la API de WhatsApp',
  labelNames: ['type'],
  registers: [register],
});

// Errores de apps externas
const erroresApps = new promClient.Counter({
  name: 'dispatcher_apps_errores_total',
  help: 'Errores al comunicarse con apps externas',
  labelNames: ['app', 'error_type'],
  registers: [register],
});

// Gauge de conversaciones activas
const conversacionesActivas = new promClient.Gauge({
  name: 'dispatcher_conversaciones_activas',
  help: 'Número de conversaciones activas actualmente',
  registers: [register],
});

// Circuit breaker estados
const circuitBreakerState = new promClient.Gauge({
  name: 'dispatcher_circuit_breaker_state',
  help: 'Estado del circuit breaker (0=closed, 1=open, 2=half-open)',
  labelNames: ['breaker_name'],
  registers: [register],
});

// Rate limit hits
const rateLimitHits = new promClient.Counter({
  name: 'dispatcher_rate_limit_hits_total',
  help: 'Total de requests bloqueados por rate limiting',
  labelNames: ['ip'],
  registers: [register],
});

/**
 * Middleware para medir duración de requests
 */
function measureHttpDuration(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    httpRequestDuration
      .labels(req.method, req.route?.path || req.path, res.statusCode)
      .observe(duration);
  });

  next();
}

module.exports = {
  register,
  httpRequestDuration,
  mensajesRecibidos,
  mensajesEnviados,
  transferencias,
  finalizaciones,
  erroresRedis,
  erroresWhatsApp,
  erroresApps,
  conversacionesActivas,
  circuitBreakerState,
  rateLimitHits,
  measureHttpDuration,
};
