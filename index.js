#!/usr/bin/env node
import fastify from 'fastify';
import { ChatGPTAPIBrowser } from 'chatgpt';
import fs from 'fs';
import { pathToFileURL } from 'url'
import cors from '@fastify/cors';

const arg = process.argv.find((arg) => arg.startsWith('--settings'));
let path;
if (arg) {
    path = arg.split('=')[1];
} else {
    path = './settings.js';
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

    api.initSession().then(() => {
        console.log(`Session initialized for account ${i}.`);
        accounts.push(api);
    });

    // call `api.refreshSession()` every hour to refresh the session
    setInterval(() => {
        api.refreshSession().then(() => {
            console.log(`Session refreshed for account ${i}.`);
        });
    }, 60 * 60 * 1000);
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

    const conversationId = request.body.conversationId ? request.body.conversationId.toString() : undefined;

    // Conversation IDs are tied to accounts, so we need to make sure that the same account is used for the same conversation.
    if (conversationId && conversationsMap[conversationId]) {
        // If the conversation ID is already in the map, use the account that was used for that conversation.
        currentAccountIndex = conversationsMap[conversationId];
    } else {
        // If the conversation ID is not in the map, use the next account.
        currentAccountIndex = (currentAccountIndex + 1) % accounts.length;
    }

    let result;
    let error;
    try {
        const parentMessageId = request.body.parentMessageId ? request.body.parentMessageId.toString() : undefined;
        result = await accounts[currentAccountIndex].sendMessage(request.body.message, {
            conversationId,
            parentMessageId,
        });
        // ChatGPT ends its response with a newline character, so we need to remove it.
        result.response = result.response.trim();
        if (conversationId) {
            // Save the account index for this conversation.
            conversationsMap[conversationId] = currentAccountIndex;
        }
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

server.listen({ port: settings.port || 3000, host: "0.0.0.0" }, (error) => {
    if (error) {
        console.error(error);
        process.exit(1);
    }
});
