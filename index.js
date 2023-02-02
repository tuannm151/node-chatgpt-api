#!/usr/bin/env node
import fastify from 'fastify';
import { ChatGPTAPIBrowser } from 'chatgpt';
import fs from 'fs';
import { pathToFileURL } from 'url'
import cors from '@fastify/cors';
import ConnectDB from './db.js';
import axios from 'axios';
import { resolve } from 'path';

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

const delay = (milis = 1000) => {
    return new Promise(resolve => setTimeout(resolve, milis));
}

const db = new ConnectDB();

const accounts = [];
const conversationsMap = {};
const accountsOnCooldown = new Set();

for (let i = 0; i < settings.accounts.length; i++) {
    const account = settings.accounts[i];
    try {
        const api = new ChatGPTAPIBrowser({
            ...account,
            nopechaKey: account.nopechaKey || settings.nopechaKey || undefined,
            captchaToken: account.twoCaptchaKey || settings.twoCaptchaKey || undefined,
            // For backwards compatibility
            proxyServer: account.proxyServer || account.proxy || undefined,
        });
        api.account_id = account.email;

        api.initSession().then(() => {
            console.log(`Session initialized for account ${account.email}.`);
            accounts.push(api);
        });

        // call `api.refreshSession()` every hour to refresh the session
        setInterval(() => {
            api.refreshSession().then(() => {
                console.log(`Session refreshed for account ${account.email}.`);
            }).catch((err) => {
                err.message = `Error refreshing session for account ${account.email}`;
                err.sendNoti = true;
            });
        }, 60 * 60 * 1000);

        // call `api.resetSession()` every 24 hours to reset the session
        setInterval(() => {
            api.resetSession().then(() => {
                console.log(`Session reset for account ${i}.`);
            }).catch((err) => {
                err.message = `Error resetting session for account ${account.email}`;
                err.sendNoti = true;

            });
        }, 24 * 60 * 60 * 1000);

    } catch (err) {
        const notiURL = settings?.notiURL;

        if (!notiURL) {
            throw err;
        }

        if (err.sendNoti) {
            console.log(`Sending notification ...`)
            axios.post(notiURL, {
                type: 'error',
                message: err.message,
            }, {
                headers: {
                    'xva-access-token': settings.notiAuthKey || ""
                }
            });
        }
        throw err;
    }
};

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
    let result;
    let error;
    let account;
    try {
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
                account = await getAPIAccountByIndex(currentAccountIndex);
            } else {
                const row = db.getAccountIdByConversationId(conversationId);
                if (row) {
                    currentAccountIndex = accounts.findIndex((account) => account.account_id === row.accountId);

                    if (currentAccountIndex === -1) {
                        // set next account to create new conversation if not found available account
                        account = await getAPIAccount();
                        conversationId = undefined;
                        messageId = undefined;
                    } else {
                        account = await getAPIAccountByIndex(currentAccountIndex);
                    }
                }
            }
        } else {
            account = await getAPIAccount();
        }

        accountsOnCooldown.add(account.account_id);
        result = await account.sendMessage(request.body.message, {
            conversationId,
            parentMessageId: messageId,
        });
        // save if new conversationId 
        if (!conversationsMap[result.conversationId]) {
            conversationsMap[result.conversationId] = currentAccountIndex;
            db.insertConversation(result.conversationId, account.account_id);
        }
        result.response = result.response.trim();
    } catch (e) {
        error = e;
    }

    if (account) {
        accountsOnCooldown.delete(account.account_id);
    }

    if (result !== undefined) {
        reply.send(result);
    } else {
        console.error(error);
        reply.code(503).send({ error: error?.message || 'There was an error communicating with ChatGPT.' });
    }
});

async function getAPIAccount() {
    const MAX_RETRIES = settings.apiTimeout || 60;
    let retries = 0;

    while (true) {
        if (retries >= MAX_RETRIES) {
            throw new Error(`All accounts are on cooldown. Try again later.`);
        }
        const account = accounts[currentAccountIndex];
        if (!accountsOnCooldown.has(account.account_id)) {
            return account;
        }
        currentAccountIndex = (currentAccountIndex + 1) % accounts.length;
        retries++;
        if (accountsOnCooldown.size >= accounts.length) {
            await delay(1000);
        }

    }
}

async function getAPIAccountByIndex(index) {
    const MAX_RETRIES = settings.accountTimeout || 60;
    let retries = 0;
    const { account_id } = accounts[index];
    while (true) {
        if (retries >= MAX_RETRIES) {
            throw new Error(`Account ${account_id} is on cooldown. Try again later.`);
        }

        if (!accountsOnCooldown.has(account_id)) {
            return accounts[index];
        }

        retries++;

        await delay(1000);
    }
}

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

server.listen({ port: settings.port || 3000, host: "0.0.0.0" }, async (error) => {
    if (error) {
        db.close();
        console.error(error);
        await delay(1000);
        process.exit(1);
    }
});

