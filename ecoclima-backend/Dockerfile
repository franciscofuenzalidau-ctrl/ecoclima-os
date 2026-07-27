FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for tsc)
RUN npm install

# Copy all source files
COPY . .

# Compile TypeScript to JavaScript
RUN npm run build

# Set the port environment variable
ENV PORT 8080
EXPOSE 8080

# Run the backend
CMD ["node", "dist/index.js"]
