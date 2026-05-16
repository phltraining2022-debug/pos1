FROM node:18-alpine
WORKDIR /usr/src/app

# Install dependencies
COPY app/package.json ./
# Use npm install when package-lock.json may be missing in the app folder.
# `npm ci` requires a package-lock.json; using `npm install --production` is more robust for this example.
RUN npm install --only=production

# Copy app
COPY app/ ./

ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
