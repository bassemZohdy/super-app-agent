FROM node:22-alpine AS runner
WORKDIR /app

COPY package*.json ./
COPY packages/ ./packages/
COPY services/agent-core/ ./services/agent-core/

WORKDIR /app/services/agent-core
EXPOSE 4000
CMD ["npm", "run", "dev"]
