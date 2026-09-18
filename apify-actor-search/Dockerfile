# Google Search SERP Scraper
# Node 20, Apify's own base image (pre-cached on their build servers).
FROM apify/actor-node:20

COPY package*.json ./
RUN npm install --include=dev --audit=false

COPY . ./
RUN npm run build \
 && npm prune --omit=dev --audit=false

CMD ["npm", "start", "--silent"]
