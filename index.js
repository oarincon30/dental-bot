// index.js
import 'dotenv/config';
import restify from 'restify';
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ConfigurationServiceClientCredentialFactory,
  MemoryStorage,
  ConversationState,
  UserState
} from 'botbuilder';
import { DialogSet } from 'botbuilder-dialogs';
import { MainDialog } from './dialogs/MainDialog.js';

// -------------------- Servidor --------------------
const server = restify.createServer();
server.use(restify.plugins.bodyParser());
const PORT = process.env.PORT || 3978;
server.listen(PORT, () => console.log(`Bot on http://localhost:${PORT}/api/messages`));
server.get('/health', (req, res, next) => {
  res.send(200, 'ok');
  return next();
});

// -------------------- Adapter (CORREGIDO) --------------------
// Deja MicrosoftAppId/Password vacíos en .env para Emulator local
const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
  MicrosoftAppId: process.env.MicrosoftAppId || undefined,
  MicrosoftAppPassword: process.env.MicrosoftAppPassword || undefined,
  MicrosoftAppType: process.env.MicrosoftAppType || undefined,          // opcional
  MicrosoftAppTenantId: process.env.MicrosoftAppTenantId || undefined   // opcional
});

// BotFrameworkAuthentication basado en variables de entorno
const botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication(
  process.env,            // usa .env / process.env
  credentialsFactory      // fábrica de credenciales
);

// ✅ CloudAdapter ahora recibe un BotFrameworkAuthentication válido
const adapter = new CloudAdapter(botFrameworkAuthentication);

// Manejador de errores para que no "rompa" la conversación
adapter.onTurnError = async (context, error) => {
  console.error('onTurnError:', error);
  await context.sendActivity('Ups, algo falló procesando tu mensaje.');
};

// -------------------- Estado y Diálogos --------------------
const memory = new MemoryStorage();
const convoState = new ConversationState(memory);
const userState = new UserState(memory);
const dialogState = convoState.createProperty('DialogState');

const dialogs = new DialogSet(dialogState);
const mainDialog = new MainDialog();
dialogs.add(mainDialog);

// -------------------- Endpoint del bot --------------------
server.post('/api/messages', async (req, res) => {
  await adapter.process(req, res, async (context) => {
    const dc = await dialogs.createContext(context);
    if (context.activity.type === 'message') {
      if (!dc.activeDialog) {
        await dc.beginDialog(mainDialog.id);
      } else {
        await dc.continueDialog();
      }
      await convoState.saveChanges(context);
      await userState.saveChanges(context);
    }
  });
});

// (Más adelante añadiremos /twilio/whatsapp para WhatsApp)