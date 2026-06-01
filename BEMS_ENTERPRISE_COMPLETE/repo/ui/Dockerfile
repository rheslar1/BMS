FROM ubuntu:22.04

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=${VITE_API_URL}

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg apache2 \
    && install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && a2enmod rewrite headers \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build \
    && rm -rf /var/www/html/* \
    && cp -r dist/* /var/www/html/ \
    && printf '%s\n' \
      '<VirtualHost *:80>' \
      '  DocumentRoot /var/www/html' \
      '  <Directory /var/www/html>' \
      '    Options -Indexes +FollowSymLinks' \
      '    AllowOverride None' \
      '    Require all granted' \
      '    RewriteEngine On' \
      '    RewriteCond %{REQUEST_FILENAME} !-f' \
      '    RewriteCond %{REQUEST_FILENAME} !-d' \
      '    RewriteRule ^ /index.html [L]' \
      '  </Directory>' \
      '  Header always set X-Content-Type-Options "nosniff"' \
      '  Header always set X-Frame-Options "SAMEORIGIN"' \
      '</VirtualHost>' \
      > /etc/apache2/sites-available/000-default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -fsS http://localhost/ || exit 1
CMD ["apachectl", "-D", "FOREGROUND"]
