FROM node:24-alpine
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts
WORKDIR /app/apps/shell-react
EXPOSE 3000
CMD ["npm", "run", "dev"]
