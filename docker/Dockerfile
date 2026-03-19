# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build && cp -r src/resources/schemas dist/resources/schemas

# Stage 2: Production
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
RUN addgroup -S mcpgroup && adduser -S mcpuser -G mcpgroup
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
USER mcpuser
EXPOSE 8080
CMD ["node", "dist/server/index.js"]
