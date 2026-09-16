const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

class AuthManager {
    // Hash password with unique salt
    hashPassword(password, salt = null) {
        if (!salt) {
            salt = crypto.randomBytes(16).toString('hex');
        }
        const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
        return { hash, salt };
    }

    // Verify password against stored hash and salt
    verifyPassword(password, storedHash, salt) {
        const { hash } = this.hashPassword(password, salt);
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
    }

    // Generate user API Key
    generateApiKey() {
        return 'sk-omni-' + crypto.randomBytes(24).toString('hex');
    }

    // Create session token
    createSession(userId) {
        return new Promise((resolve, reject) => {
            const token = crypto.randomBytes(32).toString('hex');
            // Session expires in 30 days
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            
            db.run(
                `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`,
                [token, userId, expiresAt],
                (err) => {
                    if (err) return reject(err);
                    resolve(token);
                }
            );
        });
    }

    // Register a new local user
    async register({ username, email, password, name }) {
        if (!username || !email || !password) {
            throw new Error('Username, email, and password are required.');
        }

        const cleanUsername = username.trim().toLowerCase();
        const cleanEmail = email.trim().toLowerCase();
        const displayName = name ? name.trim() : username.trim();

        if (cleanUsername.length < 3) {
            throw new Error('Username must be at least 3 characters.');
        }
        if (password.length < 6) {
            throw new Error('Password must be at least 6 characters.');
        }

        // Check if username or email already exists
        const existing = await new Promise((resolve, reject) => {
            db.get(
                `SELECT id, username, email FROM users WHERE username = ? OR email = ?`,
                [cleanUsername, cleanEmail],
                (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                }
            );
        });

        if (existing) {
            if (existing.username === cleanUsername) throw new Error('Username is already taken.');
            if (existing.email === cleanEmail) throw new Error('Email is already registered.');
        }

        // Check user count to grant admin role to first registered user
        const count = await new Promise((resolve) => {
            db.get(`SELECT COUNT(*) AS total FROM users`, [], (err, row) => {
                resolve(row ? row.total : 0);
            });
        });

        const role = count === 0 ? 'admin' : 'user';
        const userId = uuidv4();
        const { hash, salt } = this.hashPassword(password);
        const apiKey = this.generateApiKey();

        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO users (id, username, email, password_hash, salt, name, role, api_key, last_login)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [userId, cleanUsername, cleanEmail, hash, salt, displayName, role, apiKey],
                (err) => {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });

