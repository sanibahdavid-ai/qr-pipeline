#!/bin/bash
# Start Flask (internal, port 5757) in background
python server/dav_downloader.py &

# Start Next.js on Railway's $PORT (defaults to 3000 locally)
exec npm start
