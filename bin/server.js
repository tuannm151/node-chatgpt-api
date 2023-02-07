#!/usr/bin/env node
import fastify from 'fastify';
import cors from '@fastify/cors';
import { FastifySSEPlugin } from "fastify-sse-v2";
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
    const body = request.body || {};

    let onProgress;
    if (body.stream === true) {
        onProgress = (token) => {
            if (settings.apiOptions?.debug) {
                console.debug(token);
            }
            reply.sse({ id: '', data: token });
        };
    } else {
        onProgress = null;
    }

    let result;
    let error;
    try {
        if (!body.message) {
            const invalidError = new Error();
            invalidError.data = {
                code: 400,
                message: 'The message parameter is required.',
            };
            // noinspection ExceptionCaughtLocallyJS
            throw invalidError;
        }

        let replyMsgId = request.body.replyMsgId ? request.body.replyMsgId.toString() : undefined;
        let parentMessageId = request.body.parentMessageId ? request.body.parentMessageId.toString() : undefined;
        let conversationId = request.body.conversationId ? request.body.conversationId.toString() : undefined;

        if (replyMsgId) {
            const msgReplyData = await messageCache.get(replyMsgId);
            if (msgReplyData) {
                parentMessageId = msgReplyData.messageId;
                conversationId = msgReplyData.conversationId;
            }
            if (settings.apiOptions?.debug) {
                console.log('message found', {
                    messageId: parentMessageId,
                    conversationId,
                    replyMsgId,
                });
            }
        }

        result = await chatGptClient.sendMessage(request.body.message, {
            conversationId,
            parentMessageId,
            onProgress,
        });
    } catch (e) {
        error = e;
    }

    if (result !== undefined) {
        if (body.stream === true) {
            reply.sse({ id: '', data: '[DONE]' });
        } else {
            reply.send(result);
        }
        if (settings.apiOptions?.debug) {
            console.debug(result);
        }
    } else {
        const code = error?.data?.code || 503;
        if (code === 503) {
            console.error(error);
        } else if (settings.apiOptions?.debug) {
            console.debug(error);
        }
        const message = error?.data?.message || 'There was an error communicating with ChatGPT.';
        if (body.stream === true) {
            reply.sse({
                id: '',
                event: 'error',
                data: JSON.stringify({
                    code,
                    error: message,
                }),
            });
        } else {
            reply.code(code).send({ error: message });
        }
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
        if (settings.apiOptions?.debug) {
            console.log('message registered', {
                messageId: request.body.messageId,
                conversationId: request.body.conversationId,
                replyMsgId: request.body.replyMsgId,
            });
        }
        reply.code(201).send({ success: true });
    } catch {
        reply.code(503).send({ error: 'There was an error executing query to DB' });
    }
});


server.listen({
    port: settings.apiOptions?.port || settings.port || 3000,
    host: settings.apiOptions?.host || '0.0.0.0'
}, (error) => {
    if (error) {
        console.error(error);
        process.exit(1);
    }
});
