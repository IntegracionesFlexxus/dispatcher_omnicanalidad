# Guía Completa de Redis para Dispatcher

## ¿Qué es Redis Password?

Redis Password es una **autenticación simple** que protege tu instancia de Redis. Por defecto, Redis NO tiene password y cualquiera puede conectarse.

---

## 🔐 Cuándo Necesitas Password

### ❌ NO necesitas password:
- **Desarrollo local** - Redis corre solo en tu máquina (localhost)
- **Docker interno** - Redis en red privada de Docker, no expuesta
- **Red privada** - Redis solo accesible dentro de tu VPC/red interna

### ✅ SÍ necesitas password:
- **Redis expuesto a internet** - Puerto 6379 abierto públicamente
- **Producción con múltiples usuarios** - Varios equipos acceden
- **Compliance/Seguridad** - Tu empresa lo requiere
- **Redis en cloud** - AWS ElastiCache, Azure Cache, etc.

---

## 🎯 Configuración por Entorno

### 1️⃣ DESARROLLO (Sin password - más simple)

#### .env
```bash
NODE_ENV=development
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=         # Vacío = sin password
REDIS_DB=0
```

#### docker-compose.yml
```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes
    # Sin password
```

#### Conectar manualmente:
```bash
# Entrar a Redis CLI
docker exec -it dispatcher-redis redis-cli

# Comandos básicos
127.0.0.1:6379> PING
PONG
127.0.0.1:6379> KEYS *
1) "routing:5493512345678"
127.0.0.1:6379> GET routing:5493512345678
"asesor"
```

---

### 2️⃣ PRODUCCIÓN (Con password - más seguro)

#### .env.production
```bash
NODE_ENV=production
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=mi_password_super_segura_123  # ← Password fuerte
REDIS_DB=0
```

#### docker-compose.prod.yml
```yaml
services:
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    # ↑ --requirepass activa la autenticación
    environment:
      - REDIS_PASSWORD=${REDIS_PASSWORD}
```

#### Conectar manualmente CON password:
```bash
# Opción 1: Con -a
docker exec -it dispatcher-redis redis-cli -a "mi_password_super_segura_123"

# Opción 2: Autenticar después
docker exec -it dispatcher-redis redis-cli
127.0.0.1:6379> AUTH mi_password_super_segura_123
OK
127.0.0.1:6379> PING
PONG
```

---

## 🛠️ Cómo Funciona en el Código

### Código del Dispatcher (src/services/redis.service.js)

```javascript
// Ya está implementado en tu código
const client = redis.createClient({
  socket: {
    host: config.redis.host,      // localhost o redis
    port: config.redis.port,       // 6379
  },
  password: config.redis.password, // ← undefined si está vacío en .env
  database: config.redis.db,       // 0
});
```

**Cómo funciona:**
- Si `REDIS_PASSWORD` está **vacío** en .env → `password: undefined` → Sin autenticación ✅
- Si `REDIS_PASSWORD` tiene valor → `password: "tu_password"` → Con autenticación ✅

**¡No necesitas cambiar código!** Solo cambiar el `.env`

---

## 📝 Guía Paso a Paso

### Escenario 1: Desarrollo Local (SIN password)

**1. Crear .env**
```bash
cp .env.example .env
```

**2. Editar .env**
```bash
# .env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=              # ← Dejar vacío (o comentar la línea)
```

**3. Levantar Redis**
```bash
npm run docker:up
```

**4. Verificar conexión**
```bash
# Probar Redis CLI
docker exec -it dispatcher-redis redis-cli ping
# Debe responder: PONG

# Iniciar dispatcher
npm run dev
# Debe ver en logs: "✅ Redis conectado y listo"
```

**5. Ver datos en Redis**
```bash
docker exec -it dispatcher-redis redis-cli

# Ver todas las keys
127.0.0.1:6379> KEYS *

# Ver routing de un número
127.0.0.1:6379> GET routing:5493512345678

# Ver estadísticas
127.0.0.1:6379> KEYS stats:*
127.0.0.1:6379> GET stats:mensajes_total
```

---

### Escenario 2: Producción (CON password)

**1. Crear .env.production**
```bash
cp .env.example .env.production
```

**2. Editar .env.production**
```bash
# .env.production
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=P@ssw0rd_Segur0_2024!   # ← Password fuerte
```

**3. Generar password segura**
```bash
# En Linux/Mac
openssl rand -base64 32

# En Windows (PowerShell)
Add-Type -AssemblyName System.Web
[System.Web.Security.Membership]::GeneratePassword(32, 10)

# O usar generador online: https://passwordsgenerator.net/
```

**4. Actualizar docker-compose.prod.yml** (ya está hecho)
```yaml
redis:
  command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
```

