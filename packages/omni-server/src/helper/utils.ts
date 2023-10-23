/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import crypto from 'crypto';
import { customAlphabet } from 'nanoid';
import { promises as fs } from 'fs';
import path from 'path';

function convertMapsToObjects(obj: any): any {
  if (obj instanceof Map) {
    obj = Object.fromEntries(obj);
  }

  for (const key of Object.keys(obj)) {
    if (obj[key] instanceof Map) {
      obj[key] = Object.fromEntries(obj[key]);
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      obj[key] = convertMapsToObjects(obj[key]);
    }
  }

  return obj;
}

function encrypt(text: string, secretKey: Buffer, algorithm: string, signature?: { hmacSecret: Buffer, data: string }): string {
  // Generate an initialization vector
  const iv = crypto.randomBytes(16);

  // Create a new cipher using the algorithm, key, and iv
  const cipher = crypto.createCipheriv(algorithm, secretKey, iv);

  // Create the encrypted buffer
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);

  let result = `${iv.toString('hex')}:${encrypted.toString('hex')}`;

  // Create an HMAC of the baseURL
  if (signature) {
    const hmac = crypto.createHmac('sha256', signature.hmacSecret);
    hmac.update(signature.data);
    const hmacDigest = hmac.digest('hex');
    omnilog.debug(`Encrypt: HMAC: ${hmacDigest}`)
    result += `:${hmacDigest}`;
  }

  // Return the concatenated iv, encrypted content
  return result;
}

function decrypt(encryptedData: string, secretKey: Buffer, algorithm: string, signature?: { hmacSecret: Buffer, data: string }): string | null {
  // Split the data into its components
  const textParts = encryptedData.split(':');

  if (signature && textParts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  } else if (!signature && textParts.length !== 2) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(textParts[0], 'hex');
  const encryptedText = Buffer.from(textParts[1], 'hex');

  // If signature is provided, validate the HMAC
  if (signature) {
    const hmacDigest = textParts[2];
    const hmac = crypto.createHmac('sha256', signature.hmacSecret);
    hmac.update(signature.data);
    const generatedHmac = hmac.digest('hex');
    omnilog.debug(`Decrypt: HMAC: ${generatedHmac} vs ${hmacDigest}`)
    // const hmacBuffer = hmac.digest();
    // const hmacDigestBuffer = Buffer.from(hmacDigest, 'hex');
    // omnilog.debug('Lengths:', hmacDigestBuffer.length, hmacBuffer.length)
    // omnilog.debug('Original:', hmacDigestBuffer.toString('binary'));
    // omnilog.debug('Generated:', hmacBuffer.toString('binary'));
    omnilog.debug('Siganature', signature.data)
    // if (!hmacBuffer.equals(hmacDigestBuffer)) {
    //   throw new Error('Data signature is invalid');
    // }
    if (hmacDigest.trim().toLowerCase() !== generatedHmac.trim().toLowerCase()) {
      throw new Error('Data signature is invalid');
    }
  }

  // Proceed with decryption
  const decipher = crypto.createDecipheriv(algorithm, secretKey, iv);
  let decrypted;
  try {
    decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
  } catch (error) {
    throw new Error('Decryption failed');
  }

  return decrypted.toString();
}

function hashPassword(password: string, saltBuff: Buffer) {
  return crypto.pbkdf2Sync(password, saltBuff, 210000, 64, 'sha512');
}

function generateId() {
  const characters = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const length = 16;
  const nanoid = customAlphabet(characters, length);
  return nanoid();
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function randomBytes(length: number): string {
  return crypto.randomBytes(length).toString('hex');
}

export { convertMapsToObjects, decrypt, encrypt, hashPassword, generateId, capitalize, randomBytes };

async function* getFiles(directory: string): AsyncGenerator<string> {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* getFiles(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

export async function scanDirectory(directoryPath: string): Promise<string[]> {
  const files: string[] = [];

  for await (const file of getFiles(directoryPath)) {
    files.push(file);
  }

  return files;
}
