#!/bin/bash
# AeroKiosk — Script de premier demarrage
# Lit la config depuis /boot/firmware/aerokiosk-config.txt et configure le systeme.
# S'execute une seule fois au premier boot, puis se desactive.

set -e

CONFIG_FILE="/boot/firmware/aerokiosk-config.txt"
KIOSK_USER="aerokiosk"
XINITRC="/home/${KIOSK_USER}/.xinitrc"

echo "[AeroKiosk] Premier demarrage — configuration en cours..."

# --- Lire la cle de licence ---
LICENCE_KEY=$(grep -E "^LICENCE_KEY=" "$CONFIG_FILE" | cut -d'=' -f2 | tr -d '[:space:]')

if [ -z "$LICENCE_KEY" ]; then
    echo "[AeroKiosk] ERREUR : Aucune cle de licence dans ${CONFIG_FILE}"
    echo "[AeroKiosk] Editez le fichier et redemarrez le Pi."
    exit 1
fi

echo "[AeroKiosk] Cle de licence detectee : ${LICENCE_KEY:0:8}..."

# --- Injecter la cle dans .xinitrc ---
sed -i "s/__LICENCE_KEY__/${LICENCE_KEY}/" "$XINITRC"
echo "[AeroKiosk] Cle injectee dans ${XINITRC}"

# --- Configurer le Wi-Fi si renseigne ---
WIFI_SSID=$(grep -E "^WIFI_SSID=" "$CONFIG_FILE" | cut -d'=' -f2 | tr -d '[:space:]')
WIFI_PASSWORD=$(grep -E "^WIFI_PASSWORD=" "$CONFIG_FILE" | cut -d'=' -f2 | tr -d '[:space:]')
WIFI_COUNTRY=$(grep -E "^WIFI_COUNTRY=" "$CONFIG_FILE" | cut -d'=' -f2 | tr -d '[:space:]')

if [ -n "$WIFI_SSID" ] && [ -n "$WIFI_PASSWORD" ]; then
    WIFI_COUNTRY=${WIFI_COUNTRY:-FR}
    echo "[AeroKiosk] Configuration Wi-Fi : ${WIFI_SSID}"

    # NetworkManager (Raspberry Pi OS Bookworm+)
    if command -v nmcli &> /dev/null; then
        nmcli radio wifi on
        nmcli dev wifi connect "$WIFI_SSID" password "$WIFI_PASSWORD" || true
    else
        # Fallback wpa_supplicant (ancien Pi OS)
        cat > /etc/wpa_supplicant/wpa_supplicant.conf << WPAEOF
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
country=${WIFI_COUNTRY}

network={
    ssid="${WIFI_SSID}"
    psk="${WIFI_PASSWORD}"
    key_mgmt=WPA-PSK
}
WPAEOF
        rfkill unblock wifi || true
        wpa_cli -i wlan0 reconfigure || true
    fi
    echo "[AeroKiosk] Wi-Fi configure."
fi

# --- Desactiver ce service (execution unique) ---
systemctl disable aerokiosk-firstboot.service
echo "[AeroKiosk] Service premier demarrage desactive."

echo "[AeroKiosk] Configuration terminee. Le kiosque demarrera au prochain reboot."
