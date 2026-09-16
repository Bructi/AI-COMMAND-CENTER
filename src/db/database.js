const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '../../data.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Create providers table
    db.run(`CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        name TEXT,
        base_url TEXT,
        api_key TEXT,
        enabled BOOLEAN DEFAULT 1
    )`);

    // Create models table
    db.run(`CREATE TABLE IF NOT EXISTS models (
        id TEXT PRIMARY KEY,
        provider_id TEXT,
        status TEXT DEFAULT '⚪ UNKNOWN',
        latency INTEGER,
        is_free BOOLEAN,
        last_tested DATETIME,
        context_length INTEGER,
        roles TEXT,
        score INTEGER DEFAULT 0,
        FOREIGN KEY(provider_id) REFERENCES providers(id)
    )`);

    // Create aliases table
    db.run(`CREATE TABLE IF NOT EXISTS aliases (
        alias TEXT PRIMARY KEY,
        target_model_id TEXT,
        role TEXT,
        routing_mode TEXT DEFAULT 'BALANCED'
    )`);

    // Create logs table
    db.run(`CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        requested_model TEXT,
        routed_model TEXT,
        status TEXT,
        latency INTEGER,
        error_message TEXT
    )`);

    // Create documents table
    db.run(`CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        filename TEXT,
        drive_id TEXT,
        size INTEGER,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create personas table for the "Teach" feature
    db.run(`CREATE TABLE IF NOT EXISTS personas (
        id TEXT PRIMARY KEY,
        name TEXT,
        prompt TEXT,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create benchmarks table
    db.run(`CREATE TABLE IF NOT EXISTS benchmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model_id TEXT,
        provider_id TEXT,
        overall_score INTEGER,
        coding_score INTEGER,
        reasoning_score INTEGER,
        latency_score INTEGER,
        avg_latency INTEGER,
        report TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        email TEXT UNIQUE,
        password_hash TEXT,
        salt TEXT,
        name TEXT,
        avatar_url TEXT,
        google_id TEXT UNIQUE,
        google_email TEXT,
        google_tokens TEXT,
        role TEXT DEFAULT 'admin',
        api_key TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME
    )`);

    // Create sessions table
    db.run(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Create document_chunks table for RAG
    db.run(`CREATE TABLE IF NOT EXISTS document_chunks (
        id TEXT PRIMARY KEY,
        doc_id TEXT,
        filename TEXT,
        chunk_index INTEGER,
        content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(doc_id) REFERENCES documents(id)
    )`);
});

module.exports = db;