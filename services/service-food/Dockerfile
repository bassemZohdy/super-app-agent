FROM node:22-alpine AS runner
WORKDIR /app
COPY package*.json ./
COPY services/service-food/ ./services/service-food/
WORKDIR /app/services/service-food
EXPOSE 4002
CMD ["npm", "run", "dev"]
