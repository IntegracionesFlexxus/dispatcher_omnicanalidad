const winston = require('winston');
const config = require('../config');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Logger centralizado usando Winston
 * Logs estructurados en JSON para producción, coloridos para desarrollo
 */

// Crear carpeta de logs si no existe
const logDir = path.dirname(config.log.file);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Formato personalizado para desarrollo
const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    // Si el mensaje contiene saltos de línea (cajas), no agregar timestamp a cada línea
    if (message.includes('\n')) {
      // Para mensajes multilínea (cajas), solo agregar timestamp al inicio
      const lines = message.split('\n');
      const firstLine = `${timestamp} [${level}]: ${lines[0]}`;
      const restLines = lines.slice(1).map(line => `${' '.repeat(timestamp.length + level.length + 6)}${line}`);
      return [firstLine, ...restLines].join('\n');
    }

    // Para mensajes normales
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Formato para producción (JSON estructurado)
const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Logger principal
const logger = winston.createLogger({
  level: config.log.level,
  format: config.isProduction() ? prodFormat : devFormat,
  defaultMeta: {
    service: 'dispatcher',
    hostname: os.hostname(),
    pid: process.pid,
  },
  transports: [
    // Archivo de logs general
    new winston.transports.File({
      filename: config.log.file,
      maxsize: 10485760, // 10MB
      maxFiles: 10,
      tailable: true,
    }),
    // Archivo de errores separado
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10485760,
      maxFiles: 10,
      tailable: true,
    }),
  ],
  // No salir en errores no manejados
  exitOnError: false,
});

// En desarrollo, también mostrar en consola
if (!config.isProduction()) {
  logger.add(
    new winston.transports.Console({
      format: devFormat,
    })
  );
}

// Capturar excepciones no manejadas
logger.exceptions.handle(
  new winston.transports.File({ filename: 'logs/exceptions.log' })
);

// Capturar promesas rechazadas
logger.rejections.handle(
  new winston.transports.File({ filename: 'logs/rejections.log' })
);

/**
 * Logger con contexto (agregar requestId u otros metadatos)
 * @param {Object} context - Contexto adicional
 * @returns {Object} Logger con contexto
 */
function createContextLogger(context = {}) {
  return logger.child(context);
}

module.exports = logger;
module.exports.createContextLogger = createContextLogger;
