# syntax=docker/dockerfile:1
FROM eclipse-temurin:25-jdk-jammy AS build

# The wrapper checks the checksum of the ZIP. With no unzip it selects a tarball instead.
RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN chmod +x mvnw
COPY src/ src/
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B -ntp package -DskipTests

FROM eclipse-temurin:25-jre-jammy AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 planner \
    && useradd --uid 10001 --gid planner --no-create-home --shell /usr/sbin/nologin planner \
    && install -d -o planner -g planner /app \
    && install -d -m 0700 -o planner -g planner /data

WORKDIR /app
COPY --from=build --chown=planner:planner /workspace/target/city-break-planner-0.0.1-SNAPSHOT.jar /app/application.jar

USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
    CMD curl --fail --silent --show-error http://127.0.0.1:8080/api/v1/health > /dev/null || exit 1

ENTRYPOINT ["java", "--enable-native-access=ALL-UNNAMED", "-jar", "/app/application.jar"]
