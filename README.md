# Stellar Trustline Manager

Ein Tool zum Verwalten von Stellar-Trustlines, um Trustlines anzuzeigen, zu vergleichen und zu löschen.

## Überblick

Dieses Repository enthält den Stellar Trustline Manager, eine Webanwendung zur Verwaltung von Trustlines auf der Stellar-Blockchain. Derzeit wird eine lokale, zentralisierte Lösung für Tests eingerichtet, die später in eine dezentralisierte Anwendung (dApp) umgewandelt wird.

## Lokale Einrichtung (Debian)

### Voraussetzungen

- **Node.js** (v20.19.0): `sudo apt install -y nodejs npm`
- **Git** (v2.47.2): `sudo apt install -y git`
- **Python 3** (v3.10.13): Vorinstalliert oder `sudo apt install -y python3`
- Moderner Browser (Chrome, Firefox).
- Internetzugang.

### Einrichtung

1. **Repository klonen**:
   ```bash
   git clone https://github.com/MiSte-Git/Stellar-Trustline-Manager.git
   cd Stellar-Trustline-Manager
   ```
   - Alternativ: Kopiere `index.html`, `server.js`, `package.json`, `README.md`, `.gitignore` ins Verzeichnis.

2. **Backend einrichten**:
   ```bash
   npm install
   node server.js
   ```
   - Läuft auf `http://localhost:3000`.

3. **Frontend einrichten**:
   - Öffne ein neues Terminal:
     ```bash
     cd /media/michael/Michis_All/Projects/Java\ Skript/Stellar\ Trustline\ Manager
     python3 -m http.server 8080
     ```
   - Öffne `http://localhost:8080` im Browser.

### Testen

1. **PC-Test** (Chrome/Firefox):
   - Öffne `http://localhost:8080`.
   - Gib einen Stellar-Public-Key (Testnet) ein.
   - Überprüfe 333 Trustlines pro Seite, Sortierung, Pagination, „Back to Top“, Secret-Key-Toggle, Löschung.

2. **Mobile-Test** (Android/iOS):
   - Finde lokale IP: `ip addr show | grep inet`.
   - Greife auf `http://<deine-IP>:8080` zu.
   - Wiederhole PC-Tests, prüfe Responsivität.

## GitHub-Speicherung

- **Dateien hochladen**:
  ```bash
  git add .
  git commit -m "Lokale Lösung"
  git push origin main
  ```
- **Release**:
  - Erstelle `v1.0.0` auf GitHub mit ZIP (`index.html`, `server.js`, etc.).

## Zukünftige dApp

- **Zeitplan**: Juni/Juli 2025.
- **Plan**:
  - Wallet-Integration (Freighter/Albedo).
  - Frontend auf IPFS.
  - Entferne Backend, clientseitige Logik.

## Veröffentlichung

- Mit Web3-Firmen-Webseite (Juni/July 2025).
- Deployment-Optionen: Vercel/Railway (zentralisiert), IPFS (dApp).

## Support

- **Issues**: https://github.com/MiSte-Git/Stellar-Trustline-Manager/issues