const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const TOKEN_PATH = path.join(__dirname, '../../drive_token.json');

class DriveManager {
    constructor() {
        this.oAuth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'
        );
        
        this.isConnected = false;
        this.accountInfo = null;
        this.loadToken();
    }

    loadToken() {
        try {
            if (fs.existsSync(TOKEN_PATH)) {
                const tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
                this.oAuth2Client.setCredentials(tokenData);
                this.isConnected = true;
                this.drive = google.drive({ version: 'v3', auth: this.oAuth2Client });
                
                // Try fetching profile info in background
                this.fetchAccountProfile().catch(() => {});
            }
        } catch (error) {
            console.error('Error loading Drive token:', error.message);
        }
    }

    async fetchAccountProfile() {
        try {
            const oauth2 = google.oauth2({ version: 'v2', auth: this.oAuth2Client });
            const res = await oauth2.userinfo.get();
            this.accountInfo = {
                id: res.data.id,
                email: res.data.email,
                name: res.data.name,
                picture: res.data.picture
            };
            return this.accountInfo;
        } catch (err) {
            // Profile fetch optional on cold start
            return null;
        }
    }

    getAuthUrl(state = '') {
        return this.oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: [
                'openid',
                'https://www.googleapis.com/auth/userinfo.profile',
                'https://www.googleapis.com/auth/userinfo.email',
                'https://www.googleapis.com/auth/drive.file'
            ],
            state: state || undefined
        });
    }

    async authenticate(code) {
        try {
            const { tokens } = await this.oAuth2Client.getToken(code);
            this.oAuth2Client.setCredentials(tokens);
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
            this.isConnected = true;
            this.drive = google.drive({ version: 'v3', auth: this.oAuth2Client });
            
            // Fetch user profile
            const profile = await this.fetchAccountProfile();
            return { success: true, tokens, profile };
        } catch (error) {
            console.error('Error authenticating with Google Drive / OAuth:', error.message);
            return { success: false, error: error.message };
        }
    }

    // Get a scoped drive instance for a specific user token or fallback to global
    getDriveClient(userTokens = null) {
        if (userTokens) {
            const client = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'
            );
            client.setCredentials(userTokens);
            return google.drive({ version: 'v3', auth: client });
        }
        return this.drive;
    }

    async uploadLogFile(filename, content, userTokens = null) {
        const drive = this.getDriveClient(userTokens);
        if (!drive) return { success: false, reason: "Not connected to Drive" };
        
        try {
            const fileMetadata = {
                name: filename,
                mimeType: 'text/plain'
            };
            const media = {
                mimeType: 'text/plain',
                body: content
            };
            
            const file = await drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id'
            });
            return { success: true, fileId: file.data.id };
        } catch (error) {
            console.error('Failed to upload to Drive:', error.message);
            return { success: false, error: error.message };
        }
    }
    
    async uploadBuffer(filename, buffer, mimeType, userTokens = null) {
        const drive = this.getDriveClient(userTokens);
        if (!drive) return { success: false, reason: "Not connected to Drive" };
        
        try {
            const stream = require('stream');
            const bufferStream = new stream.PassThrough();
            bufferStream.end(buffer);

            const file = await drive.files.create({
                resource: { name: filename, mimeType },
                media: { mimeType, body: bufferStream },
                fields: 'id'
            });
            return { success: true, fileId: file.data.id };
        } catch (error) {
            console.error('Failed to upload buffer to Drive:', error.message);
            return { success: false, error: error.message };
        }
    }

    async downloadFile(fileId, userTokens = null) {
        const drive = this.getDriveClient(userTokens);
        if (!drive) return { success: false, reason: "Not connected to Drive" };
        
        try {
            const response = await drive.files.get({
                fileId: fileId,
                alt: 'media'
            }, { responseType: 'stream' });

            return new Promise((resolve, reject) => {
                const chunks = [];
                response.data.on('data', chunk => chunks.push(chunk));
                response.data.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    resolve({ success: true, buffer, content: buffer.toString('utf-8') });
                });
                response.data.on('error', err => reject({ success: false, error: err.message }));
            });
        } catch (error) {
            console.error('Failed to download from Drive:', error.message);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new DriveManager();
