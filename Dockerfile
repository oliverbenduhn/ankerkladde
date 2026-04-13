FROM php:8.3-apache

# PHP-Extensions
RUN apt-get update \
    && apt-get install -y \
        ca-certificates \
        curl \
        libcurl4-openssl-dev \
        libsqlite3-dev \
        libpng-dev \
        libjpeg-dev \
        libwebp-dev \
    && docker-php-ext-configure gd --with-jpeg --with-webp \
    && docker-php-ext-install curl pdo pdo_sqlite gd mbstring \
    && rm -rf /var/lib/apt/lists/*

# Apache-Module aktivieren
RUN a2enmod rewrite headers

# DocumentRoot → public/
COPY deploy/docker/ankerkladde.conf /etc/apache2/sites-available/000-default.conf

# Datenpfad für SQLite (wird als Volume gemountet)
ENV EINKAUF_DATA_DIR=/data
RUN mkdir -p /data && chown www-data:www-data /data
VOLUME /data

# App-Code kopieren
COPY . /var/www/html/

# Berechtigungen setzen
RUN chown -R www-data:www-data /var/www/html     && chmod -R 755 /var/www/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3     CMD curl -fsS http://localhost/healthz || exit 1
