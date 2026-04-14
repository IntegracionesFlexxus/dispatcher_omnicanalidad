# ===========================
# Etapa 1: Dependencias
# ===========================
FROM node:18-alpine AS dependencies

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar solo dependencias de producción
RUN npm ci --only=production && \
    npm cache clean --force

# ===========================
# Etapa 2: Runtime
# ===========================
FROM node:18-alpine AS runtime

# Metadatos
LABEL maintainer="tu-email@example.com"
LABEL version="1.0.0"
LABEL description="WhatsApp Dispatcher - Sistema de enrutamiento omnicanal"

# Crear usuario no-root para seguridad
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copiar dependencias desde etapa anterior
COPY --from=dependencies --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copiar código fuente
COPY --chown=nodejs:nodejs package*.json ./
COPY --chown=nodejs:nodejs src ./src

# Crear directorio de logs con permisos
RUN mkdir -p logs && \
    chown -R nodejs:nodejs logs

# Cambiar a usuario no-root
USER nodejs

# Variables de entorno por defecto
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

# Exponer puerto
EXPOSE ${PORT}

# Desactivar healthcheck (Portainer/Swarm lo maneja externamente si se necesita)
HEALTHCHECK NONE

# Comando de inicio
CMD ["node", "src/index.js"]
