#!/usr/bin/env node
import fastify from 'fastify';
import { ChatGPTAPIBrowser } from 'chatgpt';
import fs from 'fs';
import { pathToFileURL } from 'url'
import cors from '@fastify/cors';
import ConnectDB from './db.js';


const arg = process.argv.find((arg) => arg.startsWith('--settings'));
let path;
if (arg) {
    path = arg.split('=')[1];
} else {
    path = './config/settings.js';
}

let settings;
if (fs.existsSync(path)) {
    // get the full path
    const fullPath = fs.realpathSync(path);
    settings = (await import(pathToFileURL(fullPath).toString())).default;
} else {
    if (arg) {
        console.error(`Error: the file specified by the --settings parameter does not exist.`);
    } else {
        console.error(`Error: the settings.js file does not exist.`);
    }
    process.exit(1);
}

const db = new ConnectDB();

const accounts = [];
const conversationsMap = {};

for (let i = 0; i < settings.accounts.length; i++) {
    const account = settings.accounts[i];
    const api = new ChatGPTAPIBrowser({
        ...account,
        nopechaKey: account.nopechaKey || settings.nopechaKey || undefined,
        captchaToken: account.twoCaptchaKey || settings.twoCaptchaKey || undefined,
        // For backwards compatibility
        proxyServer: account.proxyServer || account.proxy || undefined,
    });

    api.account_id = account.email;

    api.initSession().then(() => {
        console.log(`Session initialized for account ${i}.`);
        accounts.push(api);
    });

    // call `api.refreshSession()` every hour to refresh the session
    const notiURL = settings?.notificationURL;
    setInterval(() => {
        api.refreshSession().then(() => {
            console.log(`Session refreshed for account ${i}.`);
        }).catch((err) => {
            notiURL && axios.post(notiURL, {
                "type": "error",
                "message": `Session refresh failed for account ${i}.`
            });
            // throw err so that the process exits
            throw err;
        });
    }, 60 * 60 * 1000);

    // call `api.resetSession()` every 24 hours to reset the session
    setInterval(() => {
        api.resetSession().then(() => {
            console.log(`Session reset for account ${i}.`);
        }).catch((err) => {
            notiURL && axios.post(notiURL, {
                "type": "error",
                "message": `Session reset failed for account ${i}.`
            });
            throw err;
        });
    }, 24 * 60 * 60 * 1000);
}

let currentAccountIndex = 0;

const server = fastify();

// configure CORS
server.register(cors, {
    origin: settings.corsOrigin || '*',
});

server.post('/conversation', async (request, reply) => {
    // check for headers containing the API key
    if (settings.authKey && request.headers['authorization'] !== settings.authKey) {
        reply.code(401).send({ error: 'Unauthorized.' });
        return;
    }

    if (accounts.length === 0) {
        reply.code(503).send({ error: 'No sessions available.' });
        return;
    }

    let conversationId = undefined;
    let messageId = undefined;

    // search for conversationId and messageId using replyMsgId
    if (request.body.replyMsgId) {
        const row = db.getMessageByReplyMsgId(request.body.replyMsgId);
        if (row) {
            conversationId = row.conversationId;
            messageId = row.messageId;
        }
    }

    // Conversation IDs are tied to accounts, so we need to make sure that the same account is used for the same conversation.
    if (conversationId) {
        // get current account if already in the map
        if (conversationsMap[conversationId]) {
            currentAccountIndex = conversationsMap[conversationId];
        } else {
            const row = db.getAccountIdByConversationId(conversationId);
            if (row) {
                currentAccountIndex = accounts.findIndex((account) => account.account_id === row.accountId);
                // set next account to create new conversation if not found available account
                if (currentAccountIndex === -1) {
                    currentAccountIndex = (currentAccountIndex + 1) % accounts.length;
                    conversationId = undefined;
                    messageId = undefined;
                }
            }
        }
    } else {
        currentAccountIndex = (currentAccountIndex + 1) % accounts.length;
    }

    let result;
    let error;
    try {
        result = await accounts[currentAccountIndex].sendMessage(request.body.message, {
            conversationId,
            parentMessageId: messageId,
        });
        // save if new conversationId 
        if (!conversationsMap[result.conversationId]) {
            conversationsMap[result.conversationId] = currentAccountIndex;
            db.insertConversation(result.conversationId, accounts[currentAccountIndex].account_id);
        }
        result.response = result.response.trim();
    } catch (e) {
        error = e;
    }

    if (result !== undefined) {
        reply.send(result);
    } else {
        console.error(error);
        reply.code(503).send({ error: 'There was an error communicating with ChatGPT.' });
    }
});

server.post('/message/register', async (request, reply) => {
    try {
        if (!request.body.conversationId || !request.body.messageId || !request.body.replyMsgId) {
            reply.code(400).send({ error: 'Missing parameters.' });

            return;
        }
        // insert into tbl_message
        db.insertMessage(request.body.conversationId, request.body.messageId, request.body.replyMsgId);
    } catch {
        reply.code(503).send({ error: 'There was an error executing query to DB' });
    }
});

server.listen({ port: settings.port || 3000, host: "0.0.0.0" }, (error) => {
    if (error) {
        console.error(error);
        db.close();
        process.exit(1);
    }
});
