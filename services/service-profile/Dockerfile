FROM node:22-alpine AS runner
WORKDIR /app

COPY package*.json ./
COPY packages/ ./packages/
COPY services/service-profile/ ./services/service-profile/

WORKDIR /app/services/service-profile
EXPOSE 4005
CMD ["npm", "run", "dev"]

