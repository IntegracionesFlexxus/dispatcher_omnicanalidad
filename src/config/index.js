require('dotenv').config();
const { parseApps } = require('./apps');

/**
 * Configuración centralizada de la aplicación
 * Todas las variables de entorno se leen aquí
 */

const config = {
  // Entorno y servidor
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 8080,
  HOST: process.env.HOST || '0.0.0.0',

  // Redis
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB, 10) || 0,
    timeout: parseInt(process.env.REDIS_TIMEOUT_MS, 10) || 2000,
  },

  // WhatsApp
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.PHONE_NUMBER_ID,
    verifyToken: process.env.VERIFY_TOKEN || 'default_token',
    appSecret: process.env.WHATSAPP_APP_SECRET, // Para verificar firma de webhooks
    timeout: parseInt(process.env.WHATSAPP_TIMEOUT_MS, 10) || 5000,
    reengagementTemplate: process.env.WHATSAPP_REENGAGEMENT_TEMPLATE || null,
    reengagementLanguage: process.env.WHATSAPP_REENGAGEMENT_LANGUAGE || 'es_AR',
  },

  // Aplicaciones registradas
  apps: parseApps(),

  // Configuración específica de asesor
  asesor: {
    channelId: parseInt(process.env.ASESOR_CHANNEL_ID, 10) || 1,
    apiKey: process.env.ASESOR_API_KEY || 'dev-external-key-change-in-production',
  },

  // Seguridad
  apiKey: process.env.API_KEY,

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  },

  // Logs
  log: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'logs/dispatcher.log',
  },

  // Timeouts
  appTimeout: parseInt(process.env.APP_TIMEOUT_MS, 10) || 10000,

  // Circuit Breaker
  circuitBreaker: {
    timeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT_MS, 10) || 10000,
    errorThresholdPercentage: parseInt(process.env.CIRCUIT_BREAKER_ERROR_THRESHOLD, 10) || 50,
    resetTimeout: parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT_MS, 10) || 30000,
  },

  // Helpers
  isDevelopment: () => config.NODE_ENV === 'development',
  isProduction: () => config.NODE_ENV === 'production',
  isTest: () => config.NODE_ENV === 'test',
};

/**
 * Validar configuración requerida
 */
function validateConfig() {
  const errors = [];

  if (!config.whatsapp.token) {
    errors.push('WHATSAPP_TOKEN no está configurado');
  }

  if (!config.whatsapp.phoneNumberId) {
    errors.push('PHONE_NUMBER_ID no está configurado');
  }

  if (Object.keys(config.apps).length === 0) {
    errors.push('No hay aplicaciones configuradas (variables *_APP)');
  }

  if (errors.length > 0 && config.isProduction()) {
    console.error('❌ Errores de configuración en producción:');
    errors.forEach((err) => console.error(`   - ${err}`));
    process.exit(1);
  } else if (errors.length > 0) {
    console.warn('⚠️  Advertencias de configuración:');
    errors.forEach((err) => console.warn(`   - ${err}`));
  }
}

// Validar al cargar
validateConfig();

module.exports = config;
