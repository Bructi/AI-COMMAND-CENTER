const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const TOKEN_PATH = path.join(__dirname, '../../drive_token.json');

class DriveManager {
    constructor() {
        this.oAuth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/drive/callback'
        );
        
        this.isConnected = false;
        this.loadToken();
    }

    loadToken() {
        try {
            if (fs.existsSync(TOKEN_PATH)) {
                const token = fs.readFileSync(TOKEN_PATH);
                this.oAuth2Client.setCredentials(JSON.parse(token));
                this.isConnected = true;
                this.drive = google.drive({ version: 'v3', auth: this.oAuth2Client });
            }
        } catch (error) {
            console.error('Error loading Drive token:', error.message);
        }
    }

    getAuthUrl() {
        return this.oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/drive.file'],
        });
    }

    async authenticate(code) {
        try {
            const { tokens } = await this.oAuth2Client.getToken(code);
            this.oAuth2Client.setCredentials(tokens);
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
            this.isConnected = true;
            this.drive = google.drive({ version: 'v3', auth: this.oAuth2Client });
            return true;
        } catch (error) {
            console.error('Error authenticating with Drive:', error.message);
            return false;
        }
    }

    async uploadLogFile(filename, content) {
        if (!this.isConnected) return { success: false, reason: "Not connected to Drive" };
        
        try {
            const fileMetadata = {
                name: filename,
                mimeType: 'text/plain'
            };
            const media = {
                mimeType: 'text/plain',
                body: content
            };
            
            const file = await this.drive.files.create({
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
    
    async uploadBuffer(filename, buffer, mimeType) {
        if (!this.isConnected) return { success: false, reason: "Not connected to Drive" };
        
        try {
            const stream = require('stream');
            const bufferStream = new stream.PassThrough();
            bufferStream.end(buffer);

            const file = await this.drive.files.create({
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

    async downloadFile(fileId) {
        if (!this.isConnected) return { success: false, reason: "Not connected to Drive" };
        
        try {
            const response = await this.drive.files.get({
                fileId: fileId,
                alt: 'media'
            }, { responseType: 'stream' });

            return new Promise((resolve, reject) => {
                let data = '';
                response.data.on('data', chunk => data += chunk);
                response.data.on('end', () => resolve({ success: true, content: data }));
                response.data.on('error', err => reject({ success: false, error: err.message }));
            });
        } catch (error) {
            console.error('Failed to download from Drive:', error.message);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new DriveManager();
