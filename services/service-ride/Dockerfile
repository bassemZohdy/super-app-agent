FROM node:22-alpine AS runner
WORKDIR /app
COPY package*.json ./
COPY services/service-ride/ ./services/service-ride/
WORKDIR /app/services/service-ride
EXPOSE 4001
CMD ["npm", "run", "dev"]
