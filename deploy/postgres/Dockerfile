FROM timescale/timescaledb:2.17.2-pg16

# Compile PostGIS against this image's Postgres. The Alpine postgis package
# targets a different major version and will not load.
# STUB: pgaudit is not packaged for this base image.
USER root
RUN apk add --no-cache geos proj json-c libxml2 protobuf-c \
    && apk add --no-cache --virtual .build-deps \
        build-base \
        geos-dev \
        proj-dev \
        protobuf-c-dev \
        json-c-dev \
        libxml2-dev \
        perl \
        wget \
    && wget -q -O /tmp/postgis.tar.gz https://download.osgeo.org/postgis/source/postgis-3.5.2.tar.gz \
    && tar -xzf /tmp/postgis.tar.gz -C /tmp \
    && cd /tmp/postgis-3.5.2 \
    && ./configure --with-pgconfig=/usr/local/bin/pg_config --without-raster \
    && make -j"$(nproc)" with_llvm=no \
    && make install with_llvm=no \
    && cd / \
    && rm -rf /tmp/postgis-3.5.2 /tmp/postgis.tar.gz \
    && apk del .build-deps
