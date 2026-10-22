FROM node:22-alpine AS runner
WORKDIR /app
COPY package*.json ./
COPY services/service-wallet/ ./services/service-wallet/
WORKDIR /app/services/service-wallet
EXPOSE 4003
CMD ["npm", "run", "dev"]
