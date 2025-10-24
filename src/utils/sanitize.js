/**
 * Utilidades para sanitizar datos sensibles en logs y outputs
 * Previene la exposición de tokens, API keys y otros secrets
 */

/**
 * Sanitizar headers HTTP para logging seguro
 * Oculta Authorization, API Keys y otros headers sensibles
 *
 * @param {Object} headers - Headers HTTP
 * @returns {Object} Headers sanitizados
 */
function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') {
    return headers;
  }

  const sanitized = { ...headers };

  // Lista de headers sensibles a sanitizar
  const sensitiveHeaders = [
    'authorization',
    'x-api-key',
    'x-hub-signature',
    'x-hub-signature-256',
    'cookie',
    'set-cookie',
  ];

  // Sanitizar cada header sensible
  sensitiveHeaders.forEach((header) => {
    const lowerHeader = header.toLowerCase();

    // Buscar header (case-insensitive)
    Object.keys(sanitized).forEach((key) => {
      if (key.toLowerCase() === lowerHeader) {
        sanitized[key] = '***REDACTED***';
      }
    });
  });

  return sanitized;
}

/**
 * Sanitizar token mostrando solo primeros y últimos caracteres
 * Útil para debugging sin exponer el token completo
 *
 * @param {string} token - Token a sanitizar
 * @param {number} showChars - Caracteres a mostrar al inicio y final (default: 4)
 * @returns {string} Token sanitizado
 */
function sanitizeToken(token, showChars = 4) {
  if (!token || typeof token !== 'string') {
    return '***';
  }

  // Si el token es muy corto, ocultar completamente
  if (token.length < showChars * 3) {
    return '***REDACTED***';
  }

  // Mostrar primeros y últimos caracteres
  const start = token.substring(0, showChars);
  const end = token.substring(token.length - showChars);

  return `${start}...${end}`;
}

/**
 * Sanitizar URL ocultando query parameters sensibles
 * Útil para loggear URLs sin exponer tokens en query strings
 *
 * @param {string} url - URL a sanitizar
 * @returns {string} URL sanitizada
 */
function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') {
    return url;
  }

  try {
    const urlObj = new URL(url);

    // Lista de query params sensibles
    const sensitiveParams = ['token', 'api_key', 'apikey', 'secret', 'password', 'key'];

    // Sanitizar query params
    sensitiveParams.forEach((param) => {
      if (urlObj.searchParams.has(param)) {
        urlObj.searchParams.set(param, '***REDACTED***');
      }
    });

    return urlObj.toString();
  } catch (error) {
    // Si no es una URL válida, retornar tal cual
    return url;
  }
}

/**
 * Sanitizar objeto completo recursivamente
 * Busca y oculta campos sensibles en objetos anidados
 *
 * @param {Object} obj - Objeto a sanitizar
 * @param {Array} sensitiveKeys - Lista de keys sensibles (default: comunes)
 * @returns {Object} Objeto sanitizado
 */
function sanitizeObject(obj, sensitiveKeys = null) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  // Keys sensibles por defecto
  const defaultSensitiveKeys = [
    'password',
    'token',
    'api_key',
    'apikey',
    'apiKey',
    'secret',
    'authorization',
    'auth',
    'whatsapp_token',
    'app_secret',
  ];

  const keysToSanitize = sensitiveKeys || defaultSensitiveKeys;
  const sanitized = Array.isArray(obj) ? [...obj] : { ...obj };

  Object.keys(sanitized).forEach((key) => {
    const lowerKey = key.toLowerCase();

    // Si es un key sensible, sanitizar
    if (keysToSanitize.some((sensitive) => lowerKey.includes(sensitive.toLowerCase()))) {
      sanitized[key] = '***REDACTED***';
    }
    // Si es un objeto anidado, sanitizar recursivamente
    else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeObject(sanitized[key], keysToSanitize);
    }
  });

  return sanitized;
}

/**
 * Sanitizar error para logging seguro
 * Oculta información sensible en stack traces y mensajes
 *
 * @param {Error} error - Error a sanitizar
 * @returns {Object} Error sanitizado para logging
 */
function sanitizeError(error) {
  if (!error) {
    return error;
  }

  return {
    message: error.message,
    name: error.name,
    code: error.code,
    status: error.response?.status,
    statusText: error.response?.statusText,
    // Sanitizar response data si existe
    responseData: error.response?.data ? sanitizeObject(error.response.data) : undefined,
    // Sanitizar config si existe
    config: error.config
      ? {
          method: error.config.method,
          url: sanitizeUrl(error.config.url),
          headers: sanitizeHeaders(error.config.headers),
        }
      : undefined,
  };
}

module.exports = {
  sanitizeHeaders,
  sanitizeToken,
  sanitizeUrl,
  sanitizeObject,
  sanitizeError,
};
