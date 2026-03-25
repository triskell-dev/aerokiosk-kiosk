#!/bin/bash
# ============================================================
# AeroKiosk — Script d'installation Raspberry Pi
# ============================================================
# Transforme un Raspberry Pi OS Lite (64-bit) en kiosque AeroKiosk.
#
# Usage :
#   1. Flasher Raspberry Pi OS Lite (64-bit, Bookworm) sur la carte SD
#   2. Remplir aerokiosk-config.txt et le deposer sur la partition boot
#   3. Booter le Pi, se connecter en SSH (ou clavier)
#   4. Copier ce dossier rpi/ sur le Pi (clé USB ou scp)
#   5. sudo bash setup.sh
#
# Le script cree un utilisateur "aerokiosk", installe Chromium en mode
# kiosque, et configure l'auto-login + auto-start.
# Inclut : watchdog hardware, healthcheck Chromium, logrotate, overlayfs.
# ============================================================

set -e

# --- Verifier qu'on est root ---
if [ "$(id -u)" -ne 0 ]; then
    echo "ERREUR : ce script doit etre lance avec sudo."
    echo "Usage : sudo bash setup.sh"
    exit 1
fi

KIOSK_USER="aerokiosk"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "============================================================"
echo " AeroKiosk — Installation Raspberry Pi"
echo "============================================================"
echo ""

# --- 1. Mise a jour systeme ---
echo "[1/11] Mise a jour du systeme..."
apt-get update -qq
apt-get upgrade -y -qq

# --- 2. Installer les paquets necessaires ---
echo "[2/11] Installation des paquets..."
apt-get install -y -qq \
    chromium-browser \
    xserver-xorg \
    x11-xserver-utils \
    xinit \
    unclutter \
    xdotool \
    watchdog \
    logrotate

# --- 3. Creer l'utilisateur kiosque ---
echo "[3/11] Creation de l'utilisateur ${KIOSK_USER}..."
if id "$KIOSK_USER" &>/dev/null; then
    echo "  Utilisateur ${KIOSK_USER} existe deja."
else
    useradd -m -s /bin/bash "$KIOSK_USER"
    # Ajouter aux groupes necessaires (video pour GPU, input pour clavier/souris, tty pour console)
    usermod -aG video,input,tty "$KIOSK_USER"
    echo "  Utilisateur ${KIOSK_USER} cree."
fi

# --- 4. Copier le script de lancement kiosque ---
echo "[4/11] Installation du script kiosque (.xinitrc)..."
cp "${SCRIPT_DIR}/xinitrc" "/home/${KIOSK_USER}/.xinitrc"
chmod +x "/home/${KIOSK_USER}/.xinitrc"
chown "${KIOSK_USER}:${KIOSK_USER}" "/home/${KIOSK_USER}/.xinitrc"

# --- 5. Configurer l'auto-login console ---
echo "[5/11] Configuration de l'auto-login..."
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin ${KIOSK_USER} --noclear %I \$TERM
EOF

# Lancer X automatiquement au login
BASH_PROFILE="/home/${KIOSK_USER}/.bash_profile"
cat > "$BASH_PROFILE" << 'EOF'
# Auto-start X on tty1
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
    exec startx
fi
EOF
chown "${KIOSK_USER}:${KIOSK_USER}" "$BASH_PROFILE"

# --- 6. Installer le service de premier demarrage ---
echo "[6/11] Installation du service de premier demarrage..."
cp "${SCRIPT_DIR}/aerokiosk-firstboot.sh" /usr/local/bin/aerokiosk-firstboot.sh
chmod +x /usr/local/bin/aerokiosk-firstboot.sh
cp "${SCRIPT_DIR}/aerokiosk-firstboot.service" /etc/systemd/system/aerokiosk-firstboot.service
systemctl daemon-reload
systemctl enable aerokiosk-firstboot.service

# Copier le fichier de config sur la partition boot s'il n'y est pas
BOOT_CONFIG="/boot/firmware/aerokiosk-config.txt"
if [ ! -f "$BOOT_CONFIG" ]; then
    cp "${SCRIPT_DIR}/aerokiosk-config.txt" "$BOOT_CONFIG"
    echo "  aerokiosk-config.txt copie sur /boot/firmware/"
    echo ""
    echo "  IMPORTANT : editez ${BOOT_CONFIG} pour y mettre votre cle de licence !"
fi

# --- 7. Optimisations GPU ---
echo "[7/11] Optimisation GPU pour Chromium..."
# Allouer plus de memoire au GPU (256 Mo pour Leaflet + couches meteo fluides)
if ! grep -q "^gpu_mem=" /boot/firmware/config.txt 2>/dev/null; then
    echo "gpu_mem=256" >> /boot/firmware/config.txt
