#!/bin/bash
# ============================================================
# AeroKiosk — Script de provisioning distant
# ============================================================
# Configure un Raspberry Pi vierge (Raspbian Lite) en kiosque
# AeroKiosk en une seule commande :
#
#   curl -sL https://raw.githubusercontent.com/triskell-dev/aerokiosk-kiosk/main/rpi/provision.sh | sudo bash
#
# Le script :
#   1. Verifie qu'on est sur un Pi (architecture ARM)
#   2. Demande la cle de licence et le Wi-Fi interactivement
#   3. Telecharge les scripts depuis GitHub
#   4. Lance l'installation complete
# ============================================================

set -e

# --- Couleurs ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN} AeroKiosk — Provisioning Raspberry Pi${NC}"
echo -e "${CYAN}============================================================${NC}"
echo ""

# --- Verifier qu'on est root ---
if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}ERREUR : ce script doit etre lance avec sudo.${NC}"
    echo "Usage : curl -sL <url> | sudo bash"
    exit 1
fi

# --- Verifier l'architecture ARM ---
ARCH=$(uname -m)
if [[ "$ARCH" != "aarch64" && "$ARCH" != "armv7l" && "$ARCH" != "armv6l" ]]; then
    echo -e "${RED}ERREUR : ce script est prevu pour Raspberry Pi (ARM).${NC}"
    echo "Architecture detectee : ${ARCH}"
    exit 1
fi

echo -e "${GREEN}Raspberry Pi detecte${NC} (${ARCH})"
echo ""

# --- Demander la cle de licence ---
echo -e "${YELLOW}=== Configuration AeroKiosk ===${NC}"
echo ""
read -rp "Cle de licence AeroKiosk : " LICENCE_KEY

if [ -z "$LICENCE_KEY" ]; then
    echo -e "${RED}ERREUR : la cle de licence est obligatoire.${NC}"
    exit 1
fi

echo ""

# --- Demander le Wi-Fi (optionnel) ---
read -rp "Configurer le Wi-Fi ? (o/N) : " SETUP_WIFI

WIFI_SSID=""
WIFI_PASSWORD=""
WIFI_COUNTRY="FR"

if [[ "$SETUP_WIFI" == "o" || "$SETUP_WIFI" == "O" || "$SETUP_WIFI" == "oui" ]]; then
    read -rp "Nom du reseau Wi-Fi (SSID) : " WIFI_SSID
    read -rsp "Mot de passe Wi-Fi : " WIFI_PASSWORD
    echo ""
    read -rp "Code pays Wi-Fi (defaut: FR) : " input_country
    WIFI_COUNTRY=${input_country:-FR}
    echo ""
fi

# --- Telecharger les scripts ---
echo ""
echo -e "${CYAN}[1/4] Telechargement des scripts AeroKiosk...${NC}"

GITHUB_BASE="https://raw.githubusercontent.com/triskell-dev/aerokiosk-kiosk/main/rpi"
INSTALL_DIR="/tmp/aerokiosk-rpi"

mkdir -p "$INSTALL_DIR"

for file in setup.sh xinitrc aerokiosk-firstboot.sh aerokiosk-firstboot.service aerokiosk-config.txt aerokiosk-healthcheck.sh aerokiosk-logrotate; do
    curl -sL "${GITHUB_BASE}/${file}" -o "${INSTALL_DIR}/${file}"
    echo "  Telecharge : ${file}"
done

chmod +x "${INSTALL_DIR}/setup.sh"
chmod +x "${INSTALL_DIR}/aerokiosk-firstboot.sh"
chmod +x "${INSTALL_DIR}/aerokiosk-healthcheck.sh"

# --- Ecrire le fichier de config sur la partition boot ---
echo ""
echo -e "${CYAN}[2/4] Ecriture de la configuration...${NC}"

BOOT_CONFIG="/boot/firmware/aerokiosk-config.txt"
cat > "$BOOT_CONFIG" << CFGEOF
# AeroKiosk — Configuration
# Ce fichier est lu au premier demarrage du Pi.

# Cle de licence (obligatoire)
LICENCE_KEY=${LICENCE_KEY}

# Wi-Fi (optionnel — laisser vide si Ethernet)
WIFI_SSID=${WIFI_SSID}
WIFI_PASSWORD=${WIFI_PASSWORD}
WIFI_COUNTRY=${WIFI_COUNTRY}
CFGEOF

echo "  Config ecrite dans ${BOOT_CONFIG}"

# --- Configurer le Wi-Fi immediatement si demande ---
if [ -n "$WIFI_SSID" ] && [ -n "$WIFI_PASSWORD" ]; then
    echo ""
    echo -e "${CYAN}[3/4] Configuration Wi-Fi...${NC}"
    if command -v nmcli &> /dev/null; then
        nmcli radio wifi on
        nmcli dev wifi connect "$WIFI_SSID" password "$WIFI_PASSWORD" 2>/dev/null && \
            echo -e "  ${GREEN}Wi-Fi connecte a ${WIFI_SSID}${NC}" || \
            echo -e "  ${YELLOW}Wi-Fi : connexion echouee (verifiez SSID/mot de passe)${NC}"
    else
        echo "  Wi-Fi sera configure au premier demarrage (wpa_supplicant)."
    fi
else
    echo ""
    echo -e "${CYAN}[3/4] Wi-Fi : non configure (Ethernet ou deja connecte)${NC}"
fi

# --- Lancer l'installation ---
echo ""
echo -e "${CYAN}[4/4] Lancement de l'installation...${NC}"
echo ""

bash "${INSTALL_DIR}/setup.sh"

# --- Nettoyage ---
rm -rf "$INSTALL_DIR"

echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN} Provisioning termine !${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo -e " Cle de licence : ${CYAN}${LICENCE_KEY:0:8}...${NC}"
if [ -n "$WIFI_SSID" ]; then
    echo -e " Wi-Fi : ${CYAN}${WIFI_SSID}${NC}"
fi
echo ""
echo -e " ${YELLOW}Redemarrez maintenant :${NC}"
echo -e "   ${CYAN}sudo reboot${NC}"
echo ""
echo " Le kiosque demarrera automatiquement apres le reboot."
echo -e "${GREEN}============================================================${NC}"
