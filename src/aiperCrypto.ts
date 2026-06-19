import crypto from 'crypto';
import forge from 'node-forge';

const PUBLIC_KEY_STRING =
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCIKoKPqwq1f60hm/2lpHDF/DT4J9YaptuTq78nsxdgnSBAvkIZ3E8d' +
  'qbEBT/VETjJ9Yr28QtHX13E8QGByYxLzYPldHNXChgOWfSemTEC3TxPvlaSuM9eFUuhqSeGbgoKG7JJNlgjvsPO2cH' +
  'EhPXJE4qWtKEZVOZBxEeCgAaLZxwIDAQAB';

export class AiperCrypto {
  private readonly aesKey: Buffer;
  private readonly iv: Buffer;

  public readonly encryptKeyHeader: string;

  constructor() {
    this.aesKey = this.randomAsciiBytes(16);
    this.iv = this.randomAsciiBytes(16);
    this.encryptKeyHeader = this.createEncryptKeyHeader();
  }

  encryptRequest(body: Record<string, unknown>): string {
    const payload = {
      ...body,
      nonce: this.randomNonce(),
      timestamp: Date.now(),
    };

    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    const padded = this.zeroPad(raw);

    const cipher = crypto.createCipheriv('aes-128-cbc', this.aesKey, this.iv);
    cipher.setAutoPadding(false);

    const encrypted = Buffer.concat([
      cipher.update(padded),
      cipher.final(),
    ]);

    return JSON.stringify({
      data: encrypted.toString('base64'),
    });
  }

  decryptResponse(responseText: string): string {
    try {
      JSON.parse(responseText);
      return responseText;
    } catch {
      // encrypted response
    }

    if (!responseText) {
      return responseText;
    }

    const encrypted = Buffer.from(responseText, 'base64');

    const decipher = crypto.createDecipheriv('aes-128-cbc', this.aesKey, this.iv);
    decipher.setAutoPadding(false);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return this.zeroUnpad(decrypted).toString('utf8');
  }

  private createEncryptKeyHeader(): string {
    const keyData = JSON.stringify({
      key: this.aesKey.toString('utf8'),
      iv: this.iv.toString('utf8'),
    });

    const derBytes = forge.util.decode64(PUBLIC_KEY_STRING);
    const asn1 = forge.asn1.fromDer(derBytes);
    const publicKey = forge.pki.publicKeyFromAsn1(asn1);

    const encrypted = publicKey.encrypt(keyData, 'RSAES-PKCS1-V1_5');

    return forge.util.encode64(encrypted);
  }

  private zeroPad(data: Buffer): Buffer {
    const padLength = 16 - (data.length % 16);

    if (padLength === 16) {
      return data;
    }

    return Buffer.concat([data, Buffer.alloc(padLength, 0)]);
  }

  private zeroUnpad(data: Buffer): Buffer {
    let end = data.length;

    while (end > 0 && data[end - 1] === 0) {
      end--;
    }

    return data.subarray(0, end);
  }

  private randomAsciiBytes(length: number): Buffer {
    const output: number[] = [];

    for (let i = 0; i < length; i++) {
      output.push(40 + crypto.randomInt(87));
    }

    return Buffer.from(output);
  }

  private randomNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}';
    let out = '';

    for (let i = 0; i < 4; i++) {
      out += chars[crypto.randomInt(chars.length)];
    }

    return out;
  }
}