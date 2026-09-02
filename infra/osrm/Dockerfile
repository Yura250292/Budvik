# Власний OSRM — щоб трек можна було класти на дороги, а домальовка розривів
# перестала залежати від чужого демо-сервера.
#
# Публічний router.project-osrm.org приймає в /match рівно ДЕСЯТЬ координат
# (одинадцята — «TooBig») і лімітує за частотою. Доба торгового — це 700 точок,
# тобто вісімдесят запитів: непридатно. Тут та сама служба, але своя, без
# лімітів і поруч із застосунком.
#
# Беремо саму лише Львівщину (68 МБ проти 875 МБ по Україні): усі торгові
# їздять нею, а обробка вкладається у хвилини й у пам'ять збирача. Ширший
# район — це просто інший PBF_URL, решта не змінюється.

FROM ghcr.io/project-osrm/osrm-backend:latest AS build

ARG PBF_URL=https://download.openstreetmap.fr/extracts/europe/ukraine/lviv_oblast.osm.pbf

WORKDIR /data

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Три кроки конвеєра MLD: розбір карти, розбиття на комірки, підготовка ваг.
# Після них PBF не потрібен — викидаємо, щоб образ не тягав зайві 68 МБ.
RUN curl -fsSL -o map.osm.pbf "$PBF_URL" \
 && osrm-extract -p /opt/car.lua map.osm.pbf \
 && osrm-partition map.osrm \
 && osrm-customize map.osrm \
 && rm -f map.osm.pbf

FROM ghcr.io/project-osrm/osrm-backend:latest

WORKDIR /data
COPY --from=build /data/map.osrm* /data/

# Railway дає порт змінною оточення; локально лишається 5000.
ENV PORT=5000

# --max-matching-size — власне те, заради чого все й робиться: замість
# десяти координат приймаємо цілу добу одним запитом.
CMD osrm-routed --algorithm mld \
    --port ${PORT} \
    --max-matching-size 5000 \
    --max-viaroute-size 5000 \
    /data/map.osrm
