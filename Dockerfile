FROM node:22-slim

WORKDIR /app

# Install Vietnamese-capable fonts for PDFKit reports
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4100

EXPOSE 4100

CMD ["npm", "start"]
