#!/bin/bash
# AeroKiosk — Healthcheck Chromium (cron toutes les 2 min)
# Si Chromium ne tourne pas, relance X11.

if ! pgrep -x chromium-browser > /dev/null; then
    logger "AeroKiosk: Chromium absent, relance X11"
    su - aerokiosk -c "startx" &
fi
