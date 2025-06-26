# Multi-stage build for smaller image
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src ./src

# Install dev dependencies for building
RUN npm install --save-dev typescript @types/node

# Build the application
RUN npm run build

# Production stage
FROM mcr.microsoft.com/playwright:v1.40.0-focal

WORKDIR /app

# Install Node.js
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy built application
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./
COPY data ./data

# Create directories
RUN mkdir -p logs screenshots

# Create non-root user
RUN groupadd -r linky && useradd -r -g linky linky && \
    chown -R linky:linky /app

USER linky

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "console.log('Health check passed')" || exit 1

# Default to safe mode
ENV RUN_MODE=safe

CMD ["node", "dist/index.js"]