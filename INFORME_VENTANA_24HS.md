# Informe: Apertura de Ventana de 24hs - WhatsApp

## Problema

WhatsApp tiene una regla de **ventana de 24 horas**: solo se pueden enviar mensajes de texto libre dentro de las 24hs posteriores al ultimo mensaje del usuario. Fuera de esa ventana, Meta rechaza el mensaje con error **131047 - Re-engagement message**.

---

## Solucion implementada en el Dispatcher

Cuando el CRM llama a `POST /enviar` o `POST /enviar-media` y la ventana de 24hs esta cerrada, el dispatcher:

1. **No envia el mensaje original** (evita el error 131047)
2. **Envia automaticamente un template de re-engagement** al usuario con botones SI / NO
3. **Retorna una respuesta diferente** al CRM indicando que el mensaje no se envio

---

## Cambio requerido en el CRM (IMPORTANTE)

### Enviar `conversation_id` en POST /enviar

El CRM **debe incluir `conversation_id`** en el body de `POST /enviar` y `POST /enviar-media`. Este campo es necesario para que cuando el usuario responda al template de re-engagement, el dispatcher pueda asociar la respuesta a la conversacion existente en el CRM.

**Antes:**
```json
{
  "numero": "5493534193971",
  "mensaje": "Hola, tenemos una novedad"
}
```

**Ahora (requerido):**
```json
{
  "numero": "5493534193971",
  "mensaje": "Hola, tenemos una novedad",
  "conversation_id": 230
}
```

El campo `conversation_id` es opcional y no rompe nada si no se envia (compatibilidad hacia atras). Pero **sin este campo, la respuesta del boton del template no se va a poder asociar a la conversacion correcta en el CRM**.

---

## Respuesta nueva del Dispatcher cuando la ventana esta cerrada

```json
{
  "ok": true,
  "tipo": "template_reengagement",
  "mensaje": "Ventana de 24hs cerrada. Se envio template de re-engagement. El mensaje se podra enviar cuando el usuario responda.",
  "ventana_reabierta": false,
  "mensaje_pendiente": true
}
```

## Respuesta normal cuando la ventana esta abierta (sin cambios)

```json
{
  "ok": true,
  "tipo": "texto",
  "mensaje": "Mensaje enviado correctamente"
}
```

---

## Que tiene que hacer el CRM

1. **Incluir `conversation_id` en POST /enviar y POST /enviar-media** (ver seccion anterior).

2. **Verificar el campo `tipo` en la respuesta de `POST /enviar`:**
   - Si `tipo` es `"texto"`, `"botones"` o `"lista"` -> el mensaje se envio normalmente, no hacer nada diferente.
   - Si `tipo` es `"template_reengagement"` -> el mensaje **NO se envio**. El usuario va a recibir un template con botones SI / NO.

3. **Cuando `tipo` es `"template_reengagement"`**, el CRM deberia:
   - Guardar el mensaje pendiente que no se pudo enviar.
   - Esperar a que el usuario responda al template (el webhook va a enviar la respuesta del boton).

4. **Cuando llega la respuesta del boton del template** (tipo `button`):
   - El campo `message` va a contener `"SI"` o `"NO"`.
   - El campo `message_type` va a ser `"button"`.
   - El campo `conversation_id` va a estar presente si el CRM lo envio en el paso 1.
   - Si el usuario respondio **"SI"** -> la ventana de 24hs se reabre. El CRM puede reenviar el mensaje pendiente llamando a `POST /enviar` nuevamente.
   - Si el usuario respondio **"NO"** -> no reenviar el mensaje.

---

## Flujo completo

```
CRM llama POST /enviar (mensaje: "Hola", conversation_id: 230)
    |
    |-- Ventana ABIERTA -> mensaje enviado normalmente
    |   Respuesta: { tipo: "texto", ok: true }
    |
    +-- Ventana CERRADA -> template enviado automaticamente
        Respuesta: { tipo: "template_reengagement", mensaje_pendiente: true }
        |
        Dispatcher guarda conversation_id: 230 para ese numero
        |
        Usuario recibe: "Hola, desde flexxus queremos contactarte.
                         Responde para continuar la conversacion"
                         [SI] [NO]
        |
        |-- Usuario apreta SI -> webhook envia al CRM:
        |   { message: "SI", message_type: "button", conversation_id: 230 }
        |   -> Ventana se reabre
        |   -> CRM puede reenviar el mensaje pendiente
        |
        +-- Usuario apreta NO -> webhook envia al CRM:
            { message: "NO", message_type: "button", conversation_id: 230 }
            -> No reenviar
```

---

## Endpoints afectados

| Endpoint | Cambio |
|---|---|
| `POST /enviar` | Acepta `conversation_id` (opcional). Verifica ventana antes de enviar |
| `POST /enviar-media` | Acepta `conversation_id` (opcional). Verifica ventana antes de enviar |
| `POST /enviar-template` | Sin cambios (los templates siempre se pueden enviar) |
| `POST /finalizar/:numero` | Si la ventana esta cerrada, no envia mensaje de despedida |

---

## Payload que recibe el CRM cuando el usuario responde al template

```json
{
  "channel_id": 1,
  "customer_phone": "5493534193971",
  "customer_name": "Christian",
  "message": "SI",
  "message_type": "button",
  "media_id": null,
  "mime_type": null,
  "filename": null,
  "raw_webhook": { "..." },
  "conversation_id": 230
}
```

---

## Datos del template

| Campo | Valor |
|---|---|
| Nombre | `abrir_conversacion` |
| Idioma | `es_AR` |
| Categoria | Marketing |
| Botones | SI / NO |
