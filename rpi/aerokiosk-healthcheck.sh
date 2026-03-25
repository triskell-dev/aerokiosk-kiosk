#!/bin/bash
# AeroKiosk — Healthcheck Chromium (cron toutes les 2 min)
# Si Chromium ne tourne pas, relance X11.

if ! pgrep -x chromium-browser > /dev/null; then
    # Eviter de lancer plusieurs startx en parallele (race condition)
    if pgrep -f "startx" > /dev/null; then
        logger "AeroKiosk: startx deja en cours, on attend"
    else
        logger "AeroKiosk: Chromium absent, relance X11"
        # Tuer X11 residuel avant relance
        killall -q Xorg 2>/dev/null
        sleep 1
        timeout 30 su - aerokiosk -c "startx" &
    fi
fi
