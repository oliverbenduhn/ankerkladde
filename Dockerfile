FROM php:8.1-apache

# PHP-Extensions für SQLite
RUN apt-get update \
    && apt-get install -y libsqlite3-dev \
    && docker-php-ext-install pdo pdo_sqlite \
    && rm -rf /var/lib/apt/lists/*

# Apache-Module aktivieren
RUN a2enmod rewrite headers

# DocumentRoot → public/
COPY deploy/docker/einkauf.conf /etc/apache2/sites-available/000-default.conf

# Datenpfad für SQLite (wird als Volume gemountet)
ENV EINKAUF_DATA_DIR=/data
RUN mkdir -p /data && chown www-data:www-data /data
VOLUME /data

# App-Code kopieren
COPY . /var/www/html/

# Berechtigungen setzen
RUN chown -R www-data:www-data /var/www/html \
    && chmod -R 755 /var/www/html

EXPOSE 80
