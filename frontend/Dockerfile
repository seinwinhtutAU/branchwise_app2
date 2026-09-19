# Stage 1: Build Web SPA
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json ./

# Install dependencies (skipping Electron native scripts)
RUN npm ci --ignore-scripts

# Copy frontend source code and configs
COPY vite.web.config.ts ./
COPY tailwind.config.ts ./
COPY postcss.config.cjs ./
COPY tsconfig.json ./
COPY tsconfig.web.json ./
COPY tsconfig.node.json ./
COPY frontend/ ./frontend/

# Optional build argument for API URL
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# Build web distribution into dist-web
RUN npm run build:web

# Stage 2: Serve using Nginx
FROM nginx:alpine AS runner

# Copy built assets
COPY --from=builder /app/dist-web /usr/share/nginx/html

# Copy Nginx configuration
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
