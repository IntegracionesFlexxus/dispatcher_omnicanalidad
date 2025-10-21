/**
 * Parser de aplicaciones desde variables de entorno
 * Lee las variables que terminan en _APP y las convierte en un objeto de configuración
 */

/**
 * Parsear aplicaciones del .env
 * @returns {Object} Objeto con configuración de apps { bot: { nombre, url, prioridad }, ... }
 */
function parseApps() {
  const apps = {};
  const envVars = Object.keys(process.env);

  envVars.forEach((key) => {
    if (key.endsWith('_APP')) {
      const value = process.env[key];

      if (!value) {
        console.warn(`⚠️  Variable ${key} está vacía`);
        return;
      }

      const parts = value.split('|');

      if (parts.length !== 3) {
        console.warn(`⚠️  Formato inválido para ${key}: debe ser "nombre|url|prioridad"`);
        return;
      }

      const [nombre, url, prioridad] = parts;
      const appKey = key.replace('_APP', '').toLowerCase();

      apps[appKey] = {
        nombre: nombre.trim(),
        url: url.trim(),
        prioridad: parseInt(prioridad) || 99,
      };
    }
  });

  if (Object.keys(apps).length === 0) {
    console.warn('⚠️  No se encontraron aplicaciones configuradas');
  }

  return apps;
}

/**
 * Validar que existe una aplicación con la key dada
 * @param {string} appKey - Key de la aplicación
 * @param {Object} apps - Objeto de aplicaciones
 * @returns {boolean}
 */
function isValidApp(appKey, apps) {
  return appKey in apps;
}

/**
 * Obtener app por key
 * @param {string} appKey - Key de la aplicación
 * @param {Object} apps - Objeto de aplicaciones
 * @returns {Object|null}
 */
function getApp(appKey, apps) {
  return apps[appKey] || null;
}

module.exports = {
  parseApps,
  isValidApp,
  getApp,
};