else
    sed -i 's/^gpu_mem=.*/gpu_mem=256/' /boot/firmware/config.txt
fi
# Desactiver le splash screen pour un demarrage plus rapide
if ! grep -q "^disable_splash=" /boot/firmware/config.txt 2>/dev/null; then
    echo "disable_splash=1" >> /boot/firmware/config.txt
fi

# --- 8. Watchdog hardware BCM2835 ---
echo "[8/11] Configuration du watchdog hardware..."
# Activer le watchdog dans le device-tree
if ! grep -q "^dtparam=watchdog=on" /boot/firmware/config.txt 2>/dev/null; then
    echo "dtparam=watchdog=on" >> /boot/firmware/config.txt
fi

# Configurer le daemon watchdog
cat > /etc/watchdog.conf << 'WDEOF'
# AeroKiosk — Watchdog BCM2835
# Redemarre le Pi si le systeme freeze pendant 15 secondes

watchdog-device = /dev/watchdog
watchdog-timeout = 15

# Redemarrer si la charge systeme depasse 24 sur 1 min (OOM probable)
max-load-1 = 24

# Redemarrer si la temperature depasse 80°C
temperature-device = /sys/class/thermal/thermal_zone0/temp
max-temperature = 80000

# Intervalle de verification : 10 secondes
interval = 10

# Realtime priority pour ne pas etre bloque par un process fou
realtime = yes
priority = 1
WDEOF

# Activer le service watchdog
systemctl enable watchdog
systemctl start watchdog 2>/dev/null || true
echo "  Watchdog BCM2835 active (timeout 15s, temp max 80°C)"

# --- 9. Healthcheck Chromium (cron) ---
echo "[9/11] Installation du healthcheck Chromium..."
cp "${SCRIPT_DIR}/aerokiosk-healthcheck.sh" /usr/local/bin/aerokiosk-healthcheck.sh
chmod +x /usr/local/bin/aerokiosk-healthcheck.sh

# Cron toutes les 2 minutes
CRON_LINE="*/2 * * * * /usr/local/bin/aerokiosk-healthcheck.sh"
(crontab -l 2>/dev/null | grep -v "aerokiosk-healthcheck" ; echo "$CRON_LINE") | crontab -
echo "  Healthcheck cron installe (toutes les 2 min)"

# --- 10. Rotation des logs ---
echo "[10/11] Configuration de la rotation des logs..."
cp "${SCRIPT_DIR}/aerokiosk-logrotate" /etc/logrotate.d/aerokiosk
echo "  Logrotate configure (healthcheck 1Mo x2, Chromium 1Mo x1)"

# --- 11. Filesystem read-only (overlayfs) ---
echo "[11/11] Activation du filesystem read-only (overlayfs)..."
# raspi-config en mode non-interactif pour activer l'overlay
if command -v raspi-config &> /dev/null; then
    # Activer overlayfs (root en lecture seule + overlay RAM)
    raspi-config nonint enable_overlayfs
    echo "  Overlayfs active — le filesystem sera en lecture seule au prochain reboot."
    echo "  /boot/firmware reste inscriptible (config, mises a jour)."
    echo ""
    echo "  Pour desactiver temporairement (maintenance) :"
    echo "    sudo raspi-config nonint disable_overlayfs && sudo reboot"
else
    echo "  ATTENTION : raspi-config non disponible — overlayfs non active."
    echo "  Installez raspi-config ou activez l'overlay manuellement."
fi

echo ""
echo "============================================================"
echo " Installation terminee !"
echo "============================================================"
echo ""
echo " Protections installees :"
echo "   [x] Watchdog hardware (reboot auto si freeze/OOM/surchauffe)"
echo "   [x] Healthcheck Chromium (relance auto toutes les 2 min)"
echo "   [x] Rotation des logs (carte SD protegee contre le remplissage)"
echo "   [x] Filesystem read-only (overlayfs — protection coupure courant)"
echo ""
echo " Prochaines etapes :"
echo "   1. Editez ${BOOT_CONFIG}"
echo "      → Ajoutez votre cle de licence AeroKiosk"
echo "      → Ajoutez votre Wi-Fi si necessaire"
echo "   2. Redemarrez : sudo reboot"
echo "   3. Le kiosque demarrera automatiquement !"
echo ""
echo " Pour acceder au Pi apres installation :"
echo "   → SSH : ssh pi@<adresse-ip>"
echo "   → Ou branchez un clavier et appuyez sur Ctrl+Alt+F2"
echo ""
echo " Pour desactiver le mode lecture seule (maintenance) :"
echo "   → sudo raspi-config nonint disable_overlayfs && sudo reboot"
echo "   → Puis reactiver : sudo raspi-config nonint enable_overlayfs && sudo reboot"
echo "============================================================"
