#!/usr/bin/env node
import fastify from 'fastify';
import fs from 'fs';
import { pathToFileURL } from 'url'
import ChatGPTClient from '../src/ChatGPTClient.js';
import { KeyvFile } from 'keyv-file';
import Keyv from 'keyv';
import cors from '@fastify/cors'

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

if (settings.storageFilePath && !settings.cacheOptions.store) {
    // make the directory and file if they don't exist
    const dir = settings.storageFilePath.split('/').slice(0, -1).join('/');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(settings.storageFilePath)) {
        fs.writeFileSync(settings.storageFilePath, '');
    }

    settings.cacheOptions.store = new KeyvFile({ filename: settings.storageFilePath });
}

if (settings.msgStorageFilePath && !settings.msgCacheOptions.store) {
    // make the directory and file if they don't exist
    const dir = settings.msgStorageFilePath.split('/').slice(0, -1).join('/');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(settings.msgStorageFilePath)) {
        fs.writeFileSync(settings.msgStorageFilePath, '');
    }

    settings.msgCacheOptions.store = new KeyvFile({ filename: settings.msgStorageFilePath });
}

const messageCache = new Keyv(settings.msgCacheOptions);

const chatGptClient = new ChatGPTClient(settings.openaiApiKey, settings.chatGptClient, settings.cacheOptions);

const server = fastify();
// configure CORS
server.register(cors, {
    origin: settings.corsOrigin || '*',
});

server.post('/conversation', async (request, reply) => {
    if (settings.apiAuthKey && request.headers['authorization'] !== settings.apiAuthKey) {
        reply.code(401).send({ error: 'Unauthorized.' });
        return;
    }

    let result;
    let error;
    try {
        let parentMessageId;
        let conversationId;

        let msgReplyId = request.body.msgReplyId ? request.body.msgReplyId.toString() : undefined;

        if (msgReplyId) {
            const msgReplyData = await messageCache.get(msgReplyId);
            if (msgReplyData) {
                parentMessageId = msgReplyData.messageId;
                conversationId = msgReplyData.conversationId;
            } else {
                parentMessageId = request.body.parentMessageId ? request.body.parentMessageId.toString() : undefined;
                conversationId = request.body.conversationId ? request.body.conversationId.toString() : undefined;
            }
        }

        result = await chatGptClient.sendMessage(request.body.message, {
            conversationId,
            parentMessageId,
        });
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
    if (settings.apiAuthKey && request.headers['authorization'] !== settings.apiAuthKey) {
        reply.code(401).send({ error: 'Unauthorized.' });
        return;
    }
    try {
        if (!request.body.conversationId || !request.body.messageId || !request.body.replyMsgId) {
            reply.code(400).send({ error: 'Missing parameters.' });
            return;
        }
        // insert into tbl_message
        await messageCache.set(request.body.replyMsgId, {
            messageId: request.body.messageId,
            conversationId: request.body.conversationId,
        });
    } catch {
        reply.code(503).send({ error: 'There was an error executing query to DB' });
    }
});


server.listen({ port: settings.port || 3000, host: '0.0.0.0' }, (error) => {
    if (error) {
        console.error(error);
        process.exit(1);
    }
});
