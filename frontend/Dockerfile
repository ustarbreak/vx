# Use full Debian-based Node image
FROM node:18-bookworm AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Clean install dependencies
RUN rm -rf node_modules && npm install

# Copy source code
COPY src/ ./src/
COPY index.html vite.config.js tsconfig.json tailwind.config.js postcss.config.js ./

# Build the app
RUN npm run build

# Production stage with nginx
FROM nginx:alpine

# Copy custom nginx config
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files from builder
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
