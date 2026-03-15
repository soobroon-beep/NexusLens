# 🤖 Nova Nexus Bot System

Bot de paper trading que corre tu indicador Nova Nexus automáticamente.

## 📁 Archivos

```
nova-nexus-system/
├── bot.js          ← Motor del bot (corre en Node.js)
├── dashboard.html  ← Panel de control (abre en navegador)
└── README.md
```

## 🚀 Cómo usarlo (5 minutos)

### 1. Instala Node.js
Descarga desde https://nodejs.org (versión LTS)
Verifica: `node --version` → debe mostrar v18 o mayor

### 2. Corre el bot
```bash
# Navega a la carpeta
cd nova-nexus-system

# Inicia el bot (sin instalar nada extra)
node bot.js
```

Verás en la consola:
```
[HH:MM:SS] Par: BTCUSDT | TF: 1h | Exchange: binance
[HH:MM:SS] 🌐 API del bot en http://localhost:4000
[HH:MM:SS] ✅ Bot corriendo — tick cada 60s
```

### 3. Abre el dashboard
Doble click en `dashboard.html` en tu navegador.
El dashboard se conecta solo a `http://localhost:4000`.

### 4. Configura en el dashboard
- Panel derecho → pestaña **Config**
- Cambia el par (PEPEUSDT, ETHUSDT, cualquiera)
- Ajusta Score mínimo, SL, TP1/TP2/TP3
- Pega tu webhook de Discord (opcional)
- Click **GUARDAR Y APLICAR**

El bot aplica la nueva config en el siguiente tick.

---

## ⚙ Variables de entorno (configuración avanzada)

Crea un archivo `.env` en la misma carpeta:

```env
# Par y exchange
PAIR=BTCUSDT
TIMEFRAME=1h
EXCHANGE=binance       # binance | bitget

# Nova Nexus
MIN_SCORE=2            # 1-5 estrellas mínimo
COOLDOWN=10            # velas entre señales
SL_MULT=1.0            # SL = 1.0 × ATR
TP1_MULT=1.5           # TP1 = 1.5 × ATR
TP2_MULT=2.5           # TP2 = 2.5 × ATR
TP3_MULT=4.0           # TP3 = 4.0 × ATR

# Capital
CAPITAL_PCT=10         # % del balance por trade
TP1_CLOSE=33           # % cerrar en TP1
TP2_CLOSE=33           # % cerrar en TP2
TP3_CLOSE=34           # % cerrar en TP3
MAX_TRADES=3           # máx posiciones abiertas
INIT_BALANCE=10000     # balance inicial
BREAKEVEN=true         # mover SL a entrada en TP1

# Discord (opcional)
DISCORD_WEBHOOK=https://discord.com/api/webhooks/...

# Intervalo del bot
TICK_MS=60000          # milisegundos (60s = 1 minuto)
```

---

## 📱 Alertas Discord

1. En Discord → tu canal → ⚙ Editar canal
2. Integraciones → Webhooks → Nuevo Webhook
3. Copia la URL y pégala en el dashboard (Config → Discord)
4. Click Guardar y Aplicar

Recibirás:
- 🟢/🔴 Cuando entra una señal (con score, SL, TP1/2/3)
- 🎯 Cuando alcanza TP1, TP2, TP3
- 🛑/🔁 Stop Loss o Breakeven

---

## 🔄 Subir a la nube (Railway) cuando estés listo

```bash
# Instala Railway CLI
npm install -g @railway/cli

# Login
railway login

# Deploy (desde la carpeta del bot)
railway init
railway up

# Agrega las variables de entorno en railway.app → tu proyecto → Variables
```

El bot correrá 24/7 aunque apagues tu PC.

---

## 🎯 Flujo del bot

```
Cada TICK_MS milisegundos:
  1. Descarga últimas 500 velas de Binance/Bitget
  2. Corre Nova Nexus completo (oscilador, ADX, flux, EMA200, divergencias)
  3. Si hay señal en la última vela completada:
     → Verifica cooldown y score mínimo
     → Abre posición paper con SL/TP calculados en ATR
     → Envía alerta a Discord
  4. Verifica posiciones abiertas:
     → TP1 alcanzado → cierra X%, activa breakeven si está on
     → TP2 alcanzado → cierra X%
     → TP3 alcanzado → cierra resto, registra trade
     → SL alcanzado  → cierra todo, registra pérdida
  5. Guarda estado en nova_state.json
  6. Dashboard se actualiza solo cada 5 segundos
```
