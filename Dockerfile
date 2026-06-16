# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy source code
COPY . .

# ---- Production stage ----
FROM node:20-alpine
WORKDIR /app

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy only the necessary files from builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .

# Use the non-root user
USER nodejs

# Expose the default port (Render injects PORT env)
EXPOSE 3000

# Start the server – it must use process.env.PORT || 3000
CMD ["node", "src/index.js"]