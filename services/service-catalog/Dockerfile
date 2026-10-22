FROM node:22-alpine AS runner
WORKDIR /app
COPY package*.json ./
COPY services/service-catalog/ ./services/service-catalog/
WORKDIR /app/services/service-catalog
EXPOSE 4004
CMD ["npm", "run", "dev"]
