FROM oven/bun:1.4.0-alpine

WORKDIR /app
COPY --chown=bun:bun --chmod=0444 egress.js ./egress.js

ENV PORT=3241
EXPOSE 3241
USER bun

CMD ["bun", "run", "egress.js"]
