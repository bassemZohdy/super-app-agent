FROM node:22-alpine AS runner
WORKDIR /app

COPY package*.json ./
COPY packages/ ./packages/
COPY services/agent-gateway/ ./services/agent-gateway/

WORKDIR /app/services/agent-gateway
EXPOSE 4000
CMD ["npm", "run", "dev"]
