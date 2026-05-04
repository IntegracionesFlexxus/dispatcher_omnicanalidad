/**
 * Normalización de números de teléfono.
 *
 * Argentina: WhatsApp / Meta entrega los móviles con un "9" entre el código
 * de país (54) y el código de área (ej: "5493515524761"). Algunos sistemas
 * internos lo guardan o lo envían sin ese 9 (ej: "543515524761"). Si el
 * dispatcher indexa Redis con números no normalizados, la transferencia
 * y el webhook entrante usan claves distintas y el routing se pierde.
 *
 * Esta función deja siempre el formato "con 9" para AR móviles.
 * Es idempotente: aplicarla dos veces no agrega un segundo 9.
 */

/**
 * Normalizar número de teléfono.
 * - Elimina caracteres no numéricos (espacios, +, guiones)
 * - Para AR móviles ("54" + 10 dígitos sin 9): inserta el 9 después del 54
 * - Cualquier otro formato se devuelve tal cual (solo dígitos)
 *
 * @param {string|number|null|undefined} numero
 * @returns {string} número normalizado, o el input crudo si no es string/number
 */
function normalizePhone(numero) {
  if (numero === null || numero === undefined) return numero;

  const soloDigitos = String(numero).replace(/\D/g, '');

  // AR móvil sin el 9: "54" + 10 dígitos (área + abonado).
  // Con el 9 ya presente serían 13 dígitos ("549" + 10), por eso este
  // chequeo no se dispara dos veces.
  if (soloDigitos.length === 12 && soloDigitos.startsWith('54')) {
    return '549' + soloDigitos.slice(2);
  }

  return soloDigitos;
}

module.exports = { normalizePhone };
