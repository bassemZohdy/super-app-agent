FROM node:22-alpine AS runner
WORKDIR /app
COPY package*.json ./
COPY packages/ ./packages/
COPY apps/shell-react/ ./apps/shell-react/
WORKDIR /app/apps/shell-react
EXPOSE 3000
CMD ["npm", "run", "dev"]
