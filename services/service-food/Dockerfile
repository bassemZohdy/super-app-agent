FROM node:24-alpine
WORKDIR /app
COPY . .
RUN npm ci --omit=dev --ignore-scripts
EXPOSE 4002
CMD ["node", "--experimental-strip-types", "services/service-food/src/index.ts"]
