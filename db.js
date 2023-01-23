import Database from "better-sqlite3";

export default class ConnectDB {
    constructor() {
        this.db = new Database("./db.sqlite3");
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tbl_conversation (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversationId TEXT NOT NULL,
                accountId TEXT NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS tbl_message (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversationId TEXT NOT NULL,
                messageId TEXT NOT NULL,
                replyMsgId TEXT NOT NULL UNIQUE
            );
        `);
        this.db.pragma('journal_mode = WAL');
    }

    getConversations() {
        return this.db.prepare("SELECT * FROM tbl_conversation").all();
    }

    getMessages() {
        return this.db.prepare("SELECT * FROM tbl_message").all();
    }

    getAccountIdByConversationId(conversationId) {
        return this.db
            .prepare("SELECT accountId FROM tbl_conversation WHERE conversationId = ?")
            .get(conversationId);
    }

    getMessageByReplyMsgId(replyMsgId) {
        return this.db
            .prepare("SELECT * FROM tbl_message WHERE replyMsgId = ?")
            .get(replyMsgId);
    }

    insertConversation(conversationId, accountId) {
        return this.db
            .prepare("INSERT INTO tbl_conversation (conversationId, accountId) VALUES (?, ?)")
            .run(conversationId, accountId);
    }

    insertMessage(conversationId, messageId, replyMsgId) {
        return this.db
            .prepare("INSERT INTO tbl_message (conversationId, messageId, replyMsgId) VALUES (?, ?, ?)")
            .run(conversationId, messageId, replyMsgId);
    }

    close() {
        this.db.close();
    }
} 