        const token = await this.createSession(userId);
        const user = await this.getUserById(userId);
        return { user, token };
    }

    // Login with username or email + password
    async login({ login, password }) {
        if (!login || !password) {
            throw new Error('Login identifier and password are required.');
        }

        const identifier = login.trim().toLowerCase();
        const row = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM users WHERE username = ? OR email = ?`,
                [identifier, identifier],
                (err, userRow) => {
                    if (err) return reject(err);
                    resolve(userRow);
                }
            );
        });

        if (!row || !row.password_hash || !row.salt) {
            throw new Error('Invalid credentials or account registered via Google OAuth.');
        }

        const isValid = this.verifyPassword(password, row.password_hash, row.salt);
        if (!isValid) {
            throw new Error('Invalid password.');
        }

        // Update last login
        db.run(`UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?`, [row.id]);

        const token = await this.createSession(row.id);
        const user = await this.getUserById(row.id);
        return { user, token };
    }

    // Handle Google OAuth login & automatic account link with Google Drive
    async handleGoogleAuth({ googleId, email, name, picture, tokens }) {
        if (!googleId || !email) {
            throw new Error('Invalid Google OAuth profile data.');
        }

        const cleanEmail = email.trim().toLowerCase();
        const tokensJson = tokens ? JSON.stringify(tokens) : null;

        // 1. Try finding user by google_id
        let user = await new Promise((resolve, reject) => {
            db.get(`SELECT * FROM users WHERE google_id = ?`, [googleId], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });

        if (user) {
            // Update Google tokens and avatar
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE users SET google_tokens = ?, google_email = ?, avatar_url = COALESCE(?, avatar_url), last_login = CURRENT_TIMESTAMP WHERE id = ?`,
                    [tokensJson, cleanEmail, picture, user.id],
                    (err) => {
                        if (err) return reject(err);
                        resolve();
                    }
                );
            });
        } else {
            // 2. Try finding user by email to link Google account
            user = await new Promise((resolve, reject) => {
                db.get(`SELECT * FROM users WHERE email = ?`, [cleanEmail], (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                });
            });

            if (user) {
                // Link Google account to existing email user
                await new Promise((resolve, reject) => {
                    db.run(
                        `UPDATE users SET google_id = ?, google_email = ?, google_tokens = ?, avatar_url = COALESCE(avatar_url, ?), last_login = CURRENT_TIMESTAMP WHERE id = ?`,
                        [googleId, cleanEmail, tokensJson, picture, user.id],
                        (err) => {
                            if (err) return reject(err);
                            resolve();
                        }
                    );
                });
            } else {
                // 3. Create new user for this Google account
                const count = await new Promise((resolve) => {
                    db.get(`SELECT COUNT(*) AS total FROM users`, [], (err, row) => {
                        resolve(row ? row.total : 0);
                    });
                });
                const role = count === 0 ? 'admin' : 'user';
                const userId = uuidv4();
                
                // Base username on email username part
                let baseUsername = cleanEmail.split('@')[0].replace(/[^a-z0-9_]/gi, '');
                if (baseUsername.length < 3) baseUsername = 'user_' + userId.slice(0, 6);
                
                // Ensure username uniqueness
                let uniqueUsername = baseUsername;
                let counter = 1;
                while (true) {
                    const exists = await new Promise((res) => {
                        db.get(`SELECT id FROM users WHERE username = ?`, [uniqueUsername], (err, r) => res(!!r));
                    });
                    if (!exists) break;
                    uniqueUsername = `${baseUsername}${counter++}`;
                }

                const apiKey = this.generateApiKey();

                await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT INTO users (id, username, email, name, avatar_url, google_id, google_email, google_tokens, role, api_key, last_login)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                        [userId, uniqueUsername, cleanEmail, name || uniqueUsername, picture, googleId, cleanEmail, tokensJson, role, apiKey],
                        (err) => {
                            if (err) return reject(err);
                            resolve();
                        }
                    );
                });

                user = { id: userId };
            }
        }

        const token = await this.createSession(user.id);
        const fullUser = await this.getUserById(user.id);
        return { user: fullUser, token };
    }

    // Validate Session Token
    async validateSession(token) {
        if (!token) return null;

        return new Promise((resolve, reject) => {
            const query = `
                SELECT u.id, u.username, u.email, u.name, u.avatar_url, u.google_id, u.google_email,
                       (u.google_tokens IS NOT NULL AND u.google_tokens != '') AS google_connected,
                       u.role, u.api_key, u.created_at, u.last_login,
                       s.expires_at
                FROM sessions s
                JOIN users u ON s.user_id = u.id
                WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
            `;
            db.get(query, [token], (err, row) => {
                if (err) return reject(err);
                resolve(row || null);
            });
        });
    }

    // Get User By ID (sanitized)
    async getUserById(userId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT id, username, email, name, avatar_url, google_id, google_email,
                       (google_tokens IS NOT NULL AND google_tokens != '') AS google_connected,
                       role, api_key, created_at, last_login
                FROM users
                WHERE id = ?
            `;
            db.get(query, [userId], (err, row) => {
                if (err) return reject(err);
                resolve(row || null);
            });
        });
    }

    // Get User Google Tokens
    async getUserGoogleTokens(userId) {
        return new Promise((resolve, reject) => {
            db.get(`SELECT google_tokens FROM users WHERE id = ?`, [userId], (err, row) => {
                if (err) return reject(err);
                if (row && row.google_tokens) {
                    try {
                        resolve(JSON.parse(row.google_tokens));
                    } catch {
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            });
        });
    }

    // Destroy session (Logout)
    async logout(token) {
        return new Promise((resolve, reject) => {
            db.run(`DELETE FROM sessions WHERE token = ?`, [token], (err) => {
                if (err) return reject(err);
                resolve(true);
            });
        });
    }

    // Regenerate user API Key
    async regenerateApiKey(userId) {
        const newKey = this.generateApiKey();
        return new Promise((resolve, reject) => {
            db.run(`UPDATE users SET api_key = ? WHERE id = ?`, [newKey, userId], (err) => {
                if (err) return reject(err);
                resolve(newKey);
            });
        });
    }

    // Unlink Google Drive & OAuth
    async unlinkGoogle(userId) {
        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE users SET google_id = NULL, google_email = NULL, google_tokens = NULL WHERE id = ?`,
                [userId],
                (err) => {
                    if (err) return reject(err);
                    resolve(true);
                }
            );
        });
    }

    // Find User by API Key
    async getUserByApiKey(apiKey) {
        if (!apiKey) return null;
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT id, username, email, name, role, api_key FROM users WHERE api_key = ?`,
                [apiKey],
                (err, row) => {
                    if (err) return reject(err);
                    resolve(row || null);
                }
            );
        });
    }
}

module.exports = new AuthManager();