**5. Levantar producción**
```bash
export REDIS_PASSWORD="P@ssw0rd_Segur0_2024!"  # En Linux/Mac
# o
set REDIS_PASSWORD=P@ssw0rd_Segur0_2024!        # En Windows

docker-compose -f docker-compose.prod.yml up -d
```

**6. Verificar conexión CON password**
```bash
# Con password en comando
docker exec -it dispatcher-redis-prod redis-cli -a "P@ssw0rd_Segur0_2024!" ping

# O autenticar manualmente
docker exec -it dispatcher-redis-prod redis-cli
127.0.0.1:6379> AUTH P@ssw0rd_Segur0_2024!
OK
127.0.0.1:6379> PING
PONG
```

---

## 🔍 Troubleshooting

### Error: "NOAUTH Authentication required"

**Problema:** Redis tiene password pero no la proporcionaste.

**Solución:**
```bash
# 1. Verificar que .env tiene password
cat .env | grep REDIS_PASSWORD

# 2. Verificar que Redis la requiere
docker exec -it dispatcher-redis redis-cli CONFIG GET requirepass

# 3. Conectar con password correcta
docker exec -it dispatcher-redis redis-cli -a "tu_password"
```

---

### Error: "ERR invalid password"

**Problema:** Password incorrecta.

**Solución:**
```bash
# 1. Ver qué password tiene Redis
docker exec -it dispatcher-redis redis-cli CONFIG GET requirepass

# 2. Actualizar .env con la password correcta
nano .env

# 3. Reiniciar dispatcher
npm run dev
```

---

### Error: "WRONGPASS invalid username-password pair"

**Problema:** Redis 6+ usa ACL (usuarios), no solo password.

**Solución:**
```bash
# Usar usuario default
docker exec -it dispatcher-redis redis-cli -a "tu_password"

# O especificar usuario
docker exec -it dispatcher-redis redis-cli --user default --pass "tu_password"
```

---

## 🎯 Comandos Útiles de Redis

### Ver configuración
```bash
# Ver si tiene password
redis-cli CONFIG GET requirepass

# Ver todas las configuraciones
redis-cli CONFIG GET *
```

### Monitorear en tiempo real
```bash
# Ver todos los comandos que se ejecutan
redis-cli MONITOR

# Ver info de memoria y conexiones
redis-cli INFO

# Ver estadísticas
redis-cli INFO stats
```

### Gestionar datos
```bash
# Ver todas las keys
redis-cli KEYS *

# Contar keys
redis-cli DBSIZE

# Ver TTL de una key
redis-cli TTL routing:5493512345678

# Eliminar una key
redis-cli DEL routing:5493512345678

# Eliminar TODAS las keys (⚠️ PELIGROSO)
redis-cli FLUSHALL
```

---

## 📋 Checklist de Seguridad Redis

### Desarrollo:
- [ ] Redis solo en localhost (no expuesto)
- [ ] Password opcional (puede estar vacío)
- [ ] Puerto 6379 NO abierto en firewall

### Producción:
- [ ] Password fuerte (mínimo 20 caracteres)
- [ ] Password en variable de entorno (NO hardcodeada)
- [ ] Redis NO expuesto a internet público
- [ ] Solo accesible desde red privada/VPC
- [ ] Backups configurados (AOF + RDB)
- [ ] Monitoreo activo (memoria, conexiones)

---

## 🚀 Recomendación Final

### Para tu caso (Dispatcher):

**Desarrollo:**
```bash
# .env
REDIS_PASSWORD=     # Vacío - más simple
```

**Producción:**
```bash
# .env.production
REDIS_PASSWORD=TuPasswordSeguraAqui123!
```

**¿Por qué?**
- En desarrollo: Simplicidad, velocidad
- En producción: Seguridad, compliance

**El código ya soporta ambos escenarios automáticamente.** Solo cambia el `.env` según tu entorno.

---

## ❓ Preguntas Frecuentes

### ¿Puedo usar la misma password en dev y prod?
**No recomendado.** Usa passwords diferentes por entorno.

### ¿Dónde guardo la password de producción?
**Opciones:**
1. Variables de entorno del servidor
2. Secrets manager (AWS Secrets Manager, Azure Key Vault)
3. Archivo .env.production (NO commitearlo a Git)

### ¿Qué pasa si olvido la password de Redis?
Si tienes acceso al contenedor:
```bash
# Reiniciar Redis sin password
docker exec -it dispatcher-redis redis-server --port 6380
# Luego cambiar password con CONFIG SET requirepass nueva_password
```

### ¿Redis tiene más seguridad además de password?
Sí, Redis 6+ tiene **ACL** (Access Control Lists):
- Múltiples usuarios
- Permisos granulares por comando
- Más complejo, usar solo si lo necesitas

---

¿Necesitas ayuda con algún escenario específico?
