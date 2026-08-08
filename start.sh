#!/bin/bash
# Start Flask (internal, port 5757) in background
python server/dav_downloader.py &

# Start clone-script-pipeline (internal, port 8010) in background — proxied
# through Next.js under /csp (see next.config.ts rewrites). BASE_PATH tells
# it to emit /csp-prefixed links since it's reached through that proxy.
(cd csp && BASE_PATH=/csp python -m uvicorn backend.main:app --host 0.0.0.0 --port 8010) &

# Start Next.js on Railway's $PORT (defaults to 3000 locally)
exec npm start
