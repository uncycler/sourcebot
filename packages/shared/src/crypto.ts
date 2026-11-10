import crypto from 'crypto';
import { env } from './env.server.js';
import { Token } from '@sourcebot/schemas/v3/shared.type';
import { API_KEY_PREFIX } from './constants.js';

const algorithm = 'aes-256-cbc';
const ivLength = 16; // 16 bytes for CBC

const generateIV = (): Buffer => {
    return crypto.randomBytes(ivLength);
};

export function encrypt(text: string): { iv: string; encryptedData: string } {
    const encryptionKey = Buffer.from(env.SOURCEBOT_ENCRYPTION_KEY, 'ascii');

    const iv = generateIV();
    const cipher = crypto.createCipheriv(algorithm, encryptionKey, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return { iv: iv.toString('hex'), encryptedData: encrypted };
}

export function decrypt(iv: string, encryptedText: string): string {
    const encryptionKey = Buffer.from(env.SOURCEBOT_ENCRYPTION_KEY, 'ascii');

    const ivBuffer = Buffer.from(iv, 'hex');
    const encryptedBuffer = Buffer.from(encryptedText, 'hex');

    const decipher = crypto.createDecipheriv(algorithm, encryptionKey, ivBuffer);

    let decrypted = decipher.update(encryptedBuffer, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}


export function hashSecret(text: string): string {
    return crypto.createHmac('sha256', env.SOURCEBOT_ENCRYPTION_KEY).update(text).digest('hex');
}

export function generateApiKey(): { key: string; hash: string } {
    const secret = crypto.randomBytes(32).toString('hex');
    const hash = hashSecret(secret);

    return {
        key: `${API_KEY_PREFIX}${secret}`,
        hash,
    };
}

export const getTokenFromConfig = async (token: Token): Promise<string> => {
    if ('env' in token) {
        const envToken = process.env[token.env];
        if (!envToken) {
            throw new Error(`Environment variable ${token.env} not found.`);
        }

        return envToken.trim();
    } else {
        throw new Error('Invalid token configuration');
    }
};
