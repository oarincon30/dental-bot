
## Arranque
```bash
npm install
npm run dev
```

Para correr con perfil:
```bash
APP_PROFILE=emulator npm run dev
APP_PROFILE=twilio npm run dev
```

## Endpoint local
- Bot Framework Emulator: `http://localhost:3978/api/messages`
- Twilio WhatsApp webhook: `http://localhost:3978/twilio/whatsapp`
