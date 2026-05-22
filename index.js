import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
const profile = process.env.APP_PROFILE || '';
if (profile) {
  dotenv.config({ path: `.env.${profile}`, override: true });
}

import restify from 'restify';
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ConversationState,
  MemoryStorage,
  UserState,
  BotAdapter,
  TurnContext
} from 'botbuilder';
import { DialogSet } from 'botbuilder-dialogs';
import { MainDialog } from './dialogs/MainDialog.js';
import twilio from 'twilio';
import { v4 as uuid } from 'uuid';

const server = restify.createServer();
server.use(restify.plugins.queryParser());
server.use(restify.plugins.bodyParser());

const port = process.env.PORT || 3978;
server.listen(port, () => {
  console.log(`Bot listening on http://localhost:${port}`);
  if (profile) console.log(`[BOOT] profile=${profile}`);
});

const botAuth = new ConfigurationBotFrameworkAuthentication(process.env);
const cloudAdapter = new CloudAdapter(botAuth);

cloudAdapter.onTurnError = async (context, err) => {
  console.error('Bot Error:', err);
  await context.sendActivity('Ocurrió un error procesando tu mensaje.');
};

const memory = new MemoryStorage();
const convoState = new ConversationState(memory);
const userState = new UserState(memory);
const dialogs = new DialogSet(convoState.createProperty('DialogState'));
const mainDialog = new MainDialog();
dialogs.add(mainDialog);

server.post('/api/messages', async (req, res) => {
  await cloudAdapter.process(req, res, async (context) => {
    const dc = await dialogs.createContext(context);
    if (context.activity.type === 'message') {
      if (!dc.activeDialog) await dc.beginDialog(mainDialog.id);
      else await dc.continueDialog();
    }
    await convoState.saveChanges(context);
    await userState.saveChanges(context);
  });
});

function fullRequestUrl(req) {
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (base) return base + req.getPath();

  const proto = req.header('x-forwarded-proto') || 'https';
  const host = req.header('x-original-host') || req.header('host');
  return `${proto}://${host}${req.getPath()}`;
}

function validateTwilioSignature(req) {
  const skip = process.env.TWILIO_SKIP_VALIDATION === '1' || !process.env.TWILIO_AUTH_TOKEN;
  if (skip) return true;

  const signature = req.header('x-twilio-signature');
  const url = fullRequestUrl(req);
  const params = req.body || {};
  const token = process.env.TWILIO_AUTH_TOKEN || '';
  return twilio.validateRequest(token, signature, url, params);
}

class TwilioAdapter extends BotAdapter {
  constructor(twiml) {
    super();
    this.twiml = twiml;
  }

  async sendActivities(context, activities) {
    for (const activity of activities) {
      if (activity.type === 'message' && activity.text) {
        this.twiml.message(activity.text);
      }
    }
    return activities.map(() => ({ id: uuid() }));
  }

  async updateActivity() { return { id: uuid() }; }
  async deleteActivity() {}
  async continueConversation() {}
}

server.post('/twilio/whatsapp', async (req, res) => {
  try {
    if (!validateTwilioSignature(req)) {
      res.send(403, 'Invalid Twilio signature');
      return;
    }

    const from = req.body.From || '';
    const body = (req.body.Body || '').toString();

    const twiml = new twilio.twiml.MessagingResponse();
    const adapter = new TwilioAdapter(twiml);

    const activity = {
      type: 'message',
      id: uuid(),
      timestamp: new Date(),
      serviceUrl: 'twilio',
      channelId: 'twilio',
      from: { id: from },
      recipient: { id: 'bot' },
      conversation: { id: from },
      text: body,
      locale: 'es-CO'
    };

    const context = new TurnContext(adapter, activity);
    const dc = await dialogs.createContext(context);
    if (!dc.activeDialog) await dc.beginDialog(mainDialog.id);
    else await dc.continueDialog();

    await convoState.saveChanges(context);
    await userState.saveChanges(context);

    res.header('Content-Type', 'text/xml');
    res.sendRaw(200, twiml.toString());
  } catch (error) {
    console.error('Twilio webhook error:', error);
    res.send(500, 'Error');
  }
});
